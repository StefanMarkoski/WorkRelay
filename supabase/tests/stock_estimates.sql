-- Estimated stock (0030): off by default, "last report minus the orders since", a new report takes priority, cancelled and
-- earlier orders do not count, other shops do not leak in, and only an owner or admin can switch it.
begin;

create schema es_test;
grant usage on schema es_test to authenticated;
create function es_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function es_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function es_test.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema es_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@es.dev'), ('00000000-0000-0000-0000-0000000000e2', 'member@es.dev'),
  ('00000000-0000-0000-0000-0000000000e3', 'other@es.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Org A', '00000000-0000-0000-0000-0000000000e1'),
  ('a0000000-0000-0000-0000-0000000000e2', 'Org B', '00000000-0000-0000-0000-0000000000e3');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'member'),
  ('a0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'Alpha', 'connected', 'wr_live_e001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'Beta', 'connected', 'wr_live_e002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e2', 'Gamma', 'connected', 'wr_live_e003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000e3');

-- P1: 10 reported at 10:00. P2: stock never reported. P3: same SKU as P1 but in Beta.
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('a2000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'P1', 'Pen', 10, '2026-10-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'P2', 'Cap', null, null),
  ('a2000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2', 'P1', 'Pen', 10, '2026-10-30 10:00+00');
-- o1 is before the report (already in the shop's number); o2 and o3 are after it; o4 is after it but cancelled;
-- o5 is Beta's; o6 is after it and has no placed_at, so its arrival time counts.
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at, created_at) values
  ('a3000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '1', '2026-10-30 09:00+00', 'completed', now(), now()),
  ('a3000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '2', '2026-10-30 11:00+00', 'pending', now(), now()),
  ('a3000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '3', '2026-10-30 12:00+00', 'completed', now(), now()),
  ('a3000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '4', '2026-10-30 13:00+00', 'cancelled', now(), now()),
  ('a3000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2', '5', '2026-10-30 11:00+00', 'completed', now(), now()),
  ('a3000000-0000-0000-0000-0000000000e6', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '6', null, 'completed', now(), '2026-10-30 14:00+00');
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e1', 0, 'P1', 'Pen', 3),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e2', 0, 'P1', 'Pen', 2),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e3', 0, ' P1 ', 'Pen', 1),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e4', 0, 'P1', 'Pen', 5),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e5', 0, 'P1', 'Pen', 4),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e6', 0, 'P1', 'Pen', 1);

select es_test.as_user('00000000-0000-0000-0000-0000000000e1');

select es_test.check('estimating is off by default: no estimates at all',
  (select count(*) = 0 from stock_estimates('a0000000-0000-0000-0000-0000000000e1')));

select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000e1', true);

select es_test.check('last report (10) minus the orders after it that are not cancelled (2 + 1 + 1) = 6, and 4 pieces are counted as sold',
  (select estimated = 6 and sold_since = 4 and as_of = '2026-10-30 10:00+00' from stock_estimates('a0000000-0000-0000-0000-0000000000e1') where product_id = 'a2000000-0000-0000-0000-0000000000e1'));
select es_test.check('only shops with estimating on and only products with a reported stock appear (Beta is off, the Cap has no stock)',
  (select count(*) = 1 from stock_estimates('a0000000-0000-0000-0000-0000000000e1')));
select es_test.check('an order that came before the report is not subtracted again, and another shop''s order with the same SKU is left out',
  (select sold_since = 4 from stock_estimates('a0000000-0000-0000-0000-0000000000e1', array['a2000000-0000-0000-0000-0000000000e1']::uuid[])));

select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000e2', true);
select es_test.check('a second shop is estimated on its own: Beta had one order of 4 after its report',
  (select estimated = 6 and sold_since = 4 from stock_estimates('a0000000-0000-0000-0000-0000000000e1') where product_id = 'a2000000-0000-0000-0000-0000000000e3'));

-- a new report from the shop takes priority: the starting point moves to the new time and the number to the new stock
reset role;
update products set stock = 20, reported_at = '2026-10-30 12:30+00' where id = 'a2000000-0000-0000-0000-0000000000e1';
select es_test.as_user('00000000-0000-0000-0000-0000000000e1');
select es_test.check('after a new report (stock 20 at 12:30), only the orders after 12:30 count: the 14:00 order, so 19',
  (select estimated = 19 and sold_since = 1 from stock_estimates('a0000000-0000-0000-0000-0000000000e1') where product_id = 'a2000000-0000-0000-0000-0000000000e1'));

-- a cancellation gives the stock back by itself, and the same order counted twice changes nothing
reset role;
update orders set status = 'cancelled' where id = 'a3000000-0000-0000-0000-0000000000e6';
select es_test.as_user('00000000-0000-0000-0000-0000000000e1');
select es_test.check('cancelling the last order puts its piece back: 20',
  (select estimated = 20 and sold_since = 0 from stock_estimates('a0000000-0000-0000-0000-0000000000e1') where product_id = 'a2000000-0000-0000-0000-0000000000e1'));

-- switching it off hides the estimates again
select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000e1', false);
select es_test.check('switched off, the shop''s products are no longer estimated',
  (select count(*) = 0 from stock_estimates('a0000000-0000-0000-0000-0000000000e1') where product_id = 'a2000000-0000-0000-0000-0000000000e1'));

-- who may do what
select es_test.as_user('00000000-0000-0000-0000-0000000000e2');
select es_test.fails('a plain member cannot switch estimating on', $$select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000e1', true)$$);
select es_test.as_user('00000000-0000-0000-0000-0000000000e3');
select es_test.fails('someone from another workspace cannot switch it on', $$select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000e1', true)$$);
select es_test.check('and cannot read another workspace''s estimates',
  (select count(*) = 0 from stock_estimates('a0000000-0000-0000-0000-0000000000e1')));

rollback;
select 'STOCK ESTIMATE CHECKS PASSED';
