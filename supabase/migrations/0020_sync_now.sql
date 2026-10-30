-- "Sync now": a person asks WorkRelay to pull a shop's products straight away.
--  * It is the same operation as a scheduled pull, so it works only where the platform admin has set a schedule (calls per
--    days) for the shop, the workspace has entered the products URL, and the shop is not paused.
--  * It spends from the SAME budget as the scheduled calls. A shop's budget is "calls" per "days" in a window that starts at
--    its first call and renews after `days` days; scheduled and manual calls both count, and a window with no calls left
--    makes both wait. So "15 per day" can never become more because someone keeps pressing the button.
--  * A short cooldown (60 seconds) stops a double-click from spending two calls.
--  * The platform admin changing the rate starts a fresh window.

alter table public.integration_sync
  add column window_start timestamptz,
  add column window_used int not null default 0,
  add column last_attempt_at timestamptz;
grant select (window_start, window_used) on public.integration_sync to authenticated;

-- ------------------------------------------------------------------------------------------------ scheduled calls share the budget
create or replace function public.claim_due_product_syncs(p_limit int default 3)
returns table (integration_id uuid, source_url text, auth_header text)
language sql security definer set search_path = public as $$
  with due as (
    select s.integration_id from integration_sync s
    join integrations i on i.id = s.integration_id
    where s.source_url is not null and s.calls is not null and not s.paused
      and i.status = 'connected' and s.next_sync_at <= now()
      -- a window with no calls left waits for the next window
      and (s.window_start is null or now() >= s.window_start + make_interval(days => s.days) or s.window_used < s.calls)
    order by s.next_sync_at
    limit least(greatest(p_limit, 1), 20)
    for update of s skip locked
  )
  update integration_sync s set
    window_used = case when s.window_start is null or now() >= s.window_start + make_interval(days => s.days) then 1 else s.window_used + 1 end,
    window_start = case when s.window_start is null or now() >= s.window_start + make_interval(days => s.days) then now() else s.window_start end,
    last_attempt_at = now(),
    next_sync_at = now() + sync_interval(s.calls, s.days)
  from due where s.integration_id = due.integration_id
  returning s.integration_id, s.source_url, s.auth_header
$$;

-- A new rate starts a fresh window.
create or replace function public.admin_set_sync_rate(p_integration uuid, p_calls int, p_days int) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from integrations where id = p_integration;
  if not found then raise exception 'unknown shop'; end if;
  insert into integration_sync (integration_id, organization_id, calls, days, next_sync_at)
  values (p_integration, i.organization_id, p_calls, p_days,
          case when p_calls is null then null else now() + sync_interval(p_calls, p_days) end)
  on conflict (integration_id) do update set
    calls = excluded.calls, days = excluded.days, updated_at = now(),
    window_start = null, window_used = 0,
    next_sync_at = case when excluded.calls is null then null else now() + sync_interval(excluded.calls, excluded.days) end;
end $$;

-- ------------------------------------------------------------------------------------------------ the manual call
-- Called only by the sync-now Edge Function (service role), after it has verified who is asking. Returns what the pull needs,
-- and how many calls are left in the window. Errors are plain codes the app turns into sentences.
create function public.claim_manual_product_sync(p_user uuid, p_integration uuid)
returns table (source_url text, auth_header text, calls_left int)
language plpgsql security definer set search_path = public as $$
declare i integrations; s integration_sync; have boolean; expired boolean; used int;
begin
  select * into i from integrations where id = p_integration;
  if not found or not exists (
    select 1 from memberships m
    where m.organization_id = i.organization_id and m.user_id = p_user and m.role in ('owner', 'admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from integration_sync where integration_id = p_integration for update;
  have := found;
  if i.status <> 'connected' then raise exception 'not_connected'; end if;
  if not have or s.source_url is null then raise exception 'no_url'; end if;
  if s.calls is null then raise exception 'not_scheduled'; end if;
  if s.paused then raise exception 'paused'; end if;
  if s.last_attempt_at is not null and s.last_attempt_at > now() - interval '60 seconds' then raise exception 'too_soon'; end if;
  expired := s.window_start is null or now() >= s.window_start + make_interval(days => s.days);
  used := case when expired then 0 else s.window_used end;
  if used >= s.calls then raise exception 'budget_used'; end if;
  update integration_sync set
    window_start = case when expired then now() else window_start end,
    window_used = used + 1, last_attempt_at = now(), updated_at = now()
  where integration_id = p_integration;
  return query select s.source_url, s.auth_header, s.calls - used - 1;
end $$;
revoke execute on function public.claim_manual_product_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_manual_product_sync(uuid, uuid) to service_role;
