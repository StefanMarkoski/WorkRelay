-- Low-stock alerts on the estimated stock (0033): a crossing caused by orders alerts once, a cancellation re-arms it, an edited order
-- does not alert twice, the shop's own report resets it, a product already low is not announced again, shops that do not estimate
-- are untouched, every low-stock automation covering an estimating shop receives its estimates, and saved automations are upgraded.
begin;

create schema el_test;
create function el_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@el.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000d1', 'Org A', '00000000-0000-0000-0000-0000000000d1');
insert into memberships values ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Estimating', 'connected', 'wr_live_d001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000d1', true),
  ('a1000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'Plain', 'connected', 'wr_live_d002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000d1', false);

-- P1: 10 pieces, alert at 5. P3: already low by the shop's own number. P2: the same as P1 in the shop that does not estimate.
insert into products (id, organization_id, integration_id, sku, name, stock, notify_on, reported_at) values
  ('a2000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'P1', 'Pen', 10, 5, '2026-10-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d2', 'P1', 'Pen', 10, 5, '2026-10-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'P3', 'Cap', 3, 5, '2026-10-30 10:00+00');

-- two low-stock automations: one for every shop, one for the shop that does not estimate (so it can only ever get real numbers)
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'every shop'),
  ('a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'plain shop only');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000d1', 'a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"low_stock"},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000d2', 'a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"low_stock","integration_ids":["a1000000-0000-0000-0000-0000000000d2"]},"steps":[]}');
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000d1' where id = 'a4000000-0000-0000-0000-0000000000d1';
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000d2' where id = 'a4000000-0000-0000-0000-0000000000d2';
update workflows set enabled = true;

create function el_test.order_of(oid text, shop text, sku text, qty int, at text) returns void language plpgsql as $$
begin
  insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at)
  values (('a3000000-0000-0000-0000-0000000000' || oid)::uuid, 'a0000000-0000-0000-0000-0000000000d1', ('a1000000-0000-0000-0000-0000000000' || shop)::uuid, oid, at::timestamptz, 'pending', now());
  insert into order_items (organization_id, order_id, position, sku, name, quantity)
  values ('a0000000-0000-0000-0000-0000000000d1', ('a3000000-0000-0000-0000-0000000000' || oid)::uuid, 0, sku, 'x', qty);
end $$;

select el_test.order_of('a1', 'd1', 'P1', 3, '2026-10-30 11:00+00');
select el_test.check('3 sold leaves an estimate of 7, above the alert level: no event',
  (select count(*) = 0 from low_stock_events));

select el_test.order_of('a2', 'd1', 'P1', 3, '2026-10-30 12:00+00');
select el_test.check('6 sold takes the estimate to 4, at or below 5: one estimated event, with the estimate as its stock',
  (select count(*) = 1 and bool_and(kind = 'estimated' and stock = 4 and threshold = 5 and product_id = 'a2000000-0000-0000-0000-0000000000d1') from low_stock_events));
select el_test.check('the automation that covers the estimating shop receives it, naming WorkRelay as the source; the one for the other shop does not',
  (select count(*) = 1 and bool_and(workflow_id = 'a4000000-0000-0000-0000-0000000000d1' and context->'product'->>'estimated' = 'true'
     and context->'product'->>'source' = 'WorkRelay (estimated for Estimating)' and (context->'product'->>'stock')::int = 4) from workflow_runs));

select el_test.order_of('a3', 'd1', 'P1', 1, '2026-10-30 13:00+00');
select el_test.check('another order while it is still low does not alert again',
  (select count(*) = 1 from low_stock_events));

update orders set status = 'cancelled' where id = 'a3000000-0000-0000-0000-0000000000a2';
select el_test.check('cancelling the order that tipped it lifts the estimate to 6 and re-arms the alert',
  (select not low_alerted_estimate from products where id = 'a2000000-0000-0000-0000-0000000000d1'));

select el_test.order_of('a4', 'd1', 'P1', 2, '2026-10-30 14:00+00');
select el_test.check('the next crossing alerts again: a second estimated event, estimate 4',
  (select count(*) = 2 and count(*) filter (where stock = 4) = 2 from low_stock_events where kind = 'estimated'));

delete from order_items where order_id = 'a3000000-0000-0000-0000-0000000000a4';
insert into order_items (organization_id, order_id, position, sku, name, quantity)
values ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000a4', 0, 'P1', 'x', 2);
select el_test.check('an edited order (items deleted and written again) does not announce the same crossing twice',
  (select count(*) = 2 from low_stock_events where kind = 'estimated'));

-- the shop reports again: the estimate starts over from the real number
update products set stock = 20, reported_at = '2026-10-30 15:00+00' where id = 'a2000000-0000-0000-0000-0000000000d1';
select el_test.check('a report from the shop clears the estimate flag (and, being above the level, sends no real alert)',
  (select not low_alerted_estimate and not low_alerted from products where id = 'a2000000-0000-0000-0000-0000000000d1')
  and (select count(*) = 0 from low_stock_events where kind = 'reported'));
select el_test.order_of('a5', 'd1', 'P1', 17, '2026-10-30 16:00+00');
select el_test.check('after the report, 17 more sold is a new crossing (estimate 3): the third estimated event',
  (select count(*) = 3 from low_stock_events where kind = 'estimated') and (select count(*) = 1 from low_stock_events where kind = 'estimated' and stock = 3));

select el_test.order_of('a6', 'd1', 'P3', 1, '2026-10-30 12:00+00');
select el_test.check('a product that is already low by the shop''s own number is not announced again on its estimate',
  (select count(*) = 3 from low_stock_events where kind = 'estimated'));

select el_test.order_of('a7', 'd2', 'P1', 9, '2026-10-30 12:00+00');
select el_test.check('a shop that does not estimate gets no estimated alerts',
  (select count(*) = 3 from low_stock_events where kind = 'estimated'));

-- the alert on the shop's real numbers still works, and names the shop as its source
delete from workflow_runs;
update products set stock = 4 where id = 'a2000000-0000-0000-0000-0000000000d1';
select el_test.check('a real report that crosses the level is a reported event whose source is the shop''s own name',
  (select count(*) = 1 and bool_and(kind = 'reported') from low_stock_events where kind = 'reported')
  and (select count(*) = 1 and bool_and(workflow_id = 'a4000000-0000-0000-0000-0000000000d1' and context->'product'->>'estimated' = 'false' and context->'product'->>'source' = 'Estimating') from workflow_runs));

-- automations saved before this change get the new message as a new version
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000d1', 'old discord'),
  ('a4000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000d1', 'old generic'),
  ('a4000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000d1', 'with the 0033 switch'),
  ('a4000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000d1', 'orders');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000e1', 'a4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000d1', 1,
   '{"trigger":{"type":"low_stock"},"steps":[{"id":"notify","body":"{\"content\":\"Low stock: {{product.name}} has {{product.stock}} left. Shop: {{product.shop}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000e2', 'a4000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000d1', 1,
   '{"trigger":{"type":"low_stock"},"steps":[{"id":"notify","body":"{\"event\":\"product.low_stock\",\"stock\":\"{{product.stock}}\",\"shop\":\"{{product.shop}}\",\"message\":\"Low stock. Shop: {{product.shop}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000e3', 'a4000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000d1', 1,
   '{"trigger":{"type":"low_stock","include_estimates":true},"steps":[{"id":"notify","body":"{\"content\":\"Low stock: {{product.name}} has {{product.stock}} left{{product.estimate_note}}. Shop: {{product.shop}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000e4', 'a4000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000d1', 1,
   '{"trigger":{"type":"order_created"},"steps":[{"id":"notify","body":"{\"content\":\"New order. Shop: {{product.shop}}\"}"}]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000e' || right(id::text, 1))::uuid where id::text like 'a4000000-0000-0000-0000-0000000000e%';
select el_test.check('the upgrade touches the three low-stock automations and not the order one', (select upgrade_low_stock_messages() = 3));
select el_test.check('a Discord message now ends with the source, in a new version; the old version is kept',
  (select definition::text like '%Source: {{product.source}}%' and definition::text not like '%{{product.shop}}%' from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = 'a4000000-0000-0000-0000-0000000000e1')
  and (select count(*) = 2 and min(version) = 1 and max(version) = 2 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000e1')
  and (select draft_definition::text like '%Source: {{product.source}}%' from workflows where id = 'a4000000-0000-0000-0000-0000000000e1'));
select el_test.check('a generic webhook also gets the source as a field of its own',
  (select strpos(definition::text, '\"source\":\"{{product.source}}\"') > 0 and strpos(definition::text, 'Source: {{product.source}}') > 0
     from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = 'a4000000-0000-0000-0000-0000000000e2'));
select el_test.check('the 0033 switch and its note are gone, and the trigger is otherwise unchanged',
  (select definition::text not like '%estimate_note%' and not (definition->'trigger' ? 'include_estimates') and definition->'trigger'->>'type' = 'low_stock'
     from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = 'a4000000-0000-0000-0000-0000000000e3'));
select el_test.check('an order automation is left alone, and running the upgrade again changes nothing',
  (select count(*) = 1 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000e4')
  and (select upgrade_low_stock_messages() = 0));

rollback;
select 'ESTIMATED LOW STOCK CHECKS PASSED';
