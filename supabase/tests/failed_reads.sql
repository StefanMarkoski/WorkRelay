-- 0050: a read the shop never answered does not count towards "the feed does not list this SKU".
begin;
create schema fr_test;
create function fr_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function fr_test.flush() returns void language plpgsql as $$
begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
-- the claim spaces reads 30 seconds apart and a failure delays the number a minute: the tests step over both
create function fr_test.again() returns void language plpgsql as $$
begin
  update integrations set stock_push_pull_claimed_at = null where true;
  update stock_push_items set due_at = now() where status = 'pending';
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@fr.dev');
insert into organizations (id, name, created_by) values ('b0000000-0000-0000-0000-0000000000a1', 'Org', '00000000-0000-0000-0000-0000000000a1');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock,
                          stock_push_enabled, stock_push_verified_at, stock_push_url, stock_push_secret_id) values
  ('b1000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'Shop', 'connected', 'wr_live_a001', extensions.digest('k1', 'sha256'),
   's1', '00000000-0000-0000-0000-0000000000a1', true, true, now(), 'https://shop.example.com/stock', gen_random_uuid());
insert into integration_sync (integration_id, organization_id, source_url) values
  ('b1000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'https://shop.example.com/feed');
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-0000000000a1', 'P1', 'Pen', 10, '2026-10-30 10:00+00'),
  ('b2000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-0000000000a1', 'P2', 'Cap', 5, '2026-10-30 10:00+00');
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-0000000000a1', 'O1', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-0000000000a1', 0, 'P1', 'x', 3);
select fr_test.flush();
select fr_test.check('a number waits for P1', (select count(*) = 1 and bool_and(status = 'pending' and read_tries = 0) from stock_push_items));

-- three asks that the shop never answered
create temp table fr_a1 as select * from claim_pre_push_pulls();
select fr_test.check('the first ask counts when it is made', (select read_tries = 1 and asked_at is not null from stock_push_items));
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000a1', 'The shop answered with HTTP 502');
select fr_test.check('and is given back when the shop did not answer', (select read_tries = 0 and asked_at is null and status = 'pending' from stock_push_items));
select fr_test.again();
create temp table fr_a2 as select * from claim_pre_push_pulls();
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000a1', 'The shop answered with HTTP 502');
select fr_test.again();
create temp table fr_a3 as select * from claim_pre_push_pulls();
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000a1', 'The shop answered with HTTP 502');
select fr_test.again();
select fr_test.check('after three failed asks the number is still waiting, with the real reason',
  (select read_tries = 0 and status = 'pending' and note like '%could not read the shop''s own numbers first%502%' from stock_push_items));
create temp table fr_a4 as select * from claim_pre_push_pulls();
select fr_test.check('and it is asked for again', (select count(*) = 1 from fr_a4));

-- now the shop answers, but its feed does not list P1: that is what the three tries are for
select run_product_sync('b1000000-0000-0000-0000-0000000000a1', '[{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
select fr_test.again();
create temp table fr_b2 as select * from claim_pre_push_pulls();
select run_product_sync('b1000000-0000-0000-0000-0000000000a1', '[{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
select fr_test.again();
create temp table fr_b3 as select * from claim_pre_push_pulls();
select run_product_sync('b1000000-0000-0000-0000-0000000000a1', '[{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
select fr_test.again();
select fr_test.check('three answered asks without the SKU count', (select read_tries = 3 and status = 'pending' from stock_push_items));
select count(*) from claim_pre_push_pulls();
select fr_test.check('the next claim drops it, saying the feed does not list the SKU',
  (select status = 'cancelled' and note like 'Not sent: the shop''s feed does not list this SKU%' from stock_push_items));

do $$ begin raise notice 'FAILED READS CHECKS PASSED'; end $$;
rollback;
