-- apply_order_plan: create, versioned update, conflict detection, item replacement, timeline, event status.
begin;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'plan@test.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000aa', 'Org', '00000000-0000-0000-0000-0000000000aa');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-0000000000aa', 'S', 'connected', 'wr_live_zzzz',
   extensions.digest('k', 'sha256'), 'store-1', '00000000-0000-0000-0000-0000000000aa');
insert into webhook_events (id, organization_id, integration_id, event_id, raw_payload) values
  ('a2000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', 'e1', '{}'),
  ('a2000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', 'e2', '{}');

-- create
select apply_order_plan(
  'a2000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', '1001', null,
  '{"order_number":"#1001","customer_name":"Ana","customer_email":"ana@example.com","customer_phone":null,"placed_at":"2026-10-27T10:00:00.000Z",
    "currency":"EUR","subtotal_minor":4500,"discount_minor":null,"shipping_minor":499,"tax_minor":null,"total_minor":4999,
    "status":"pending","payment_status":"paid","fulfillment_status":"unfulfilled","external_status":"New","external_payment_status":"PAID",
    "external_fulfillment_status":null,"billing_address":null,"shipping_address":{"city":"Skopje"},"notes":null,
    "data_quality":["no_customer_contact"],"applied_at":{"customer":"2026-10-27T10:00:00.000Z"},"last_event_at":"2026-10-27T10:00:00.000Z"}',
  '[{"position":0,"external_id":null,"sku":"A","name":"Tee","quantity":1,"unit_price_minor":4500}]',
  '{"type":"order.created","occurred_at":"2026-10-27T10:00:00.000Z","data":{"event_id":"e1"}}') as result \gset
select pg_temp.check('create returns ok', :'result' = 'ok');
select pg_temp.check('order stored with normalized values',
  (select total_minor = 4999 and status = 'pending' and payment_status = 'paid' and currency = 'EUR' and version = 1
          and data_quality = array['no_customer_contact'] and shipping_address->>'city' = 'Skopje' and applied_at ? 'customer'
   from orders where external_id = '1001'));
select pg_temp.check('items stored', (select count(*) from order_items) = 1);
select pg_temp.check('timeline entry stored as external', (select count(*) from order_events where source = 'external' and type = 'order.created') = 1);
select pg_temp.check('webhook event marked processed', (select status = 'processed' and processed_at is not null from webhook_events where event_id = 'e1'));

-- stale version is a conflict and writes nothing
select apply_order_plan('a2000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', '1001', 7,
  '{"status":"completed"}', null, '{"type":"order.updated","occurred_at":"2026-10-27T11:00:00Z","data":{}}') as result \gset
select pg_temp.check('wrong expected version -> conflict', :'result' = 'conflict');
select pg_temp.check('conflict wrote nothing', (select status = 'pending' and version = 1 from orders where external_id = '1001')
  and (select count(*) from order_events) = 1 and (select status = 'received' from webhook_events where event_id = 'e2'));

-- creating an order that already exists (expected null) is a conflict
select apply_order_plan('a2000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', '1001', null,
  '{"status":"completed"}', null, '{"type":"order.created","occurred_at":"2026-10-27T11:00:00Z","data":{}}') as result \gset
select pg_temp.check('duplicate create -> conflict', :'result' = 'conflict');

-- correct version updates, bumps version, replaces items only when provided
select apply_order_plan('a2000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', '1001', 1,
  '{"order_number":"#1001","customer_name":"Ana","customer_email":"ana@example.com","customer_phone":null,"placed_at":"2026-10-27T10:00:00.000Z",
    "currency":"EUR","subtotal_minor":4500,"discount_minor":null,"shipping_minor":499,"tax_minor":null,"total_minor":4999,
    "status":"completed","payment_status":"paid","fulfillment_status":"fulfilled","external_status":"Done","external_payment_status":"PAID",
    "external_fulfillment_status":"shipped","billing_address":null,"shipping_address":{"city":"Skopje"},"notes":"gift",
    "data_quality":[],"applied_at":{},"last_event_at":"2026-10-27T11:00:00.000Z"}',
  null, '{"type":"order.status_changed","occurred_at":"2026-10-27T11:00:00.000Z","data":{"status_from":"pending","status_to":"completed"}}') as result \gset
select pg_temp.check('update returns ok', :'result' = 'ok');
select pg_temp.check('update applied and version bumped',
  (select status = 'completed' and fulfillment_status = 'fulfilled' and notes = 'gift' and version = 2 and updated_at >= created_at from orders where external_id = '1001'));
select pg_temp.check('items untouched when plan has none', (select count(*) from order_items) = 1);
select pg_temp.check('two timeline entries', (select count(*) from order_events) = 2);
select pg_temp.check('timeline keeps event payload', (select data->>'status_to' = 'completed' from order_events where type = 'order.status_changed'));

-- items replaced when provided (including with an empty list)
select apply_order_plan('a2000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000aa', 'a1000000-0000-0000-0000-0000000000aa', '1001', 2,
  '{"order_number":"#1001","status":"completed","payment_status":"paid","fulfillment_status":"fulfilled","data_quality":[],"applied_at":{},"last_event_at":"2026-10-27T12:00:00Z"}',
  '[{"position":0,"sku":"B","quantity":2,"unit_price_minor":100},{"position":1,"sku":"C","quantity":1,"unit_price_minor":50}]',
  '{"type":"order.updated","occurred_at":"2026-10-27T12:00:00Z","data":{}}') as result \gset
select pg_temp.check('items replaced wholesale', (select count(*) = 2 and bool_and(sku in ('B','C')) from order_items));

rollback;
\echo APPLY_ORDER_PLAN CHECKS PASSED
