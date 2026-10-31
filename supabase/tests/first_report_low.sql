-- First-report low stock (0035): a product already low the first time a shop reports it alerts, capped at 3 per shop per 90 seconds,
-- the rest as one summary; known products and not-low products behave as before; the message is built server-side; automations upgraded.
begin;

create schema fr_test;
create function fr_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b9', 'owner@fr.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000b9', 'Org A', '00000000-0000-0000-0000-0000000000b9');
insert into memberships values ('a0000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'Alpha', 'connected', 'wr_live_b901', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000b9'),
  ('a1000000-0000-0000-0000-0000000000c9', 'a0000000-0000-0000-0000-0000000000b9', 'Beta', 'connected', 'wr_live_b902', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000b9');
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'low stock');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000b9', 'a4000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 1, '{"trigger":{"type":"low_stock"},"steps":[]}');
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000b9', enabled = true;

create function fr_test.sync(shop text, items jsonb) returns int language sql as $$
  select run_product_sync(('a1000000-0000-0000-0000-0000000000' || shop)::uuid, items, 'push', now(), 'shop')
$$;
create function fr_test.items(prefix text, n int, stock int, notify int default 5) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('sku', prefix || i, 'name', 'Item ' || prefix || i, 'stock', stock + (i % 3), 'notify_on', notify)) from generate_series(1, n) i
$$;

-- 1. two new products already low, one new product that is fine
select fr_test.sync('b9', '[{"sku":"A1","name":"Pen","stock":2,"notify_on":5},{"sku":"A2","name":"Cap","stock":1,"notify_on":5},{"sku":"A3","name":"Mug","stock":50,"notify_on":5}]');
select fr_test.check('two products already low on their first report each alert; the one that is fine does not',
  (select count(*) = 2 and bool_and(kind = 'reported' and first_report) from low_stock_events));
select fr_test.check('the message line is built for the automation, lowest stock first',
  (select array_agg(context->'product'->>'line' order by (context->'product'->>'stock')::int)
     = array['Low stock: Cap (SKU A2) has 1 left, at or below its alert level of 5.', 'Low stock: Pen (SKU A1) has 2 left, at or below its alert level of 5.']
     from workflow_runs)
  and (select bool_and(context->'product'->>'source' = 'Alpha' and context->'product'->>'kind' = 'reported') from workflow_runs));

-- 2. more low products in one sync, in the same 90 seconds: the budget of 3 is nearly used up (2 sent), so 1 more, then the summary
select fr_test.sync('b9', fr_test.items('B', 6, 1));
select fr_test.check('the cap is 3 per shop per 90 seconds: one more individual alert, and the other 5 as ONE summary',
  (select count(*) = 3 from low_stock_events where kind = 'reported')
  and (select count(*) = 1 and bool_and(count = 5 and first_report) from low_stock_events where kind = 'summary'));
select fr_test.check('the summary reads as one message, names a few products, and has no product of its own',
  (select context->'product'->>'line' like 'Low stock: 5 more products in Alpha are already at or below their alert levels (%, …). See Inventory → Low stock.'
     and context->'product'->>'kind' = 'summary' and (context->'product'->>'count')::int = 5 and context->'product'->>'source' = 'Alpha'
     from workflow_runs where context->'product'->>'kind' = 'summary'));
select fr_test.check('every low product is marked low, whether it alerted or is in the summary, so none alerts again',
  (select count(*) = 8 and bool_and(low_alerted) from products where integration_id = 'a1000000-0000-0000-0000-0000000000b9' and stock <= 5));
select fr_test.check('nothing is left staged', (select count(*) = 0 from low_stock_first_reports));

-- 3. the same shop again right away: the budget is used up, so only a summary
select fr_test.sync('b9', fr_test.items('C', 4, 0));
select fr_test.check('a further chunk of the same sync, inside the window, is a summary only',
  (select count(*) = 3 from low_stock_events where kind = 'reported')
  and (select count(*) = 2 and sum(count) = 9 from low_stock_events where kind = 'summary'));

-- 4. a different shop has its own budget
select fr_test.sync('c9', fr_test.items('D', 2, 0));
select fr_test.check('another shop has its own budget: both alert one by one',
  (select count(*) = 2 and bool_and(first_report) from low_stock_events where integration_id = 'a1000000-0000-0000-0000-0000000000c9' and kind = 'reported'));

-- 5. after the window the budget is back
update low_stock_events set occurred_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000b9';
select fr_test.sync('b9', fr_test.items('E', 5, 0));
select fr_test.check('a sync after the window starts a new budget: 3 alerts and a summary of the other 2',
  (select count(*) = 3 from low_stock_events where integration_id = 'a1000000-0000-0000-0000-0000000000b9' and kind = 'reported' and occurred_at > now() - interval '1 minute')
  and (select count = 2 from low_stock_events where integration_id = 'a1000000-0000-0000-0000-0000000000b9' and kind = 'summary' and occurred_at > now() - interval '1 minute'));

-- 6. known products behave as before
select fr_test.sync('b9', '[{"sku":"K1","name":"Known","stock":20,"notify_on":5}]');
select count(*) as before_known from low_stock_events \gset
select fr_test.sync('b9', '[{"sku":"K1","name":"Known","stock":3,"notify_on":5}]');
select fr_test.check('a known product that drops below its level alerts once, as before (not as a first report)',
  (select count(*) = :before_known + 1 from low_stock_events) and (select not e.first_report and e.kind = 'reported' and e.stock = 3 from low_stock_events e join products p on p.id = e.product_id where p.sku = 'K1'));
select fr_test.sync('b9', '[{"sku":"K1","name":"Known","stock":2,"notify_on":5}]');
select fr_test.check('and a product that is already low does not alert again', (select count(*) = :before_known + 1 from low_stock_events));

-- 7. a product known only from an order (stock never reported) counts as a first report when the shop reports it
insert into products (id, organization_id, integration_id, sku, name, notify_on) values
  ('a2000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'a1000000-0000-0000-0000-0000000000c9', 'ORD1', 'From order', 5);
update low_stock_events set occurred_at = now() - interval '5 minutes';
select fr_test.sync('c9', '[{"sku":"ORD1","name":"From order","stock":1}]');
select fr_test.check('a product known from an order, reported low for the first time, alerts as a first report',
  (select count(*) = 1 from low_stock_events where product_id = 'a2000000-0000-0000-0000-0000000000b9' and first_report));

-- 8. a direct write outside a sync stages nothing and alerts nothing (as before)
select count(*) as before_direct from low_stock_events \gset
select apply_product_sync('a1000000-0000-0000-0000-0000000000c9', '[{"sku":"DIRECT","name":"Direct","stock":1,"notify_on":5}]', 'push');
select fr_test.check('outside a sync a first report that is low does not alert', (select count(*) = :before_direct from low_stock_events) and (select count(*) = 0 from low_stock_first_reports));

-- 9. saved automations get the prepared line, as a new version
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000c9', 'a0000000-0000-0000-0000-0000000000b9', 'old discord'),
  ('a4000000-0000-0000-0000-0000000000d9', 'a0000000-0000-0000-0000-0000000000b9', 'old generic'),
  ('a4000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000b9', 'orders');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000c9', 'a4000000-0000-0000-0000-0000000000c9', 'a0000000-0000-0000-0000-0000000000b9', 1,
   '{"trigger":{"type":"low_stock"},"steps":[{"id":"notify","body":"{\"content\":\"Low stock: {{product.name}} (SKU {{product.sku}}) has {{product.stock}} left, at or below its alert level of {{product.threshold}}. Source: {{product.source}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000d9', 'a4000000-0000-0000-0000-0000000000d9', 'a0000000-0000-0000-0000-0000000000b9', 1,
   '{"trigger":{"type":"low_stock"},"steps":[{"id":"notify","body":"{\"event\":\"product.low_stock\",\"shop\":\"{{product.shop}}\",\"source\":\"{{product.source}}\",\"message\":\"Low stock: {{product.name}} (SKU {{product.sku}}) has {{product.stock}} left, at or below its alert level of {{product.threshold}}. Source: {{product.source}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000e9', 'a4000000-0000-0000-0000-0000000000e9', 'a0000000-0000-0000-0000-0000000000b9', 1,
   '{"trigger":{"type":"order_created"},"steps":[{"id":"notify","body":"x"}]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000' || right(id::text, 2))::uuid where id::text like 'a4000000-0000-0000-0000-0000000000_9' and id <> 'a4000000-0000-0000-0000-0000000000b9';
select fr_test.check('the upgrade changes the two saved low-stock automations and not the order one',
  (select upgrade_low_stock_line() = 2));
select fr_test.check('a Discord message is now the prepared line plus the source, in a new version',
  (select strpos(definition::text, '{{product.line}} Source: {{product.source}}') > 0 and strpos(definition::text, '{{product.name}}') = 0
     from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = 'a4000000-0000-0000-0000-0000000000c9')
  and (select count(*) = 2 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000c9'));
select fr_test.check('a generic webhook also gets the kind and the count as fields',
  (select strpos(definition::text, '\"kind\":\"{{product.kind}}\"') > 0 and strpos(definition::text, '\"count\":\"{{product.count}}\"') > 0
     from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = 'a4000000-0000-0000-0000-0000000000d9'));
select fr_test.check('running the upgrade again changes nothing', (select upgrade_low_stock_line() = 0));

rollback;
select 'FIRST REPORT LOW STOCK CHECKS PASSED';
