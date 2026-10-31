-- How long failures are kept: a setting per workspace (1 to 365 days, default 90), and an automatic cleanup that removes older ones.
--  * "Failures" are the ones the Failures page lists: webhook events that failed, and automation runs that failed. Processed and ignored
--    events, and runs that succeeded, are never touched. A removed failure cannot be brought back.
--  * Saving a setting removes the failures that are already older than it, right away, in the same call (set_failure_retention returns
--    how many it removed). After that, the engine's tick (every few seconds) keeps it true: purge_old_failures lets itself through at most
--    once every 5 minutes.
--  * Each pass removes at most 2000 rows of each kind per workspace, so a huge backlog is never one giant delete. When a pass hit that
--    limit there is more to do, so the next call is not held back by the 5-minute rule and the backlog is worked off a few seconds apart.
--  * The setting is changed only through set_failure_retention (owner or admin), and failures_older_than says how many a smaller number
--    would remove, so the app can tell you before you save.

alter table public.organizations
  add column failure_retention_days int not null default 90 check (failure_retention_days between 1 and 365);

-- One workspace, one pass: removes what is older than p_days (at most 2000 rows of each kind) and says whether a limit was hit.
create function public.purge_org_failures(p_org uuid, p_days int, out removed int, out capped boolean)
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  removed := 0; capped := false;
  with gone as (
    delete from webhook_events where id in (
      select id from webhook_events where organization_id = p_org and status = 'failed'
        and received_at < now() - make_interval(days => p_days) limit 2000) returning 1)
  select count(*) into c from gone;
  removed := removed + c; capped := capped or c >= 2000;
  with gone as (
    delete from workflow_runs where id in (
      select id from workflow_runs where organization_id = p_org and status = 'failed'
        and coalesce(finished_at, created_at) < now() - make_interval(days => p_days) limit 2000) returning 1)
  select count(*) into c from gone;
  removed := removed + c; capped := capped or c >= 2000;
end $$;
revoke execute on function public.purge_org_failures(uuid, int) from public, anon, authenticated;

-- Saving removes what is already older than the new number, straight away. Returns how many it removed.
create function public.set_failure_retention(p_org uuid, p_days int) returns int
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not has_org_role(p_org, array['owner', 'admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Keep failures for between 1 and 365 days.';
  end if;
  update organizations set failure_retention_days = p_days, updated_at = now() where id = p_org;
  select * into r from purge_org_failures(p_org, p_days);
  return r.removed;
end $$;
revoke execute on function public.set_failure_retention(uuid, int) from public, anon;
grant execute on function public.set_failure_retention(uuid, int) to authenticated;

-- How many failures are older than p_days: what saving that number would remove at the next cleanup. Row security decides what is counted.
create function public.failures_older_than(p_org uuid, p_days int) returns int
language sql stable security invoker set search_path = public as $$
  select (select count(*) from webhook_events e
          where e.organization_id = p_org and e.status = 'failed' and e.received_at < now() - make_interval(days => least(greatest(p_days, 1), 365)))::int
       + (select count(*) from workflow_runs r
          where r.organization_id = p_org and r.status = 'failed' and coalesce(r.finished_at, r.created_at) < now() - make_interval(days => least(greatest(p_days, 1), 365)))::int
$$;

create table public.maintenance_state (key text primary key, last_run timestamptz not null);
alter table public.maintenance_state enable row level security;
revoke all on public.maintenance_state from anon, authenticated; -- internal

-- Called by the engine tick (service role). Returns how many rows it removed.
create function public.purge_old_failures() returns int
language plpgsql security definer set search_path = public as $$
declare o record; r record; removed int := 0; any_capped boolean := false; last timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('purge_old_failures')) then return 0; end if;
  select last_run into last from maintenance_state where key = 'purge_failures';
  if last is not null and last > now() - interval '5 minutes' then return 0; end if;
  for o in select id, failure_retention_days as days from organizations loop
    select * into r from purge_org_failures(o.id, o.days);
    removed := removed + r.removed;
    any_capped := any_capped or r.capped;
  end loop;
  -- a pass that hit its limit leaves more to do: stamp it as if it ran 5 minutes ago, so the next call carries on at once
  insert into maintenance_state (key, last_run) values ('purge_failures', case when any_capped then now() - interval '5 minutes' else now() end)
  on conflict (key) do update set last_run = excluded.last_run;
  return removed;
end $$;
revoke execute on function public.purge_old_failures() from public, anon, authenticated;
grant execute on function public.purge_old_failures() to service_role;
