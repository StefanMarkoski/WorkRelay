-- Descriptive automation messages (0038): what was bought, the shop and the previous status reach the automations, a first order
-- gets its items even though the order row is saved before them, and saved automations are upgraded (and made mention-safe).
begin;

create schema dm_test;
create function dm_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'owner@dm.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000f7', 'Org A', '00000000-0000-0000-0000-0000000000f7');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000f7', 'a0000000-0000-0000-0000-0000000000f7', 'Game Store', 'connected', 'wr_live_f701', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000f7');

-- ------------------------------------------------------------------------------------------------ the items as text
insert into orders (id, organization_id, integration_id, external_id, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000f7', 'O1', now()),
  ('a3000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000f7', 'O2', now()),
  ('a3000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000f7', 'O3', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f1', 0, 'TEE', 'Black tee (M)', 1),
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f1', 1, 'MUG', 'Mug', 2);
insert into order_items (organization_id, order_id, position, sku, name, quantity)
select 'a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f2', g, 'S' || g, 'Thing ' || g, g from generate_series(1, 7) g;
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f3', 0, 'ONLYSKU', null, null),
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f3', 1, null, repeat('x', 100), 3);
select dm_test.check('two items read "1× Black tee (M), 2× Mug"', order_items_text('a3000000-0000-0000-0000-0000000000f1') = '1× Black tee (M), 2× Mug');
select dm_test.check('seven items show the first five and say how many more', order_items_text('a3000000-0000-0000-0000-0000000000f2') = '1× Thing 1, 2× Thing 2, 3× Thing 3, 4× Thing 4, 5× Thing 5, and 2 more');
select dm_test.check('a line with no name uses its SKU, with no quantity shows ?, and a very long name is cut at 60 characters',
  order_items_text('a3000000-0000-0000-0000-0000000000f3') = '?× ONLYSKU, 3× ' || repeat('x', 60));
select dm_test.check('an order with no items says so', order_items_text('a3000000-0000-0000-0000-0000000000f7') = 'no items listed');

-- ------------------------------------------------------------------------------------------------ the payload of order events
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f7', 'created'),
  ('a4000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f7', 'status'),
  ('a4000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f7', 'first order');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000f1', 'a4000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f7', 1, '{"trigger":{"type":"order_created"},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000f2', 'a4000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f7', 1, '{"trigger":{"type":"order_status_changed"},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000f3', 'a4000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f7', 1, '{"trigger":{"type":"customer_first_order"},"steps":[]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000f' || right(id::text, 1))::uuid, enabled = true where organization_id = 'a0000000-0000-0000-0000-0000000000f7';

insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f1', 'external', 'order.created', now(), '{"event_id":"c1","applied":[]}'),
  ('a0000000-0000-0000-0000-0000000000f7', 'a3000000-0000-0000-0000-0000000000f1', 'external', 'order.status_changed', now(), '{"event_id":"s1","applied":["status"],"status_from":"shipped","status_to":"delivered"}');
select dm_test.check('a new order reaches its automation with what was bought and the shop',
  (select count(*) = 1 and bool_and(context->'order'->>'items_text' = '1× Black tee (M), 2× Mug' and context->'order'->>'shop' = 'Game Store')
     from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000f1'));
select dm_test.check('a status change also carries the status it came from',
  (select count(*) = 1 and bool_and(context->'order'->>'status_from' = 'shipped' and context->'order'->>'items_text' = '1× Black tee (M), 2× Mug')
     from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000f2'));

-- ------------------------------------------------------------------------------------------------ a first order, written the way the app writes it
insert into webhook_events (id, organization_id, integration_id, event_id, raw_payload) values
  ('a2000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000f7', 'wf1', '{}');
select apply_order_plan('a2000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-0000000000f7', 'FIRST', null,
  '{"order_number":"#FIRST","customer_name":"New Buyer","customer_email":"new.buyer@example.com","customer_phone":"+389 1","placed_at":"2026-10-30T10:00:00Z","currency":"EUR","total_minor":4999,
    "status":"pending","payment_status":"paid","fulfillment_status":"unfulfilled","data_quality":[],"applied_at":{"customer":"2026-10-30T10:00:00Z"},"last_event_at":"2026-10-30T10:00:00Z"}',
  '[{"position":0,"sku":"TEE","name":"Black tee (M)","quantity":1},{"position":1,"sku":"MUG","name":"Mug","quantity":2}]',
  '{"type":"order.created","occurred_at":"2026-10-30T10:00:00Z","data":{"event_id":"wf1"}}');
select dm_test.check('a first order names the shop and what was bought, although the order row is saved before its items',
  (select count(*) = 1 and bool_and(context->'order'->>'items_text' = '1× Black tee (M), 2× Mug' and context->'customer'->>'shop' = 'Game Store'
        and context->'order'->>'shop' = 'Game Store' and context->'customer'->>'email' = 'new.buyer@example.com')
     from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000f3'));

-- ------------------------------------------------------------------------------------------------ saved automations are upgraded
insert into workflows (id, organization_id, name, preset, preset_config) values
  ('a4000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000f7', 'old discord created', 'notify', '{"event":"x","channel":"discord","url":"https://discord.com/api/webhooks/1/t"}'),
  ('a4000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000f7', 'old slack status', 'notify', '{"event":"x","channel":"discord","url":"https://discord.com/api/webhooks/2/t"}'),
  ('a4000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000f7', 'old generic cancelled', 'notify', '{"event":"x","channel":"discord","url":"https://discord.com/api/webhooks/3/t"}'),
  ('a4000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000f7', 'old discord signup', 'notify', '{"event":"x","channel":"discord","url":"https://discord.com/api/webhooks/4/t"}'),
  ('a4000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000f7', 'old discord low stock', 'notify', '{"event":"x","channel":"discord","url":"https://discord.com/api/webhooks/5/t"}'),
  ('a4000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-0000000000f7', 'a review automation', 'review_large', '{}');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000a1', 'a4000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"order_created"},"steps":[{"id":"notify","body":"{\"content\":\"New order {{order.display_number}} from {{order.customer}}: {{order.total}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000a2', 'a4000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"order_status_changed"},"steps":[{"id":"notify","body":"{\"text\":\"Order {{order.display_number}} is now {{order.status}} ({{order.total}})\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000a3', 'a4000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"order_status_changed"},"steps":[{"id":"notify","body":"{\"event\":\"order.cancelled\",\"customer\":\"{{order.customer}}\",\"message\":\"Order {{order.display_number}} was cancelled ({{order.total}})\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000a4', 'a4000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"customer_signup"},"steps":[{"id":"notify","body":"{\"content\":\"New customer signed up: {{customer.display_name}} ({{customer.email}})\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000a5', 'a4000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"low_stock"},"steps":[{"id":"notify","body":"{\"content\":\"{{product.line}} Source: {{product.source}}\"}"}]}'),
  ('a5000000-0000-0000-0000-0000000000a6', 'a4000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-0000000000f7', 1,
   '{"trigger":{"type":"order_created"},"steps":[{"id":"x","title":"Review large order {{order.display_number}} ({{order.total}})"}]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000a' || right(id::text, 1))::uuid where id::text like 'a4000000-0000-0000-0000-0000000000a_';

select upgrade_message_wording() as upgraded \gset
select dm_test.check('the upgrade touches the five notify automations (the review one is not a message)', :upgraded = 5);
create function dm_test.body(wf text) returns text language sql as $$
  select v.definition::text from workflow_versions v join workflows w on w.current_version_id = v.id where w.id = ('a4000000-0000-0000-0000-0000000000' || wf)::uuid
$$;
select dm_test.check('a Discord order message is the new wording, and Discord is told to parse no mentions',
  strpos(dm_test.body('a1'), 'New order {{order.display_number}} from {{order.customer_line}}: {{order.total}}. Bought: {{order.items_text}}. Shop: {{order.shop}}') > 0
  and strpos(dm_test.body('a1'), '\"allowed_mentions\":{\"parse\":[]}') > 0);
select dm_test.check('a Slack status message says what it changed from, without Discord''s setting',
  strpos(dm_test.body('a2'), 'from {{order.customer_line}} {{order.status_phrase}} ({{order.total}}). Bought: {{order.items_text}}. Shop: {{order.shop}}') > 0 and strpos(dm_test.body('a2'), 'allowed_mentions') = 0);
select dm_test.check('a generic webhook keeps its fields and gets the new "message"',
  strpos(dm_test.body('a3'), '\"customer\":\"{{order.customer}}\"') > 0 and strpos(dm_test.body('a3'), '\"message\":\"Order {{order.display_number}} from {{order.customer_line}} was cancelled') > 0);
select dm_test.check('a signup message names the shop', strpos(dm_test.body('a4'), 'New customer signed up: {{customer.line}}. Shop: {{customer.shop}}') > 0);
select dm_test.check('the low-stock message keeps its wording and gains the mention setting',
  strpos(dm_test.body('a5'), '{{product.line}} Source: {{product.source}}') > 0 and strpos(dm_test.body('a5'), 'allowed_mentions') > 0);
select dm_test.check('each upgraded automation is a new version, with the old one kept',
  (select count(*) = 2 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000a1')
  and (select count(*) = 1 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000a6'));
select dm_test.check('running the upgrade again changes nothing', (select upgrade_message_wording() = 0));

rollback;
select 'DESCRIPTIVE MESSAGES CHECKS PASSED';
