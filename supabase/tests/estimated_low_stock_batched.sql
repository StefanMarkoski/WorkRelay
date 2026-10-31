-- Estimated low-stock alerts are checked once per transaction, at the end (0037): one order crossing many products is capped at
-- 3 single alerts plus one summary; an order edited to another product re-arms the product it lost; nothing happens before the end.
begin;

create schema eb_test;
create function eb_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function eb_test.flush() returns void language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'owner@eb.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000e9', 'Org A', '00000000-0000-0000-0000-0000000000e9');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('a1000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000e9', 'Estimating', 'connected', 'wr_live_e901', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000e9', true),
  ('a1000000-0000-0000-0000-0000000000f9', 'a0000000-0000-0000-0000-0000000000e9', 'Plain', 'connected', 'wr_live_e902', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000e9', false);
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000e9', 'low stock');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000e9', 'a4000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000e9', 1, '{"trigger":{"type":"low_stock"},"steps":[]}');
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000e9', enabled = true;

-- 50 products of 100 pieces, alert level 5, reported long ago; the same SKUs in the shop that does not estimate
insert into products (organization_id, integration_id, sku, name, stock, notify_on, reported_at)
select 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'S' || g, 'Item ' || lpad(g::text, 2, '0'), 100, 5, '2026-10-30 10:00+00' from generate_series(1, 50) g;
insert into products (organization_id, integration_id, sku, name, stock, notify_on, reported_at)
select 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000f9', 'S' || g, 'Item ' || lpad(g::text, 2, '0'), 100, 5, '2026-10-30 10:00+00' from generate_series(1, 50) g;

-- ONE order with 50 lines, each taking its product to 1 left (an estimate of 1 <= 5), written in a single statement
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at)
values ('a3000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'BIG', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity)
select 'a0000000-0000-0000-0000-0000000000e9', 'a3000000-0000-0000-0000-0000000000e1', g, 'S' || g, 'x', 99 - (g % 3) from generate_series(1, 50) g;

select eb_test.check('nothing is checked before the transaction ends: no event yet, however many lines were written',
  (select count(*) = 0 from low_stock_events));
select eb_test.flush();
select eb_test.check('at the end: 3 single alerts for the lowest estimates, and one summary for the other 47',
  (select count(*) = 3 and bool_and(kind = 'estimated') from low_stock_events where kind = 'estimated')
  and (select count(*) = 1 and bool_and(count = 47 and product_id is null) from low_stock_events where kind = 'estimated_summary'));
select eb_test.check('the three singles are the lowest estimates (1 left), and ties go by name: Items 03, 06 and 09',
  (select array_agg(p.name order by p.name) = array['Item 03', 'Item 06', 'Item 09'] from low_stock_events e join products p on p.id = e.product_id where e.kind = 'estimated'));
select eb_test.check('every crossing is marked, whether it alerted or is in the summary, so none alerts again',
  (select count(*) = 50 and bool_and(low_alerted_estimate) from products where integration_id = 'a1000000-0000-0000-0000-0000000000e9'));
select eb_test.check('the summary names WorkRelay as its source and reads as one message',
  (select count(*) = 1 and bool_and(context->'product'->>'source' = 'WorkRelay (estimated for Estimating)' and context->'product'->>'kind' = 'estimated_summary'
     and context->'product'->>'line' like 'Low stock: 47 more products in Estimating are now estimated to be at or below their alert levels (%, …). See Inventory → Low stock.')
     from workflow_runs where context->'product'->>'kind' = 'estimated_summary'));
select eb_test.check('the shop that does not estimate is untouched', (select count(*) = 0 from products where integration_id = 'a1000000-0000-0000-0000-0000000000f9' and low_alerted_estimate)
  and (select count(*) = 0 from estimate_checks));

-- the budget: a second big order for the same shop within 90 seconds can only add a summary
update products set stock = 100, reported_at = '2026-10-30 12:00+00', low_alerted_estimate = false where integration_id = 'a1000000-0000-0000-0000-0000000000e9' and sku in ('S1', 'S2', 'S3', 'S4', 'S5', 'S6');
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at)
values ('a3000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'BIG2', '2026-10-30 13:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity)
select 'a0000000-0000-0000-0000-0000000000e9', 'a3000000-0000-0000-0000-0000000000e2', g, 'S' || g, 'x', 99 from generate_series(1, 6) g;
select eb_test.flush();
select eb_test.check('a second order inside the window, with the 3 singles used up, adds a summary of 6 and no single alerts',
  (select count(*) = 3 from low_stock_events where kind = 'estimated')
  and (select count(*) = 2 and sum(count) = 53 from low_stock_events where kind = 'estimated_summary'));

-- an order edited to another product re-arms the one it lost
update low_stock_events set occurred_at = now() - interval '10 minutes';
insert into products (id, organization_id, integration_id, sku, name, stock, notify_on, reported_at) values
  ('a2000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'GA', 'Gap A', 30, 10, '2026-10-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'GB', 'Gap B', 30, 10, '2026-10-30 10:00+00');
create function eb_test.items(oid text, sku text, qty int) returns void language plpgsql as $$
begin
  insert into order_items (organization_id, order_id, position, sku, name, quantity)
  values ('a0000000-0000-0000-0000-0000000000e9', ('a3000000-0000-0000-0000-0000000000' || oid)::uuid, 0, sku, 'x', qty);
end $$;
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'X', '2026-10-30 14:00+00', 'pending', now());
select eb_test.items('e3', 'GA', 25);
select eb_test.flush();
select eb_test.check('order X takes Gap A to 5 left: one alert and the flag is on',
  (select count(*) = 1 from low_stock_events e where e.product_id = 'a2000000-0000-0000-0000-0000000000e1')
  and (select low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000e1'));
-- the shop edits the order: it is Gap B now (the items are deleted and written again, in one transaction)
delete from order_items where order_id = 'a3000000-0000-0000-0000-0000000000e3';
select eb_test.items('e3', 'GB', 25);
select eb_test.flush();
select eb_test.check('after the edit Gap A is no longer low, so its flag is cleared (this was the bug: it stayed on)',
  (select not low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000e1')
  and (select low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000e2'));
select eb_test.check('and the edit announced Gap B once and Gap A not again',
  (select count(*) = 1 from low_stock_events where product_id = 'a2000000-0000-0000-0000-0000000000e2')
  and (select count(*) = 1 from low_stock_events where product_id = 'a2000000-0000-0000-0000-0000000000e1'));
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e9', 'a1000000-0000-0000-0000-0000000000e9', 'Y', '2026-10-30 15:00+00', 'pending', now());
select eb_test.items('e4', 'GA', 25);
select eb_test.flush();
select eb_test.check('a genuinely new crossing of Gap A now alerts (a second event for it)',
  (select count(*) = 2 from low_stock_events where product_id = 'a2000000-0000-0000-0000-0000000000e1'));

-- an edit that changes nothing in the end is not announced a second time (delete + insert of the same lines in one transaction)
delete from order_items where order_id = 'a3000000-0000-0000-0000-0000000000e4';
select eb_test.items('e4', 'GA', 25);
select eb_test.flush();
select eb_test.check('rewriting the same lines of an order announces nothing new', (select count(*) = 2 from low_stock_events where product_id = 'a2000000-0000-0000-0000-0000000000e1'));

-- deleting the order's lines altogether re-arms too
delete from order_items where order_id = 'a3000000-0000-0000-0000-0000000000e4';
select eb_test.flush();
select eb_test.check('an order whose lines are all removed lifts the estimate and clears the flag',
  (select not low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000e1'));

rollback;
select 'ESTIMATED LOW STOCK BATCHED CHECKS PASSED';
