-- Inventory: products from order lines, apply_product_sync (partial and out-of-order updates), the manual notify_on
-- override, and the sync settings (rate is platform-admin only; the auth header is never readable by tenants).
begin;

create schema inv_test;
grant usage on schema inv_test to authenticated;
create function inv_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function inv_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function inv_test.fails(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', label, sqlstate, sqlerrm; end if;
    raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema inv_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@i.dev'), ('00000000-0000-0000-0000-0000000000f2', 'member@i.dev'),
  ('00000000-0000-0000-0000-0000000000f3', 'super@i.dev'), ('00000000-0000-0000-0000-0000000000f4', 'other@i.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000f1', 'Org A', '00000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-0000000000f2', 'Org B', '00000000-0000-0000-0000-0000000000f4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'member'),
  ('a0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4', 'owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000f3');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'Shop 1', 'connected', 'wr_live_f001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000f1'),
  ('a1000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f2', 'Shop B', 'connected', 'wr_live_f002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000f4');

-- ------------------------------------------------------------------------------------------------ from order lines
insert into orders (id, organization_id, integration_id, external_id, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f1', '1', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity, unit_price_minor) values
  ('a0000000-0000-0000-0000-0000000000f1', 'a3000000-0000-0000-0000-0000000000f1', 0, 'BIKE-1', 'Road bike', 1, 90000),
  ('a0000000-0000-0000-0000-0000000000f1', 'a3000000-0000-0000-0000-0000000000f1', 1, null, 'No sku line', 1, 100),
  ('a0000000-0000-0000-0000-0000000000f1', 'a3000000-0000-0000-0000-0000000000f1', 2, 'NAIL-1', null, 500, 2);
select inv_test.check('order lines with a sku become products, others do not',
  (select count(*) = 2 from products where integration_id = 'a1000000-0000-0000-0000-0000000000f1'));
select inv_test.check('a product from an order has no stock reported and falls back to its sku as name',
  (select stock is null and reported_at is null and name = 'NAIL-1' from products where sku = 'NAIL-1'));
insert into order_items (organization_id, order_id, position, sku, name) values
  ('a0000000-0000-0000-0000-0000000000f1', 'a3000000-0000-0000-0000-0000000000f1', 3, 'BIKE-1', 'Renamed in order');
select inv_test.check('an existing product is not changed by a later order line',
  (select name = 'Road bike' from products where sku = 'BIKE-1'));

-- ------------------------------------------------------------------------------------------------ push needs opt-in
select inv_test.check('push is ignored (-1) until the shop switches it on, and changes nothing',
  apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"BIKE-1","stock":9}]', 'push') = -1
  and (select stock is null from products where sku = 'BIKE-1'));
select inv_test.fails('pull is refused for a shop that is not connected',
  $$select apply_product_sync(gen_random_uuid(), '[]', 'pull')$$);

select inv_test.as_user('00000000-0000-0000-0000-0000000000f2');
select inv_test.fails('a member cannot change the sync source',
  $$select set_sync_source('a1000000-0000-0000-0000-0000000000f1', 'https://shop.example/api/stock', 'Bearer x', true, false)$$, '42501');
reset role;
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_sync_source('a1000000-0000-0000-0000-0000000000f1', 'https://shop.example/api/stock', 'Bearer secret', true, false);
select inv_test.check('the owner can see that a header is set, not what it is',
  (select has_auth_header from integration_sync));
select set_sync_source('a1000000-0000-0000-0000-0000000000f1', 'https://shop.example/api/stock', null, true, false);
reset role;
select inv_test.check('saving with no header value keeps the stored header', (select auth_header = 'Bearer secret' from integration_sync));
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select inv_test.fails('the sync url must be https',
  $$select set_sync_source('a1000000-0000-0000-0000-0000000000f1', 'http://shop.example/x', null, true, false)$$);
select inv_test.check('the owner sees the url but not the auth header',
  (select source_url = 'https://shop.example/api/stock' and push_enabled from integration_sync));
select inv_test.fails('the auth header cannot be selected by a tenant',
  $$select auth_header from integration_sync$$, '42501');
select inv_test.fails('an owner of another workspace cannot set the source',
  $$select set_sync_source('a1000000-0000-0000-0000-0000000000f2', 'https://x.example', null, false, false)$$, '42501');
reset role;

-- ------------------------------------------------------------------------------------------------ partial + out-of-order
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1',
  '[{"sku":"BIKE-1","name":"Road Bike 700c","stock":8,"notify_on":5,"price_minor":95000,"currency":"eur","category":"bikes"}]',
  'push', '2026-10-01 10:00+00');
select inv_test.check('the first report fills the product',
  (select name = 'Road Bike 700c' and stock = 8 and notify_on = 5 and price_minor = 95000 and currency = 'EUR'
          and category = 'bikes' and reported_at = '2026-10-01 10:00+00' from products where sku = 'BIKE-1'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"BIKE-1","stock":7}]', 'push', '2026-10-01 11:00+00');
select inv_test.check('a partial update keeps every field it did not send',
  (select stock = 7 and notify_on = 5 and price_minor = 95000 and category = 'bikes' from products where sku = 'BIKE-1'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"BIKE-1","stock":99,"name":"Stale","unit":"pcs"}]',
  'push', '2026-10-01 09:00+00');
select inv_test.check('an older report fills gaps (unit) but does not overwrite stock or name',
  (select stock = 7 and name = 'Road Bike 700c' and unit = 'pcs' and reported_at = '2026-10-01 11:00+00' from products where sku = 'BIKE-1'));
select inv_test.check('stock changes are recorded, an ignored stale report is not',
  (select count(*) = 2 from stock_events e join products p on p.id = e.product_id where p.sku = 'BIKE-1'));
select inv_test.fails('a price needs a currency',
  $$select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"BIKE-1","price_minor":5}]', 'push')$$);
select inv_test.fails('every item needs a sku',
  $$select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"name":"x"}]', 'push')$$);
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"NAIL-1","stock":12000,"notify_on":5000}]', 'push');
select inv_test.check('a product first seen in an order gets its stock from the shop later',
  (select stock = 12000 and notify_on = 5000 from products where sku = 'NAIL-1'));

-- ------------------------------------------------------------------------------------------------ manual override
select inv_test.as_user('00000000-0000-0000-0000-0000000000f2');
select inv_test.fails('a member cannot set the override',
  $$select set_notify_override((select id from products where sku = 'BIKE-1'), 3)$$, '42501');
reset role;
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_notify_override((select id from products where sku = 'BIKE-1'), 3);
select inv_test.check('the owner sets an override', (select notify_on_override = 3 from products where sku = 'BIKE-1'));
reset role;
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"BIKE-1","notify_on":10}]', 'push');
select inv_test.check('a sync updates the shop value and leaves the override alone',
  (select notify_on = 10 and notify_on_override = 3 from products where sku = 'BIKE-1'));
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_notify_override((select id from products where sku = 'BIKE-1'), 0);
select inv_test.check('an override of 0 clears it so the shop value applies',
  (select notify_on_override is null and notify_on = 10 from products where sku = 'BIKE-1'));
select inv_test.fails('a negative threshold is refused',
  $$select set_notify_override((select id from products where sku = 'BIKE-1'), -1)$$);
reset role;

-- ------------------------------------------------------------------------------------------------ rate: platform admin only
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select inv_test.fails('a tenant owner cannot set the rate',
  $$select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', 15, 1)$$, '42501');
select inv_test.fails('a tenant cannot write the rate directly',
  $$update integration_sync set calls = 1000, days = 1$$, '42501');
reset role;
select inv_test.as_user('00000000-0000-0000-0000-0000000000f3');
select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', 15, 1);
select inv_test.check('the platform admin lists a tenant''s shops with their rate',
  (select count(*) = 1 and bool_and(calls = 15) from admin_list_tenant_shops('a0000000-0000-0000-0000-0000000000f1')));
reset role;
select inv_test.check('15 calls per day: the next sync is about 96 minutes away',
  (select calls = 15 and days = 1 and next_sync_at between now() + interval '95 minutes' and now() + interval '97 minutes'
     from integration_sync));
select inv_test.as_user('00000000-0000-0000-0000-0000000000f3');
select inv_test.fails('faster than one call every 5 minutes is refused',
  $$select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', 300, 1)$$);
select inv_test.fails('calls and days must come together',
  $$select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', 5, null)$$);
select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', 200, 7);
reset role;
select inv_test.check('200 calls per 7 days is about one every 50 minutes',
  (select next_sync_at between now() + interval '50 minutes' and now() + interval '51 minutes' from integration_sync));
select inv_test.as_user('00000000-0000-0000-0000-0000000000f3');
select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000f1', null, null);
reset role;
select inv_test.check('clearing the rate stops the schedule', (select calls is null and next_sync_at is null from integration_sync));
select inv_test.check('setting the rate never touched the url or header the tenant set',
  (select source_url = 'https://shop.example/api/stock' and auth_header = 'Bearer secret' from integration_sync));

-- ------------------------------------------------------------------------------------------------ pull and the schedule
select inv_test.check('a pull works without the push switch',
  apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"PUMP-1","name":"Pump","stock":4}]', 'pull', now()) = 1);
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"PUMP-1","stock":50}]', 'push', now() - interval '1 hour');
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"PUMP-1","stock":3}]', 'pull', now() - interval '2 hours');
select inv_test.check('a pull stamped before a push (request time) cannot overwrite it',
  (select stock = 4 from products where sku = 'PUMP-1'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"PUMP-1","stock":6,"updated_at":"2099-01-01T00:00:00Z"}]', 'push');
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"PUMP-1","stock":7}]', 'push');
select inv_test.check('a timestamp in the future is capped, so it cannot block later reports',
  (select stock = 7 and reported_at <= now() from products where sku = 'PUMP-1'));

insert into integration_sync (integration_id, organization_id, source_url, calls, days, next_sync_at) values
  ('a1000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f2', 'https://b.example/stock', 24, 1,
   now() - interval '1 minute');
create temp table claimed as select * from claim_due_product_syncs(5);
select inv_test.check('a due shop is claimed once, with its url, and its next sync moves one interval ahead',
  (select count(*) = 1 and bool_and(source_url = 'https://b.example/stock') from claimed)
  and (select next_sync_at between now() + interval '59 minutes' and now() + interval '61 minutes'
         from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000f2'));
select inv_test.check('a second tick finds nothing due, so a failing shop cannot exceed its budget',
  (select count(*) = 0 from claim_due_product_syncs(5)));
select record_product_sync('a1000000-0000-0000-0000-0000000000f2', 'timed out');
select inv_test.check('a failure is recorded without counting as a successful sync',
  (select last_error = 'timed out' and last_sync_at is null from integration_sync
    where integration_id = 'a1000000-0000-0000-0000-0000000000f2'));
select record_product_sync('a1000000-0000-0000-0000-0000000000f2', null);
select inv_test.check('a success clears the error and stamps the sync',
  (select last_error is null and last_sync_at is not null from integration_sync
    where integration_id = 'a1000000-0000-0000-0000-0000000000f2'));
update integration_sync set next_sync_at = now() - interval '1 minute', paused = true
  where integration_id = 'a1000000-0000-0000-0000-0000000000f2';
select inv_test.check('a paused shop is never claimed', (select count(*) = 0 from claim_due_product_syncs(5)));

-- ------------------------------------------------------------------------------------------------ reading
insert into order_items (organization_id, order_id, position, sku, name, quantity, unit_price_minor)
  select 'a0000000-0000-0000-0000-0000000000f1', 'a3000000-0000-0000-0000-0000000000f1', 9, 'NAIL-1', 'Nail', 1000, 3;
update orders set currency = 'EUR', placed_at = now() - interval '2 days' where id = 'a3000000-0000-0000-0000-0000000000f1';
select inv_test.as_user('00000000-0000-0000-0000-0000000000f2');
select inv_test.check('the list gives a member every product with its shop',
  (select count(*) >= 3 and bool_and(integration_name = 'Shop 1') from list_products('a0000000-0000-0000-0000-0000000000f1')));
select inv_test.check('price comes from the shop when it reports one (source api)',
  (select price_minor = 95000 and currency = 'EUR' and price_source = 'api' from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'BIKE-1'));
select inv_test.check('without a shop price the latest order line is used (source orders)',
  (select price_minor = 3 and currency = 'EUR' and price_source = 'orders' from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'NAIL-1'));
select inv_test.check('a product with no price anywhere has none',
  (select price_minor is null and price_source is null from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'PUMP-1'));
select inv_test.check('pieces sold in the last 30 days are summed from order lines',
  (select sold_30d = 1500 from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'NAIL-1'));
select inv_test.check('the effective threshold is the shop value: nails 5000, bikes 10, pump none',
  (select bool_and(case sku when 'NAIL-1' then effective_notify_on = 5000 when 'BIKE-1' then effective_notify_on = 10
                            else effective_notify_on is null end)
     from list_products('a0000000-0000-0000-0000-0000000000f1')));
select inv_test.check('low means stock is at or below its threshold: nails 12000 is not low',
  (select not low from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'NAIL-1'));
reset role;
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"NAIL-1","stock":5000}]', 'push');
select inv_test.as_user('00000000-0000-0000-0000-0000000000f2');
select inv_test.check('exactly at the threshold counts as low, and low products are listed first',
  (select low and effective_notify_on = 5000 from list_products('a0000000-0000-0000-0000-0000000000f1') where sku = 'NAIL-1')
  and (select sku = 'NAIL-1' from list_products('a0000000-0000-0000-0000-0000000000f1') limit 1));
select inv_test.check('low-only filters to the low ones',
  (select count(*) = 2 and bool_and(sku in ('NAIL-1', 'BIKE-1')) from list_products('a0000000-0000-0000-0000-0000000000f1', null, null, true)));
select inv_test.check('search matches sku or name, and wildcards are literal',
  (select count(*) = 1 from list_products('a0000000-0000-0000-0000-0000000000f1', 'bike'))
  and (select count(*) = 0 from list_products('a0000000-0000-0000-0000-0000000000f1', '%')));
select inv_test.check('the order list for a product shows the summed quantity',
  (select count(*) = 1 and bool_and(quantity = 1500) from product_orders((select id from products where sku = 'NAIL-1'))));
reset role;
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_notify_override((select id from products where sku = 'NAIL-1'), 6000);
select set_notify_override((select id from products where sku = 'PUMP-1'), 5);
reset role;
select inv_test.as_user('00000000-0000-0000-0000-0000000000f2');
select inv_test.check('an override wins over the shop value, and gives a threshold where the shop sent none',
  (select bool_and(case sku when 'NAIL-1' then effective_notify_on = 6000 and low
                            when 'PUMP-1' then effective_notify_on = 5 and not low else true end)
     from list_products('a0000000-0000-0000-0000-0000000000f1')));
reset role;

-- ------------------------------------------------------------------------------------------------ low-stock automations
delete from low_stock_events;
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'low stock, any shop'),
  ('a4000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1', 'low stock, shop 1 only'),
  ('a4000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f1', 'low stock, another shop only'),
  ('a4000000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-0000000000f1', 'low stock, disabled'),
  ('a4000000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-0000000000f1', 'order created');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000f' || n)::uuid, ('a4000000-0000-0000-0000-0000000000f' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000f1', 1, def
from (values
  (1, '{"trigger":{"type":"low_stock"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"low_stock","integration_ids":["a1000000-0000-0000-0000-0000000000f1"]},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"low_stock","integration_ids":["a1000000-0000-0000-0000-0000000000f2"]},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"low_stock"},"steps":[]}'::jsonb),
  (5, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000f' || right(w.id::text, 1))::uuid
  where organization_id = 'a0000000-0000-0000-0000-0000000000f1' and name like 'low stock%' or name = 'order created';
update workflows set enabled = true where organization_id = 'a0000000-0000-0000-0000-0000000000f1' and id <> 'a4000000-0000-0000-0000-0000000000f4';
delete from workflow_runs;

select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","name":"Widget \"Pro\"","stock":3,"notify_on":5,"unit":"pcs"}]', 'pull', now() - interval '1 hour');
select inv_test.check('the first stock number ever reported never alerts, even when already low (it arms silently)',
  (select count(*) = 0 from low_stock_events) and (select low_alerted from products where sku = 'WIDGET'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":2}]', 'pull', now() - interval '50 minutes');
select inv_test.check('staying low does not alert again', (select count(*) = 0 from low_stock_events));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":9}]', 'pull', now() - interval '40 minutes');
select inv_test.check('stock rising above the threshold re-arms it without alerting',
  (select count(*) = 0 from low_stock_events) and (select not low_alerted from products where sku = 'WIDGET'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":5}]', 'push', now() - interval '30 minutes');
select inv_test.check('reaching the threshold exactly alerts once, with the stock and threshold',
  (select count(*) = 1 and bool_and(stock = 5 and threshold = 5) from low_stock_events));
select inv_test.check('it starts the enabled low-stock automations that cover this shop, and no others',
  (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000f1', 'a4000000-0000-0000-0000-0000000000f2')
      and trigger_source = 'low_stock') from workflow_runs));
select inv_test.check('the run carries the product, its stock, the threshold and the shop',
  (select bool_and(context->'product'->>'name' = 'Widget "Pro"' and context->'product'->>'sku' = 'WIDGET'
      and (context->'product'->>'stock')::int = 5 and (context->'product'->>'threshold')::int = 5
      and context->'product'->>'shop' = 'Shop 1' and context->'event'->>'type' = 'product.low_stock') from workflow_runs));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":4}]', 'push', now() - interval '20 minutes');
select inv_test.check('a further drop while still low alerts nobody', (select count(*) = 1 from low_stock_events));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":1}]', 'push', now() - interval '45 minutes');
select inv_test.check('an older report arriving late changes nothing', (select stock = 4 from products where sku = 'WIDGET') and (select count(*) = 1 from low_stock_events));

select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"WIDGET","stock":20}]', 'push', now() - interval '10 minutes');
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_notify_override((select id from products where sku = 'WIDGET'), 25);
reset role;
select inv_test.check('setting a higher threshold by hand on a product already below it alerts, using the hand-set number',
  (select count(*) = 2 and bool_or(threshold = 25 and stock = 20) from low_stock_events) and (select count(*) = 4 from workflow_runs));
select inv_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_notify_override((select id from products where sku = 'WIDGET'), 0);
reset role;
select inv_test.check('clearing the override falls back to the shop value (5): 20 is not low, so it re-arms quietly',
  (select not low_alerted from products where sku = 'WIDGET') and (select count(*) = 2 from low_stock_events));

select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"NOLIMIT","name":"No threshold","stock":8}]', 'pull', now() - interval '5 minutes');
select apply_product_sync('a1000000-0000-0000-0000-0000000000f1', '[{"sku":"NOLIMIT","stock":0}]', 'pull', now() - interval '4 minutes');
select inv_test.check('a product with no threshold anywhere never alerts, whatever its stock',
  (select count(*) = 0 from low_stock_events e join products p on p.id = e.product_id where p.sku = 'NOLIMIT'));

-- ------------------------------------------------------------------------------------------------ isolation
select inv_test.as_user('00000000-0000-0000-0000-0000000000f4');
select inv_test.check('another workspace sees none of these products', (select count(*) = 0 from products where sku in ('BIKE-1', 'NAIL-1'))
  and (select count(*) = 0 from list_products('a0000000-0000-0000-0000-0000000000f1')));
select inv_test.check('another workspace sees none of this sync config', (select count(*) = 0 from integration_sync
  where integration_id = 'a1000000-0000-0000-0000-0000000000f1'));
reset role;

select 'PASSED' as inventory;
rollback;
