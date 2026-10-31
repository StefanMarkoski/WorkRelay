-- Low-stock alerts on the estimated stock (0033): a crossing caused by orders alerts once, a cancellation re-arms it, an edited order
-- does not alert twice, the shop's own report resets it, a product already low is not announced again, shops that do not estimate
-- are untouched, and only automations that ask for estimates receive them.
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

-- two automations: one wants estimates, one wants real numbers only
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'with estimates'),
  ('a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'real only');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000d1', 'a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"low_stock","include_estimates":true},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000d2', 'a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"low_stock"},"steps":[]}');
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
select el_test.check('only the automation that asks for estimates is started, and its message says the number is an estimate',
  (select count(*) = 1 and bool_and(workflow_id = 'a4000000-0000-0000-0000-0000000000d1' and context->'product'->>'estimated' = 'true'
     and context->'product'->>'estimate_note' like '%estimated from the orders%' and (context->'product'->>'stock')::int = 4) from workflow_runs));

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

-- the alert on the shop's real numbers still works, and still reaches both kinds of automation
delete from workflow_runs;
update products set stock = 4 where id = 'a2000000-0000-0000-0000-0000000000d1';
select el_test.check('a real report that crosses the level is a reported event for both automations, and its message has no estimate note',
  (select count(*) = 1 and bool_and(kind = 'reported') from low_stock_events where kind = 'reported')
  and (select count(*) = 2 and bool_and(context->'product'->>'estimated' = 'false' and context->'product'->>'estimate_note' = '') from workflow_runs));

select el_test.check('two automations that differ only in wanting estimates are not duplicates, and old ones keep their fingerprint',
  preset_fingerprint('notify', '{"event":"low_stock","channel":"discord","url":"https://d.example/x"}')
    is distinct from preset_fingerprint('notify', '{"event":"low_stock","channel":"discord","url":"https://d.example/x","include_estimates":true}')
  and preset_fingerprint('notify', '{"event":"low_stock","channel":"discord","url":"https://d.example/x"}')
    = preset_fingerprint('notify', '{"event":"low_stock","channel":"discord","url":"https://d.example/x","include_estimates":false}')
  and preset_fingerprint('notify', '{"event":"created","channel":"discord","url":"https://d.example/x","include_estimates":true}')
    = preset_fingerprint('notify', '{"event":"created","channel":"discord","url":"https://d.example/x"}'));

rollback;
select 'ESTIMATED LOW STOCK CHECKS PASSED';
