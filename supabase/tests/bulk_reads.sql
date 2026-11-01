-- More than 100 changed SKUs: the reads and the pushes go out in batches of 100, and every batch is read first.
begin;
create schema bk_test;
create function bk_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function bk_test.flush() returns void language plpgsql as $$
begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
-- reads are spaced 30 seconds apart per shop; the tests step over that
create function bk_test.again() returns void language plpgsql as $$
begin update integrations set stock_push_pull_claimed_at = null where true; end $$;
-- the shop's full feed, every product at 10 (it does not count orders)
create function bk_test.feed() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('sku', sku, 'stock', 10)) from products $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'owner@bk.dev');
insert into organizations (id, name, created_by) values ('b0000000-0000-0000-0000-0000000000b1', 'Org', '00000000-0000-0000-0000-0000000000b1');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock,
                          stock_push_enabled, stock_push_verified_at, stock_push_url, stock_push_secret_id, stock_authority) values
  ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'Shop', 'connected', 'wr_live_b001', extensions.digest('k1', 'sha256'),
   's1', '00000000-0000-0000-0000-0000000000b1', true, true, now(), 'https://shop.example.com/stock', vault.create_secret('test-secret', 'bk-secret'), true);
insert into integration_sync (integration_id, organization_id, source_url) values
  ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'https://shop.example.com/feed');
insert into products (organization_id, integration_id, sku, name, stock, reported_at)
select 'b0000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1', 'S' || g, 'Item ' || g, 10, '2026-10-30 10:00+00' from generate_series(1, 250) g;
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1', 'O1', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity)
select 'b0000000-0000-0000-0000-0000000000b1', 'b3000000-0000-0000-0000-0000000000b1', g, 'S' || g, 'x', 1 from generate_series(1, 250) g;
select bk_test.flush();
select bk_test.check('250 numbers wait', (select count(*) = 250 and bool_and(stock = 9) from stock_push_items where status = 'pending'));

-- ---------------------------------------------------------------- batch 1
create temp table bk_p1 as select * from claim_pre_push_pulls();
select bk_test.check('the first read asks for 100 SKUs', (select count(*) = 1 and bool_and(cardinality(skus) = 100 and phase = 'before_push') from bk_p1));
select run_product_sync('b1000000-0000-0000-0000-0000000000b1', bk_test.feed(), 'pull', now(), 'before_push');
select bk_test.check('no conflict is made of the shop not counting the orders', (select count(*) = 0 from stock_conflicts) and (select count(*) = 0 from stock_suspects));
create temp table bk_c1 as select * from claim_stock_pushes();
select bk_test.check('the first push carries 100 numbers', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 100) from bk_c1));
select complete_stock_push((select request_id from bk_c1), true, 200, null);
create temp table bk_c1b as select * from claim_stock_pushes();
select bk_test.check('the shop sent its whole feed, but that read is older than the push: nothing more goes out on it', (select count(*) = 0 from bk_c1b));

-- ---------------------------------------------------------------- batch 2 and 3
select bk_test.again();
create temp table bk_p2 as select * from claim_pre_push_pulls();
select bk_test.check('so the next 100 are read again', (select count(*) = 1 and bool_and(cardinality(skus) = 100 and phase = 'before_push') from bk_p2));
select bk_test.check('and they are not the ones already sent', (select not (skus && (select array_agg(i->>'sku') from bk_c1, jsonb_array_elements(items) i)) from bk_p2));
select run_product_sync('b1000000-0000-0000-0000-0000000000b1', bk_test.feed(), 'pull', now() + interval '1 second', 'before_push');
create temp table bk_c2 as select * from claim_stock_pushes();
select bk_test.check('the second push carries 100 more', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 100) from bk_c2));
select complete_stock_push((select request_id from bk_c2), true, 200, null);
-- in real life the read was sent before the push finished; the test's clock is frozen, so it is moved back
update stock_push_items set read_at = now() - interval '1 second' where status = 'pending';

select bk_test.again();
create temp table bk_p3 as select * from claim_pre_push_pulls();
select bk_test.check('the last 50 are read', (select count(*) = 1 and bool_and(cardinality(skus) = 50 and phase = 'before_push') from bk_p3));
select run_product_sync('b1000000-0000-0000-0000-0000000000b1', bk_test.feed(), 'pull', now() + interval '2 seconds', 'before_push');
create temp table bk_c3 as select * from claim_stock_pushes();
select bk_test.check('the third push carries the last 50', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 50) from bk_c3));
select complete_stock_push((select request_id from bk_c3), true, 200, null);

select bk_test.check('all 250 were sent, once each', (select count(*) = 250 from stock_push_items where status = 'sent') and (select count(distinct sku) = 250 from stock_push_items where status = 'sent'));
select bk_test.check('and it cost 3 reads of the hourly budget', (select stock_push_reads_used = 3 from integrations));

do $$ begin raise notice 'BULK READS CHECKS PASSED'; end $$;
rollback;
