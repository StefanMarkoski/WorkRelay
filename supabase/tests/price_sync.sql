-- The price of the latest sync wins (0042), and price changes are recorded per sync run and shown by sync_run_changes.
begin;

create schema ps_test;
grant usage on schema ps_test to authenticated;
create function ps_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function ps_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function ps_test.price() returns bigint language sql as $$ select price_minor from products where sku = 'A' $$;
create function ps_test.last_run() returns uuid language sql as $$ select id from product_sync_runs order by created_at desc, id limit 1 $$;
create function ps_test.sync(items jsonb, src text, at timestamptz, trig text) returns void language plpgsql as $$
begin
  perform run_product_sync('a1000000-0000-0000-0000-0000000000c1', items, src, at, trig);
  -- one transaction means one now(): give each run its own time so "the last run" is well defined
  update product_sync_runs set created_at = clock_timestamp() where created_at = now();
end $$;
grant execute on all functions in schema ps_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@ps.dev'), ('00000000-0000-0000-0000-0000000000c2', 'other@ps.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'Org A', '00000000-0000-0000-0000-0000000000c1'),
  ('a0000000-0000-0000-0000-0000000000c2', 'Org B', '00000000-0000-0000-0000-0000000000c2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Alpha', 'connected', 'wr_live_c001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000c1');

-- 1. first sync: A arrives with a price, B without
select ps_test.sync(
  '[{"sku":"A","name":"Pen","stock":5,"price_minor":1000,"currency":"MKD"},{"sku":"B","name":"Cap","stock":4}]', 'push', now() - interval '3 hours', 'shop');
select ps_test.check('a price that arrives with a new product is stored and logged as first seen',
  ps_test.price() = 1000 and (select count(*) = 1 and bool_and(price_before is null and price_after = 1000 and currency_after = 'MKD') from price_events));
select ps_test.check('the run counts both new products', (select changed = 2 from product_sync_runs where id = ps_test.last_run()));

-- 2. a later sync whose item is dated before the last report: stock is kept (older), the price is taken (latest sync wins)
select ps_test.sync(
  '[{"sku":"A","stock":99,"price_minor":1500,"currency":"MKD","updated_at":"2020-01-01T00:00:00Z"}]', 'push', now() - interval '2 hours', 'shop');
select ps_test.check('an old-dated item does not move stock', (select stock = 5 from products where sku = 'A'));
select ps_test.check('but its price is taken: the latest sync wins', ps_test.price() = 1500);
select ps_test.check('the change is logged with before and after, named for that run',
  (select count(*) = 1 and bool_and(price_before = 1000 and price_after = 1500) from price_events where run_id = ps_test.last_run()));
select ps_test.check('the run counts the product as changed although its stock did not move',
  (select changed = 1 from product_sync_runs where id = ps_test.last_run()));

-- 3. the same price again: nothing to record
select ps_test.sync(
  '[{"sku":"A","price_minor":1500,"currency":"MKD"}]', 'pull', now() - interval '1 hour', 'manual');
select ps_test.check('an unchanged price writes no event and changes nothing',
  (select count(*) = 2 from price_events) and (select changed = 0 from product_sync_runs where id = ps_test.last_run()));

-- 4. a sync with no price leaves the price alone
select ps_test.sync( '[{"sku":"A","stock":7}]', 'pull', now() - interval '30 minutes', 'scheduled');
select ps_test.check('a sync without a price keeps the price and its currency',
  ps_test.price() = 1500 and (select currency = 'MKD' from products where sku = 'A') and (select count(*) = 2 from price_events));

-- 5. only the currency changes
select ps_test.sync( '[{"sku":"A","price_minor":1500,"currency":"EUR"}]', 'push', now() - interval '10 minutes', 'shop');
select ps_test.check('a currency change alone is a price change',
  (select count(*) = 3 and bool_and(true) from price_events) and (select currency = 'EUR' from products where sku = 'A'));

-- reading
select ps_test.as_user('00000000-0000-0000-0000-0000000000c1');
select ps_test.check('sync_run_changes shows the price before and after for the run',
  (select sku = 'A' and price_before = 1500 and price_after = 1500 and currency_before = 'MKD' and currency_after = 'EUR' and stock_before is null
     from sync_run_changes(ps_test.last_run())));
select ps_test.check('and for the first run, stock and price of both products',
  (select count(*) = 2 and count(*) filter (where price_after = 1000 and stock_after = 5) = 1
     from sync_run_changes((select id from product_sync_runs where received = 2 and changed = 2))));
select ps_test.check('the owner sees the price events of the workspace', (select count(*) = 3 from price_events));

select ps_test.as_user('00000000-0000-0000-0000-0000000000c2');
select ps_test.check('another workspace sees none of it',
  (select count(*) = 0 from price_events) and (select count(*) = 0 from sync_run_changes(ps_test.last_run())));

do $$ begin raise notice 'PRICE SYNC CHECKS PASSED'; end $$;
rollback;
