-- A returned order gives its stock back to the estimate (0041), like a cancelled one: the estimate rises, the estimated low-stock alert
-- re-arms, undoing the return takes the stock away again and announces the next crossing. Only the fulfillment status "returned" counts.
begin;

create schema rt_test;
create function rt_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function rt_test.flush() returns void language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;
create function rt_test.est() returns bigint language sql as $$
  select estimated from stock_estimates('a0000000-0000-0000-0000-0000000000b9', array['a2000000-0000-0000-0000-0000000000b9']::uuid[])
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b9', 'owner@rt.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000b9', 'Org', '00000000-0000-0000-0000-0000000000b9');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('a1000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'Estimating', 'connected', 'wr_live_b901', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000b9', true);
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'low stock');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000b9', 'a4000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 1, '{"trigger":{"type":"low_stock"},"steps":[]}');
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000b9', enabled = true;
insert into products (id, organization_id, integration_id, sku, name, stock, notify_on, reported_at) values
  ('a2000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'a1000000-0000-0000-0000-0000000000b9', 'P1', 'Pen', 10, 5, '2026-10-30 10:00+00');

insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at)
values ('a3000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b9', 'a1000000-0000-0000-0000-0000000000b9', 'R1', '2026-10-30 11:00+00', 'completed', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity)
values ('a0000000-0000-0000-0000-0000000000b9', 'a3000000-0000-0000-0000-0000000000b1', 0, 'P1', 'x', 6);
select rt_test.flush();

select rt_test.check('6 sold of 10 gives an estimate of 4 and one estimated alert',
  rt_test.est() = 4 and (select count(*) = 1 from low_stock_events where kind = 'estimated'));

update orders set fulfillment_status = 'partial' where id = 'a3000000-0000-0000-0000-0000000000b1';
select rt_test.flush();
select rt_test.check('a partially fulfilled order still counts as sold', rt_test.est() = 4);

update orders set fulfillment_status = 'returned' where id = 'a3000000-0000-0000-0000-0000000000b1';
select rt_test.flush();
select rt_test.check('marking the order returned gives the 6 back: the estimate is 10 again',
  rt_test.est() = 10 and (select sold_since = 0 from stock_estimates('a0000000-0000-0000-0000-0000000000b9', null)));
select rt_test.check('estimated_sold agrees', estimated_sold('a1000000-0000-0000-0000-0000000000b9', 'P1', '2026-10-30 10:00+00') = 0);
select rt_test.check('the estimated alert is re-armed by the return',
  (select not low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000b9'));
select rt_test.check('the number the shop reported is untouched',
  (select stock = 10 and reported_at = '2026-10-30 10:00+00' from products where id = 'a2000000-0000-0000-0000-0000000000b9'));

update orders set fulfillment_status = 'unfulfilled' where id = 'a3000000-0000-0000-0000-0000000000b1';
select rt_test.flush();
select rt_test.check('undoing the return takes the stock away again: 4, and the crossing is announced a second time',
  rt_test.est() = 4 and (select count(*) = 2 from low_stock_events where kind = 'estimated'));

-- a returned order that arrives already returned (an old order reported late) never counted
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, fulfillment_status, last_event_at)
values ('a3000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b9', 'a1000000-0000-0000-0000-0000000000b9', 'R2', '2026-10-30 12:00+00', 'completed', 'returned', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity)
values ('a0000000-0000-0000-0000-0000000000b9', 'a3000000-0000-0000-0000-0000000000b2', 0, 'P1', 'x', 3);
select rt_test.flush();
select rt_test.check('an order that is returned from the start is not subtracted', rt_test.est() = 4);

do $$ begin raise notice 'RETURN ESTIMATE CHECKS PASSED'; end $$;
rollback;
