-- 0047: three loose ends from the write-back audit.
--  * A shop that refuses a request with a 4xx (usually one SKU it does not know) no longer fails the whole batch: the numbers are sent one at a
--    time, and only the SKU it refuses is given up on. A split is not counted as a failed request; a single number refused is.
--  * The shop's stock address is not readable by every member of the workspace any more (it may carry a token in its path). Members see only
--    whether one is set; the owner reads it through get_stock_push_url.
--  * Tightening of the pull-first read: it compares the shop's answer with what WorkRelay believed AT THE MOMENT THE SHOP WAS ASKED, so an order
--    that reached WorkRelay while the answer was on its way is not a disagreement; and a quiet read that found nothing leaves no row in the history.
--  * No bare DELETE or UPDATE (see 0044).

alter table public.stock_push_items add column solo boolean not null default false;

alter table public.integrations add column stock_push_has_url boolean generated always as (stock_push_url is not null) stored;
grant select (stock_push_has_url) on public.integrations to authenticated;
revoke select (stock_push_url) on public.integrations from authenticated;

create function public.get_stock_push_url(p_integration uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return i.stock_push_url;
end $$;
revoke execute on function public.get_stock_push_url(uuid) from public, anon;
grant execute on function public.get_stock_push_url(uuid) to authenticated;

create or replace function public.claim_stock_pushes(p_max_shops int default 10)
returns table (request_id uuid, integration_id uuid, store_id text, url text, secret text, items jsonb)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; rid uuid; sec text; its jsonb; n int; stuck record; ids uuid[]; only_solo boolean; lim int;
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

    -- numbers the shop refused as part of a batch are sent one at a time, after the normal ones
    only_solo := not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and not s.solo);
    lim := case when only_solo then 1 else 100 end;
    insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version)
    values (i.organization_id, i.id, 'stock', i.stock_push_url, i.stock_push_secret_version) returning id into rid;
    with picked as (
      select s.id from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.solo = only_solo
      order by s.seq limit lim for update skip locked
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

create or replace function public.complete_stock_push(p_request uuid, p_ok boolean, p_http int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r stock_push_requests; i integrations; fails int; refused boolean;
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
    refused := p_http between 400 and 499 and p_http not in (408, 429);
    if refused and r.item_count > 1 then
      -- the shop refused the batch, perhaps over one SKU it does not know: each number is sent on its own, so only that one fails.
      -- This is not counted as a failed request, and no try is used up.
      update stock_push_items x set status = 'pending', solo = true, due_at = now(), updated_at = now(), attempts = greatest(x.attempts - 1, 0),
        note = 'The shop refused the batch (HTTP ' || p_http || '): sending this number on its own.'
      where x.request_id = p_request and x.status = 'sending';
      return;
    elsif refused then
      -- a number the shop refuses on its own is not retried: trying again would get the same answer
      update stock_push_items x set status = 'failed', updated_at = now(), note = 'The shop does not accept this number (HTTP ' || p_http || ').'
      where x.request_id = p_request and x.status = 'sending';
    else
      update stock_push_items x set updated_at = now(), note = left(coalesce(p_error, 'failed'), 300),
        status = case when x.attempts >= 3 then 'failed' else 'pending' end,
        due_at = now() + case when x.attempts = 1 then interval '1 minute' else interval '5 minutes' end
      where x.request_id = p_request and x.status = 'sending';
    end if;
    update integrations set stock_push_failures = stock_push_failures + 1 where id = r.integration_id returning stock_push_failures into fails;
    if fails >= 5 and i.stock_push_enabled then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off after 5 failed requests in a row. Last error: ' || left(coalesce(p_error, 'failed'), 200)
      where id = r.integration_id;
      perform cancel_stock_pushes(r.integration_id, 'Write-back was switched off after repeated failures.');
    end if;
  end if;
end $$;

revoke execute on function public.claim_stock_pushes(int), public.complete_stock_push(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.claim_stock_pushes(int), public.complete_stock_push(uuid, boolean, int, text) to service_role;

-- The read of the shop: as in 0046, with the two changes above.
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
      -- What WorkRelay believed the shop held AT THE MOMENT THE SHOP WAS ASKED (p_at): an order placed after that cannot be in the shop's
      -- answer, so it is left out of the comparison, the same way the new baseline leaves it out of the estimate. Without this, an order
      -- that reached WorkRelay while the answer was on its way would look like a disagreement.
      select coalesce(jsonb_object_agg(e.product_id, jsonb_build_object(
               'wr', case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of
                          then p.last_pushed_stock - (estimated_sold(p.integration_id, p.sku, p.last_pushed_at) - estimated_sold(p.integration_id, p.sku, p_at))
                          else e.estimated + estimated_sold(p.integration_id, p.sku, p_at) end,
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
  -- the quiet reads around a push write a row only when they found something: a change, or a disagreement. Otherwise a busy shop would
  -- fill its history with "0 changed".
  if p_trigger in ('before_push', 'after_push') then
    delete from product_sync_runs r where r.id = run and r.changed = 0 and not exists (select 1 from stock_conflicts c where c.run_id = r.id);
  end if;
  return n;
end $$;

revoke execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) to service_role;
