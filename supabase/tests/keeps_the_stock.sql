-- WorkRelay keeps the stock (0049): for a shop set up that way the shop's own number never replaces WorkRelay's, a difference is no conflict,
-- WorkRelay's number is sent, and the owner or an admin can set a count by hand.
begin;

create schema ks_test;
grant usage on schema ks_test to authenticated;
create function ks_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function ks_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function ks_test.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function ks_test.flush() returns void language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;
grant execute on all functions in schema ks_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@ks.dev'), ('00000000-0000-0000-0000-0000000000f2', 'admin@ks.dev'),
  ('00000000-0000-0000-0000-0000000000f3', 'member@ks.dev');
insert into organizations (id, name, created_by) values ('b0000000-0000-0000-0000-0000000000f1', 'Org', '00000000-0000-0000-0000-0000000000f1');
insert into memberships values
  ('b0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('b0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'admin'),
  ('b0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3', 'member');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('b1000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000f1', 'Shop', 'connected', 'wr_live_f001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000f1', true);
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000f1', 'P1', 'Pen', 10, '2026-10-30 10:00+00'),
  ('b2000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000f1', 'P2', 'Cap', 5, '2026-10-30 10:00+00');

select ks_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_stock_push_url('b1000000-0000-0000-0000-0000000000f1', 'https://shop.example.com/workrelay/stock');
select length(rotate_stock_push_secret('b1000000-0000-0000-0000-0000000000f1'));
reset role;
update integrations set stock_push_verified_at = now() where id = 'b1000000-0000-0000-0000-0000000000f1';
insert into integration_sync (integration_id, organization_id, source_url) values
  ('b1000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000f1', 'https://shop.example.com/feed');
select ks_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000f1', true);

-- ---------------------------------------------------------------- who may change the setting
select ks_test.as_user('00000000-0000-0000-0000-0000000000f2');
select ks_test.check('an admin cannot change who keeps the stock', ks_test.err($$select set_stock_authority('b1000000-0000-0000-0000-0000000000f1', true)$$) like 'Only the workspace owner%');
select ks_test.as_user('00000000-0000-0000-0000-0000000000f1');
select ks_test.check('and a count cannot be set while the shop keeps its own',
  ks_test.err($$select set_product_stock('b2000000-0000-0000-0000-0000000000f1', 4)$$) like 'WorkRelay keeps the stock for this shop only%');
select set_stock_authority('b1000000-0000-0000-0000-0000000000f1', true);
reset role;
select ks_test.check('the owner switches it on', (select stock_authority from integrations where id = 'b1000000-0000-0000-0000-0000000000f1'));

-- ---------------------------------------------------------------- an order, and a shop that never counted it
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000f1', 'O1', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000f1', 'b3000000-0000-0000-0000-0000000000f1', 0, 'P1', 'x', 3);
select ks_test.flush();
select ks_test.check('the order queues 10 - 3 = 7', (select count(*) = 1 and bool_and(stock = 7 and status = 'pending') from stock_push_items));
create temp table ks_pulls as select * from claim_pre_push_pulls();
select ks_test.check('the shop is read first, as always', (select count(*) = 1 from ks_pulls));
-- the shop does not subtract orders: it still says 10, and has a new price for the pen
select run_product_sync('b1000000-0000-0000-0000-0000000000f1', '[{"sku":"P1","stock":10,"price_minor":900,"currency":"mkd"},{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
select ks_test.check('WorkRelay''s number stays 10 and the time of its count is kept', (select stock = 10 and reported_at = '2026-10-30 10:00+00' from products where sku = 'P1'));
select ks_test.check('the price from the same answer is taken', (select price_minor = 900 from products where sku = 'P1'));
select ks_test.check('no suspect and no conflict: the difference is not a disagreement', (select count(*) = 0 from stock_suspects) and (select count(*) = 0 from stock_conflicts));
select ks_test.check('what the shop said is kept with the waiting number', (select shop_stock = 10 and status = 'pending' and stock = 7 from stock_push_items where sku = 'P1'));
create temp table ks_c1 as select * from claim_stock_pushes();
select ks_test.check('the number 7 is sent, and the request says the shop held 10',
  (select count(*) = 1 and bool_and((items->0->>'stock')::int = 7 and (items->0->>'reported_stock')::int = 10) from ks_c1));
select complete_stock_push((select request_id from ks_c1), true, 200, null);

-- ---------------------------------------------------------------- the shop takes it; the next read says 7: nothing more to send
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000f1', 'O2', '2026-10-30 12:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000f1', 'b3000000-0000-0000-0000-0000000000f2', 0, 'P1', 'x', 1);
select ks_test.flush();
select ks_test.check('a second order queues 6', (select count(*) = 1 and bool_and(stock = 6) from stock_push_items where status = 'pending'));
update stock_push_items set read_at = null where status = 'pending';
-- the shop now holds 6 already (it took the push, and the new order): nothing to say
select run_product_sync('b1000000-0000-0000-0000-0000000000f1', '[{"sku":"P1","stock":6}]', 'pull', now() + interval '1 second', 'before_push');
create temp table ks_c2 as select * from claim_stock_pushes();
select ks_test.check('when the shop says the same number as the estimate nothing is sent',
  (select count(*) = 0 from ks_c2) and (select count(*) = 1 from stock_push_items where sku = 'P1' and status = 'cancelled' and note = 'The shop already has this number.' and stock = 6));

-- ---------------------------------------------------------------- the shop's own push does not take WorkRelay's count either
select run_product_sync('b1000000-0000-0000-0000-0000000000f1', '[{"sku":"P2","stock":99}]', 'push', now(), 'shop');
select ks_test.check('a shop''s own push of another number changes nothing', (select stock = 5 from products where sku = 'P2'));
select run_product_sync('b1000000-0000-0000-0000-0000000000f1', '[{"sku":"P3","name":"Bag","stock":8}]', 'push', now(), 'shop');
select ks_test.check('a product WorkRelay has no number for takes the shop''s first', (select stock = 8 from products where sku = 'P3'));

-- ---------------------------------------------------------------- setting a count by hand
select ks_test.as_user('00000000-0000-0000-0000-0000000000f3');
select ks_test.check('a member cannot set a count', ks_test.err($$select set_product_stock('b2000000-0000-0000-0000-0000000000f2', 4)$$) = 'forbidden');
select ks_test.as_user('00000000-0000-0000-0000-0000000000f2');
select ks_test.check('a count must be a whole number from 0 up', ks_test.err($$select set_product_stock('b2000000-0000-0000-0000-0000000000f2', -1)$$) like 'Enter a whole number%');
select set_product_stock('b2000000-0000-0000-0000-0000000000f2', 20);
reset role;
select ks_test.flush();
select ks_test.check('an admin sets 20: it is WorkRelay''s number now, with a log line',
  (select stock = 20 from products where sku = 'P2') and (select count(*) = 1 from stock_events e join products p on p.id = e.product_id where p.sku = 'P2' and e.source = 'manual' and e.stock_before = 5 and e.stock_after = 20));
select ks_test.check('and it is queued for the shop', (select count(*) = 1 from stock_push_items where sku = 'P2' and status = 'pending' and stock = 20));

-- ---------------------------------------------------------------- switching the rule back clears what the old rule left
select ks_test.as_user('00000000-0000-0000-0000-0000000000f1');
select set_stock_authority('b1000000-0000-0000-0000-0000000000f1', false);
reset role;
select ks_test.check('switching it off cancels the waiting numbers', (select count(*) = 0 from stock_push_items where status = 'pending'));

do $$ begin raise notice 'KEEPS THE STOCK CHECKS PASSED'; end $$;
rollback;
