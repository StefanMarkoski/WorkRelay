-- 0046: write-back works like git. Before WorkRelay sends a number to a shop it PULLS the shop's own numbers (quietly, no announcement),
-- compares them with what it believes the shop holds, and only sends what is still right. After a push it pulls once more to check
-- the shop took the numbers. Disagreements become conflicts that the owner decides, and they stay in the sync history.
--
--  * A shop needs a product feed address (the "pull address") to be switched on, and a fresh pull is a condition of every push.
--  * claim_pre_push_pulls says which shops to read now; fail_pre_push_pull counts a failed read like a failed request.
--  * claim_stock_pushes sends only after a fresh pull that is newer than the last successful push, recalculates every waiting number
--    from that pull, drops numbers the shop already has, and sends what WorkRelay believed the shop held with each number.
--  * A conflict holds the product's waiting number and blocks new ones until the owner decides.
--  * What WorkRelay "believes the shop holds" counts an acknowledged push, so a decision for WorkRelay is not reported as a new conflict.
--  * A queueing failure is logged as a skipped number instead of only a database warning.
--  * The sync history lists both directions with how many issues each had; sync_run_conflicts says what was decided.

-- ------------------------------------------------------------------------------------------------ settings and state
alter table public.product_sync_runs drop constraint if exists product_sync_runs_trigger_check;
alter table public.product_sync_runs add constraint product_sync_runs_trigger_check
  check (trigger in ('shop', 'scheduled', 'manual', 'before_push', 'after_push'));

alter table public.integrations
  add column stock_push_pulled_at timestamptz,        -- when the last good pull of the shop's numbers was sent
  add column stock_push_pull_claimed_at timestamptz,  -- one pull at a time per shop, and a pause after a failed one
  add column stock_push_verify boolean not null default false; -- a push went out and the shop's numbers have not been read since

-- ------------------------------------------------------------------------------------------------ switching on needs a feed
create or replace function public.set_stock_push_enabled(p_integration uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not is_org_member(i.organization_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled then
    if not has_org_role(i.organization_id, array['owner']::org_role[]) then raise exception 'Only the workspace owner can switch stock write-back on.' using errcode = '42501'; end if;
    if i.status <> 'connected' then raise exception 'This shop is not connected.'; end if;
    if i.stock_push_locked then raise exception 'WorkRelay has blocked stock write-back for this shop.'; end if;
    if not i.estimate_stock then raise exception 'Switch on "Estimate stock between syncs" first: the estimate is the number that gets sent.'; end if;
    if not exists (select 1 from integration_sync s where s.integration_id = p_integration and s.source_url is not null) then
      raise exception 'Add the shop''s product feed address first: WorkRelay reads the shop''s own numbers before it sends its own.';
    end if;
    if i.stock_push_url is null then raise exception 'Add the shop''s stock address first.'; end if;
    if i.stock_push_secret_id is null then raise exception 'Create a signing secret first.'; end if;
    if i.stock_push_verified_at is null then raise exception 'Send a test first: the shop has to answer a signed request correctly.'; end if;
    update integrations set stock_push_enabled = true, stock_push_failures = 0, stock_push_paused_reason = null, updated_at = now() where id = p_integration;
  else
    update integrations set stock_push_enabled = false, stock_push_paused_reason = null, updated_at = now() where id = p_integration;
    perform cancel_stock_pushes(p_integration, 'Write-back was switched off.');
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------ queueing
-- Same as 0043, plus: a product with an open conflict is not queued. Nothing is sent over a disagreement the owner has not settled.
create or replace function public.enqueue_stock_pushes(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid; r record; queued int := 0;
begin
  if not exists (select 1 from products p join integrations i on i.id = p.integration_id
                 where p.id = any(p_ids) and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected') then
    return;
  end if;
  for o in select distinct organization_id from products where id = any(p_ids) loop
    for r in
      select p.organization_id, p.integration_id, p.id as product_id, p.sku, e.estimated
      from stock_estimates(o, p_ids) e
      join products p on p.id = e.product_id
      join integrations i on i.id = p.integration_id and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected'
      where not exists (select 1 from stock_conflicts c where c.product_id = p.id and c.status = 'open')
    loop
      if r.estimated < 0 or r.estimated > 2147483647 then
        update stock_push_items set status = 'cancelled', note = 'replaced by a newer value', updated_at = now()
        where product_id = r.product_id and status = 'pending';
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason, status, note)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, null, 'order', 'skipped',
                'The estimate is ' || r.estimated || ', outside what can be sent (0 and up): not sent.');
      else
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, r.estimated, 'order')
        on conflict (product_id) where status = 'pending' do update set stock = excluded.stock, updated_at = now(), due_at = now(), reason = 'order';
        queued := queued + 1;
      end if;
    end loop;
  end loop;
  if queued > 0 then perform kick_engine(); end if;
end $$;

-- A queueing failure must never fail the order, but it must not vanish either: each affected product gets a skipped row with the reason.
create function public.log_stock_push_queue_failure(p_ids uuid[], p_message text) returns void
language sql security definer set search_path = public as $$
  insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason, status, note)
  select p.organization_id, p.integration_id, p.id, p.sku, null, 'order', 'skipped', left('Not queued, WorkRelay had an internal problem: ' || coalesce(p_message, 'unknown'), 300)
  from products p join integrations i on i.id = p.integration_id and i.stock_push_enabled
  where p.id = any(p_ids)
  limit 100
$$;
revoke execute on function public.log_stock_push_queue_failure(uuid[], text) from public, anon, authenticated;

create or replace function public.process_estimate_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; msg text;
begin
  with taken as (delete from estimate_checks where txid = txid_current() returning product_id)
  select array_agg(product_id) into ids from taken;
  if ids is not null then
    begin
      perform check_estimated_lows(ids);
    exception when others then
      raise warning 'estimated low-stock check failed: %', sqlerrm;
    end;
    begin
      perform enqueue_stock_pushes(ids);
    exception when others then
      msg := sqlerrm;
      raise warning 'stock write-back queueing failed: %', msg;
      begin
        perform log_stock_push_queue_failure(ids, msg);
      exception when others then
        null; -- the order itself is never put at risk
      end;
    end;
  end if;
  return null;
end $$;

-- ------------------------------------------------------------------------------------------------ the quiet pulls
-- Which shops should be read now: they have numbers waiting (before a push) or a push to check (after one), no fresh pull since the
-- last push, and nobody is already reading them. The platform's own pause and call budget for the scheduled pull are not touched.
create function public.claim_pre_push_pulls(p_max_shops int default 5)
returns table (integration_id uuid, source_url text, auth_header text, phase text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select x.id,
           exists (select 1 from stock_push_items it where it.integration_id = x.id and it.status = 'pending' and it.due_at <= now()) as has_pending
    from integrations x
    join integration_sync s on s.integration_id = x.id
    where x.stock_push_enabled and not x.stock_push_locked and x.stock_push_verified_at is not null and x.status = 'connected'
      and s.source_url is not null and not s.paused
      and (x.stock_push_verify
           or exists (select 1 from stock_push_items it where it.integration_id = x.id and it.status = 'pending' and it.due_at <= now()))
      and (x.stock_push_pull_claimed_at is null or x.stock_push_pull_claimed_at < now() - interval '30 seconds')
      and (x.stock_push_pulled_at is null
           or x.stock_push_pulled_at < now() - interval '90 seconds'
           or x.stock_push_pulled_at <= coalesce((select max(r.finished_at) from stock_push_requests r
                                                  where r.integration_id = x.id and r.kind = 'stock' and r.status = 'ok'), '-infinity'))
    order by x.id
    limit least(greatest(p_max_shops, 1), 20)
    for update of x skip locked
  ), taken as (
    update integrations x set stock_push_pull_claimed_at = now() from due where x.id = due.id returning x.id
  )
  select s.integration_id, s.source_url, s.auth_header, case when d.has_pending then 'before_push' else 'after_push' end
  from taken t join due d on d.id = t.id join integration_sync s on s.integration_id = t.id;
end $$;

-- A read that failed counts like a failed request: the numbers wait a minute, the next read is not tried for a minute and a half,
-- and five failures in a row switch write-back off.
create function public.fail_pre_push_pull(p_integration uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations; fails int; msg text := left(coalesce(nullif(btrim(p_error), ''), 'failed'), 200);
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not i.stock_push_enabled then return; end if;
  update stock_push_items set due_at = now() + interval '1 minute', updated_at = now(),
    note = 'Waiting: WorkRelay could not read the shop''s own numbers first. ' || msg
  where integration_id = p_integration and status = 'pending';
  update integrations set stock_push_failures = stock_push_failures + 1, stock_push_pull_claimed_at = now() + interval '1 minute'
  where id = p_integration returning stock_push_failures into fails;
  if fails >= 5 then
    update integrations set stock_push_enabled = false,
      stock_push_paused_reason = 'Switched off after 5 failed requests in a row. Last error: ' || msg where id = p_integration;
    perform cancel_stock_pushes(p_integration, 'Write-back was switched off after repeated failures.');
  end if;
end $$;
revoke execute on function public.claim_pre_push_pulls(int), public.fail_pre_push_pull(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pre_push_pulls(int), public.fail_pre_push_pull(uuid, text) to service_role;

-- ------------------------------------------------------------------------------------------------ sending
create or replace function public.claim_stock_pushes(p_max_shops int default 10)
returns table (request_id uuid, integration_id uuid, store_id text, url text, secret text, items jsonb)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; rid uuid; sec text; its jsonb; n int; stuck record; ids uuid[];
begin
  if pg_try_advisory_xact_lock(hashtext('stock_push_housekeeping'))
     and coalesce((select last_run from maintenance_state where key = 'stock_push_housekeeping'), '-infinity') < now() - interval '10 minutes' then
    delete from stock_push_items where created_at < now() - interval '30 days' and status in ('sent', 'failed', 'skipped', 'cancelled');
    delete from stock_push_requests where created_at < now() - interval '30 days';
    insert into maintenance_state (key, last_run) values ('stock_push_housekeeping', now())
    on conflict (key) do update set last_run = excluded.last_run;
  end if;
  for stuck in select id from stock_push_requests where status = 'sending' and created_at < now() - interval '2 minutes' order by id for update skip locked loop
    perform complete_stock_push(stuck.id, false, null, 'No answer was recorded.');
  end loop;
  -- a shop whose feed address was removed can no longer be read first: it is switched off, not left waiting for ever
  for stuck in
    with gone as (
      update integrations x set stock_push_enabled = false,
        stock_push_paused_reason = 'Switched off: the shop''s product feed address was removed, so WorkRelay cannot read the shop''s numbers before it sends its own.'
      where x.stock_push_enabled and not exists (select 1 from integration_sync s where s.integration_id = x.id and s.source_url is not null)
      returning x.id
    ) select id from gone
  loop
    perform cancel_stock_pushes(stuck.id, 'The product feed address was removed.');
  end loop;

  for i in
    select x.* from integrations x
    where x.stock_push_enabled and not x.stock_push_locked and x.stock_push_verified_at is not null and x.status = 'connected'
      -- the shop's own numbers were read after the last push went out, and not long ago
      and x.stock_push_pulled_at is not null and x.stock_push_pulled_at > now() - interval '2 minutes'
      and x.stock_push_pulled_at > coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = x.id and r.kind = 'stock' and r.status = 'ok'), '-infinity')
      and exists (select 1 from stock_push_items s where s.integration_id = x.id and s.status = 'pending' and s.due_at <= now())
      and not exists (select 1 from stock_push_requests r where r.integration_id = x.id and r.status = 'sending')
      and (select count(*) from stock_push_requests r where r.integration_id = x.id and r.created_at > now() - interval '1 minute') < 20
    order by x.id limit p_max_shops for update of x skip locked
  loop
    select decrypted_secret into sec from vault.decrypted_secrets where id = i.stock_push_secret_id;
    if sec is null then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off: the signing secret is missing.' where id = i.id;
      perform cancel_stock_pushes(i.id, 'The signing secret is missing.');
      continue;
    end if;

    -- every waiting number is recalculated from the numbers just read; a number the owner chose in a conflict is left as chosen
    select array_agg(s.product_id) into ids from stock_push_items s
    where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.reason = 'order';
    if ids is not null then
      update stock_push_items s set stock = e.estimated, updated_at = now()
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and s.stock is distinct from e.estimated
        and e.estimated between 0 and 2147483647;
      update stock_push_items s set status = 'skipped', stock = null, updated_at = now(),
        note = 'The estimate is ' || e.estimated || ', outside what can be sent (0 and up): not sent.'
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and (e.estimated < 0 or e.estimated > 2147483647);
      -- the shop already holds this number (it took the order off its own stock): nothing to say
      update stock_push_items s set status = 'cancelled', note = 'The shop already has this number.', updated_at = now()
      from stock_estimates(i.organization_id, ids) e join products p on p.id = e.product_id
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and e.sold_since = 0 and e.estimated = p.stock;
    end if;

    if not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now()) then continue; end if;

    insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version)
    values (i.organization_id, i.id, 'stock', i.stock_push_url, i.stock_push_secret_version) returning id into rid;
    with picked as (
      select s.id from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now()
      order by s.seq limit 100 for update skip locked
    ), upd as (
      update stock_push_items s set status = 'sending', request_id = rid, attempts = s.attempts + 1, updated_at = now()
      from picked where s.id = picked.id returning s.sku, s.stock, s.seq, s.product_id
    )
    -- with each number: what WorkRelay last read from the shop, so the shop can tell if its own number has moved since
    select coalesce(jsonb_agg(jsonb_build_object('sku', u.sku, 'stock', u.stock, 'seq', u.seq, 'as_of', now(),
                                                  'reported_stock', p.stock, 'reported_at', p.reported_at) order by u.seq), '[]'::jsonb), count(*)
    into its, n from upd u join products p on p.id = u.product_id;
    update stock_push_requests set item_count = n where id = rid;
    request_id := rid; integration_id := i.id; store_id := i.external_store_id; url := i.stock_push_url; secret := sec; items := its;
    return next;
  end loop;
end $$;

-- Success also asks for one more read, to check the shop took the numbers.
create or replace function public.complete_stock_push(p_request uuid, p_ok boolean, p_http int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r stock_push_requests; i integrations; fails int;
begin
  select * into r from stock_push_requests where id = p_request and kind = 'stock' and status = 'sending' for update;
  if not found then return; end if;
  select * into i from integrations where id = r.integration_id for update;
  if p_ok then
    update stock_push_requests set status = 'ok', http_status = p_http, finished_at = now() where id = p_request;
    update stock_push_items set status = 'sent', note = null, updated_at = now() where request_id = p_request and status = 'sending';
    update products p set last_pushed_stock = x.stock, last_pushed_at = now()
    from stock_push_items x where x.request_id = p_request and x.status = 'sent' and x.product_id = p.id;
    update integrations set stock_push_failures = 0, stock_push_verify = true where id = r.integration_id;
  else
    update stock_push_requests set status = 'failed', http_status = p_http, error = left(coalesce(p_error, 'failed'), 300), finished_at = now() where id = p_request;
    update stock_push_items x set status = 'cancelled', note = 'replaced by a newer value', updated_at = now()
    where x.request_id = p_request and x.status = 'sending' and exists (select 1 from stock_push_items y where y.product_id = x.product_id and y.status = 'pending');
    update stock_push_items x set updated_at = now(), note = left(coalesce(p_error, 'failed'), 300),
      status = case when x.attempts >= 3 then 'failed' else 'pending' end,
      due_at = now() + case when x.attempts = 1 then interval '1 minute' else interval '5 minutes' end
    where x.request_id = p_request and x.status = 'sending';
    update integrations set stock_push_failures = stock_push_failures + 1 where id = r.integration_id returning stock_push_failures into fails;
    if fails >= 5 and i.stock_push_enabled then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off after 5 failed requests in a row. Last error: ' || left(coalesce(p_error, 'failed'), 200)
      where id = r.integration_id;
      perform cancel_stock_pushes(r.integration_id, 'Write-back was switched off after repeated failures.');
    end if;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------ conflicts
-- The comparison holds the waiting number of a product whose numbers disagree: nothing is sent over a disagreement.
-- No bare DELETE or UPDATE anywhere: the API role refuses them (see 0044).
create or replace function public.record_stock_conflicts(p_run uuid, p_integration uuid, p_snapshot jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _stock_cmp;
  create temporary table _stock_cmp (product_id uuid, org uuid, sku text, wr bigint, shop int) on commit drop;
  insert into _stock_cmp
  select p.id, p.organization_id, p.sku, (s.value->>'wr')::bigint, p.stock
  from jsonb_each(p_snapshot) s
  join products p on p.id = s.key::uuid
  where p.integration_id = p_integration and p.stock is not null and p.reported_at > (s.value->>'rep')::timestamptz;
  insert into stock_conflicts (organization_id, integration_id, product_id, sku, workrelay_value, shop_value, run_id)
  select org, p_integration, product_id, sku, wr, shop, p_run from _stock_cmp where shop <> wr
  on conflict (product_id) where status = 'open' do update set workrelay_value = excluded.workrelay_value, shop_value = excluded.shop_value,
    detected_at = now(), run_id = excluded.run_id;
  update stock_push_items x set status = 'cancelled', updated_at = now(),
    note = 'Held: the shop reports ' || m.shop || ' but WorkRelay had ' || m.wr || '. The owner decides.'
  from _stock_cmp m where x.product_id = m.product_id and x.status = 'pending' and m.shop <> m.wr;
  update stock_conflicts c set status = 'agreed', decided_at = now()
  from _stock_cmp m where c.product_id = m.product_id and c.status = 'open' and m.shop = m.wr;
  update products p set last_pushed_stock = null, last_pushed_at = null from _stock_cmp m where p.id = m.product_id;
  drop table _stock_cmp;
end $$;

-- 0043's version, with: the comparison covers products that have a number waiting too (a restock the shop has not told us about
-- shows up before WorkRelay overwrites it), what WorkRelay "believes the shop holds" counts a push the shop acknowledged, and any
-- read of the shop's numbers records when the shop was last read.
create or replace function public.run_product_sync(
  p_integration uuid, p_items jsonb, p_source text, p_at timestamptz, p_trigger text, p_by_name text default null, p_by_role text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid; push_on boolean; run uuid := gen_random_uuid(); n int; ids uuid[]; snap jsonb := '{}'::jsonb;
begin
  select organization_id, stock_push_enabled into org, push_on from integrations where id = p_integration;
  if org is null then raise exception 'shop is not connected'; end if;
  delete from product_sync_runs where integration_id = p_integration and created_at < now() - interval '30 days';
  insert into product_sync_runs (id, organization_id, integration_id, source, trigger, by_name, by_role, received, status)
  values (run, org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''),
          case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end, 'ok');
  if push_on then
    select array_agg(q.pid) into ids from (
      select id as pid from products where integration_id = p_integration and last_pushed_at is not null
      union
      select product_id from stock_push_items where integration_id = p_integration and status in ('pending', 'sending')
    ) q;
    if ids is not null then
      select coalesce(jsonb_object_agg(e.product_id, jsonb_build_object(
               'wr', case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of
                          then p.last_pushed_stock - estimated_sold(p.integration_id, p.sku, p.last_pushed_at)
                          else e.estimated end,
               'rep', e.as_of)), '{}'::jsonb)
      into snap from stock_estimates(org, ids) e join products p on p.id = e.product_id;
    end if;
  end if;
  perform set_config('workrelay.sync_run', run::text, true);
  n := apply_product_sync(p_integration, p_items, p_source, p_at);
  perform flush_first_reports(run, p_integration); -- 0035
  perform set_config('workrelay.sync_run', '', true);
  if snap <> '{}'::jsonb then perform record_stock_conflicts(run, p_integration, snap); end if;
  if p_source = 'pull' then
    update integrations set stock_push_pulled_at = greatest(coalesce(stock_push_pulled_at, '-infinity'), p_at),
      stock_push_verify = stock_push_verify and p_at <= coalesce((select max(r.finished_at) from stock_push_requests r
                                                                  where r.integration_id = p_integration and r.kind = 'stock' and r.status = 'ok'), '-infinity')
    where id = p_integration;
  end if;
  update product_sync_runs set changed = (
    select count(*) from (select product_id from stock_events where run_id = run union select product_id from price_events where run_id = run) c
  ) where id = run;
  return n;
end $$;

-- ------------------------------------------------------------------------------------------------ the history, both directions
-- Shop -> WorkRelay (the shop pushed, or WorkRelay read the shop) and WorkRelay -> Shop (a request carrying stock numbers), newest first
-- unless sorted otherwise. "issues" counts the conflicts a read opened, or the numbers a request sent because the owner decided for WorkRelay.
drop function if exists public.list_sync_runs(uuid, uuid, text, boolean, int, int);
create function public.list_sync_runs(
  p_org uuid, p_integration uuid default null, p_sort text default 'time', p_desc boolean default true,
  p_limit int default 25, p_offset int default 0
) returns table (
  id uuid, integration_id uuid, integration_name text, source text, trigger text, by_name text, by_role text,
  received int, changed int, issues int, status text, error text, created_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with u as (
    select r.id, r.integration_id, i.name as integration_name, r.source, r.trigger, r.by_name, r.by_role, r.received, r.changed,
           (select count(*) from stock_conflicts c where c.run_id = r.id)::int as issues, r.status, r.error, r.created_at
    from product_sync_runs r join integrations i on i.id = r.integration_id
    where r.organization_id = p_org and (p_integration is null or r.integration_id = p_integration)
    union all
    select q.id, q.integration_id, i.name, 'send', null::text, null::text, null::text, q.item_count,
           (select count(*) from stock_push_items x where x.request_id = q.id and x.status = 'sent')::int,
           (select count(*) from stock_push_items x where x.request_id = q.id and x.reason = 'conflict')::int,
           case q.status when 'ok' then 'ok' when 'failed' then 'failed' else 'cancelled' end, q.error, q.created_at
    from stock_push_requests q join integrations i on i.id = q.integration_id
    where q.kind = 'stock' and q.status <> 'sending' and q.organization_id = p_org and (p_integration is null or q.integration_id = p_integration)
  )
  select u.id, u.integration_id, u.integration_name, u.source, u.trigger, u.by_name, u.by_role, u.received, u.changed, u.issues, u.status, u.error,
         u.created_at, count(*) over ()
  from u
  order by
    case when p_sort = 'time' and p_desc then u.created_at end desc,
    case when p_sort = 'time' and not p_desc then u.created_at end asc,
    case when p_sort = 'source' and p_desc then u.source end desc,
    case when p_sort = 'source' and not p_desc then u.source end asc,
    case when p_sort = 'shop' and p_desc then lower(u.integration_name) end desc,
    case when p_sort = 'shop' and not p_desc then lower(u.integration_name) end asc,
    case when p_sort = 'by' and p_desc then lower(coalesce(u.by_name, '')) end desc,
    case when p_sort = 'by' and not p_desc then lower(coalesce(u.by_name, '')) end asc,
    case when p_sort = 'products' and p_desc then u.received end desc,
    case when p_sort = 'products' and not p_desc then u.received end asc,
    case when p_sort = 'changes' and p_desc then u.changed end desc,
    case when p_sort = 'changes' and not p_desc then u.changed end asc,
    case when p_sort = 'result' and p_desc then u.status end desc,
    case when p_sort = 'result' and not p_desc then u.status end asc,
    u.created_at desc, u.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.list_sync_runs(uuid, uuid, text, boolean, int, int) from public, anon;
grant execute on function public.list_sync_runs(uuid, uuid, text, boolean, int, int) to authenticated;

-- The disagreements one read of the shop opened, and what was decided about each.
create function public.sync_run_conflicts(p_run uuid)
returns table (sku text, name text, workrelay_value bigint, shop_value int, status text, decided_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select c.sku, p.name, c.workrelay_value, c.shop_value, c.status, c.decided_at
  from stock_conflicts c join products p on p.id = c.product_id
  where c.run_id = p_run
  order by c.detected_at, c.sku
  limit 200
$$;
revoke execute on function public.sync_run_conflicts(uuid) from public, anon;
grant execute on function public.sync_run_conflicts(uuid) to authenticated;

-- Keep the grants of the replaced functions as they were.
revoke execute on function public.claim_stock_pushes(int), public.complete_stock_push(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.claim_stock_pushes(int), public.complete_stock_push(uuid, boolean, int, text) to service_role;
revoke execute on function public.set_stock_push_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_stock_push_enabled(uuid, boolean) to authenticated;
revoke execute on function public.enqueue_stock_pushes(uuid[]), public.record_stock_conflicts(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) to service_role;
