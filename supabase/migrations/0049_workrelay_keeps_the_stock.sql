-- WorkRelay can keep a shop's stock itself.
--  * A per-shop setting, off by default, owner only: "WorkRelay keeps the stock". For a shop that does not count its own stock (or should not),
--    the shop's number is no longer a second opinion to settle: it is read and kept in the history, but WorkRelay's number is the one that
--    stands. Orders and returns move it, and the owner can set it by hand (set_product_stock). Every change is sent to the shop.
--  * A shop that counts its own stock keeps the old behaviour: a difference is held, judged again and, if it stays, put to the owner.
--  * In this mode a read takes nothing but the first number of a new product from the shop. Its time is put back so the estimate still counts
--    every order since WorkRelay's number was set. Price, name and the rest are taken as always.

alter table public.integrations add column stock_authority boolean not null default false;
grant select (stock_authority) on public.integrations to authenticated;
alter table public.stock_push_items add column shop_stock int; -- what the shop itself said it held when this number was read first (WorkRelay-keeps mode)

alter table public.stock_events drop constraint stock_events_source_check;
alter table public.stock_events add constraint stock_events_source_check check (source in ('push', 'pull', 'manual'));

create function public.set_stock_authority(p_integration uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'Only the workspace owner can change who keeps the stock.' using errcode = '42501';
  end if;
  update integrations set stock_authority = p_on, updated_at = now() where id = p_integration;
  -- a difference judged under the old rule means nothing under the new one, and neither does a number waiting from it
  delete from stock_suspects where integration_id = p_integration;
  update stock_conflicts set status = 'agreed', decided_at = now() where integration_id = p_integration and status = 'open';
  perform cancel_stock_pushes(p_integration, 'Who keeps the stock was changed.');
end $$;
revoke execute on function public.set_stock_authority(uuid, boolean) from public, anon;
grant execute on function public.set_stock_authority(uuid, boolean) to authenticated;

-- The owner or an admin sets a count by hand (a delivery, a correction). It becomes WorkRelay's number now, is logged, and is sent to the shop.
create function public.set_product_stock(p_product uuid, p_stock int) returns void
language plpgsql security definer set search_path = public as $$
declare pr products; keeps boolean; before_stock bigint;
begin
  select * into pr from products where id = p_product for update;
  if not found or not has_org_role(pr.organization_id, array['owner', 'admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select stock_authority into keeps from integrations where id = pr.integration_id;
  if not keeps then raise exception 'WorkRelay keeps the stock for this shop only when that is switched on in Edit shop.'; end if;
  if p_stock is null or p_stock < 0 or p_stock > 1000000000 then raise exception 'Enter a whole number from 0 up.'; end if;
  select e.estimated into before_stock from stock_estimates(pr.organization_id, array[p_product]) e;
  update products set stock = p_stock, reported_at = now(), updated_at = now() where id = p_product;
  insert into stock_events (organization_id, product_id, stock_before, stock_after, source)
  values (pr.organization_id, pr.id, coalesce(before_stock, pr.stock)::int, p_stock, 'manual');
  perform enqueue_stock_pushes(array[p_product]);
end $$;
revoke execute on function public.set_product_stock(uuid, int) from public, anon;
grant execute on function public.set_product_stock(uuid, int) to authenticated;

create or replace function public.claim_stock_pushes(p_max_shops int default 10)
returns table (request_id uuid, integration_id uuid, store_id text, url text, secret text, items jsonb)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; rid uuid; sec text; its jsonb; n int; stuck record; ids uuid[]; only_solo boolean; lim int; lastfin timestamptz;
begin
  perform settle_stock_suspects();
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
      -- some waiting number has been read in the shop's own answer: after the last push went out, and not long ago
      and exists (select 1 from stock_push_items s where s.integration_id = x.id and s.status = 'pending' and s.due_at <= now()
                  and s.read_at is not null and s.read_at > now() - interval '2 minutes'
                  and s.read_at > coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = x.id and r.kind = 'stock' and r.status = 'ok'), '-infinity'))
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
    lastfin := coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = i.id and r.kind = 'stock' and r.status = 'ok'), '-infinity');
    select array_agg(s.product_id) into ids from stock_push_items s
    where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.reason = 'order'
      and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin;
    if ids is not null then
      update stock_push_items s set stock = e.estimated, updated_at = now()
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and s.stock is distinct from e.estimated
        and e.estimated between 0 and 2147483647;
      update stock_push_items s set status = 'skipped', stock = null, updated_at = now(),
        note = 'The estimate is ' || e.estimated || ', outside what can be sent (0 and up): not sent.'
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and (e.estimated < 0 or e.estimated > 2147483647);
      -- the shop already holds this number (it took the order off its own stock, or WorkRelay keeps the stock and the shop was sent it before): nothing to say
      update stock_push_items s set status = 'cancelled', note = 'The shop already has this number.', updated_at = now()
      from stock_estimates(i.organization_id, ids) e join products p on p.id = e.product_id
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order'
        and case when i.stock_authority then s.shop_stock is not distinct from e.estimated and s.shop_stock is not null
                 else e.sold_since = 0 and e.estimated = p.stock end;
    end if;

    if not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now()
                   and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin) then continue; end if;

    -- numbers the shop refused as part of a batch are sent one at a time, after the normal ones
    only_solo := not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and not s.solo
                             and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin);
    lim := case when only_solo then 1 else 100 end;
    insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version)
    values (i.organization_id, i.id, 'stock', i.stock_push_url, i.stock_push_secret_version) returning id into rid;
    with picked as (
      select s.id from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.solo = only_solo
        and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin
      order by s.seq limit lim for update skip locked
    ), upd as (
      update stock_push_items s set status = 'sending', request_id = rid, attempts = s.attempts + 1, updated_at = now()
      from picked where s.id = picked.id returning s.sku, s.stock, s.seq, s.product_id, s.shop_stock
    )
    -- with each number: what WorkRelay last read from the shop, so the shop can tell if its own number has moved since
    select coalesce(jsonb_agg(jsonb_build_object('sku', u.sku, 'stock', u.stock, 'seq', u.seq, 'as_of', now(),
                                                  'reported_stock', case when i.stock_authority then coalesce(u.shop_stock, p.stock) else p.stock end, 'reported_at', p.reported_at) order by u.seq), '[]'::jsonb), count(*)
    into its, n from upd u join products p on p.id = u.product_id;
    update stock_push_requests set item_count = n where id = rid;
    request_id := rid; integration_id := i.id; store_id := i.external_store_id; url := i.stock_push_url; secret := sec; items := its;
    return next;
  end loop;
end $$;

create or replace function public.run_product_sync(
  p_integration uuid, p_items jsonb, p_source text, p_at timestamptz, p_trigger text, p_by_name text default null, p_by_role text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid; push_on boolean; keeps boolean; run uuid := gen_random_uuid(); n int; ids uuid[]; snap jsonb := '{}'::jsonb;
  items jsonb := p_items; held jsonb := '{}'::jsonb;
begin
  select organization_id, stock_push_enabled, stock_authority into org, push_on, keeps from integrations where id = p_integration;
  if org is null then raise exception 'shop is not connected'; end if;
  delete from product_sync_runs where integration_id = p_integration and created_at < now() - interval '30 days';
  insert into product_sync_runs (id, organization_id, integration_id, source, trigger, by_name, by_role, received, status)
  values (run, org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''),
          case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end, 'ok');
  if keeps and jsonb_typeof(p_items) = 'array' then
    -- WorkRelay keeps this shop's stock: the number the shop reports is read and remembered for the history, but it never replaces
    -- WorkRelay's. A product WorkRelay has no number for yet takes the first one. The report's time is put back too, because the
    -- estimate counts the orders placed after it.
    select coalesce(jsonb_object_agg(p.sku, p.reported_at), '{}'::jsonb) into held
    from products p where p.integration_id = p_integration and p.stock is not null and p.reported_at is not null
      and p.sku in (select left(nullif(btrim(e->>'sku'), ''), 200) from jsonb_array_elements(p_items) e);
    select coalesce(jsonb_agg(case when jsonb_exists(held, left(nullif(btrim(e->>'sku'), ''), 200)) then e - 'stock' else e end), '[]'::jsonb)
    into items from jsonb_array_elements(p_items) e;
  end if;
  if push_on and not keeps then
    select array_agg(q.pid) into ids from (
      select id as pid from products where integration_id = p_integration and last_pushed_at is not null
      union
      select product_id from stock_push_items where integration_id = p_integration and status in ('pending', 'sending')
    ) q;
    if ids is not null then
      -- What WorkRelay believed the shop held AT THE MOMENT THE SHOP WAS ASKED (p_at): an order placed after that cannot be in the shop's
      -- answer, so it is left out of the comparison, the same way the new baseline leaves it out of the estimate. Without this, an order
      -- that reached WorkRelay while the answer was on its way would look like a disagreement.
      -- 'base' and 'since' say where WorkRelay's belief started (the shop's last report, or a push the shop acknowledged); the belief at the
      -- moment of asking is base less the orders placed between 'since' and p_at. They are kept with a suspected difference, so it can be
      -- judged again later with the orders that arrived in between.
      select coalesce(jsonb_object_agg(e.product_id, jsonb_build_object(
               'base', b.base, 'since', b.since,
               'wr', b.base - (estimated_sold(p.integration_id, p.sku, b.since) - estimated_sold(p.integration_id, p.sku, p_at)),
               'rep', e.as_of)), '{}'::jsonb)
      into snap
      from stock_estimates(org, ids) e
      join products p on p.id = e.product_id
      cross join lateral (select case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of then p.last_pushed_stock else p.stock end as base,
                                 case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of then p.last_pushed_at else e.as_of end as since) b;
    end if;
  end if;
  perform set_config('workrelay.sync_run', run::text, true);
  n := apply_product_sync(p_integration, items, p_source, p_at);
  if held <> '{}'::jsonb then
    update products p set reported_at = (held->>p.sku)::timestamptz
    where p.integration_id = p_integration and jsonb_exists(held, p.sku);
  end if;
  perform flush_first_reports(run, p_integration); -- 0035
  perform set_config('workrelay.sync_run', '', true);
  if snap <> '{}'::jsonb then perform record_stock_conflicts(run, p_integration, snap, p_at); end if;
  if push_on and jsonb_typeof(p_items) = 'array' then
    -- every waiting number whose SKU was in this answer has now been read: the shop's own number was compared with WorkRelay's
    update stock_push_items s set read_at = greatest(coalesce(s.read_at, '-infinity'), p_at),
      shop_stock = case when keeps then k.stock else s.shop_stock end
    from (select distinct nullif(btrim(e->>'sku'), '') as sku, (e->>'stock')::int as stock from jsonb_array_elements(p_items) e) k
    where s.integration_id = p_integration and s.status = 'pending' and s.sku = k.sku;
  end if;
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
    delete from product_sync_runs r where r.id = run and r.changed = 0 and not exists (select 1 from stock_conflicts c where c.run_id = r.id)
      and not exists (select 1 from stock_suspects z where z.run_id = r.id);
  end if;
  return n;
end $$;

revoke execute on function public.claim_stock_pushes(int) from public, anon, authenticated;
grant execute on function public.claim_stock_pushes(int) to service_role;
revoke execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) to service_role;
