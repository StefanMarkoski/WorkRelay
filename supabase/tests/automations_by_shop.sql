-- Automations limited to chosen shops: order triggers, signup triggers, and per-shop first orders.
begin;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

-- which workflows (by suffix) have a run, e.g. '1,5'
create function pg_temp.fired() returns text language sql as $$
  select coalesce(string_agg(right(workflow_id::text, 1), ',' order by right(workflow_id::text, 1)), '') from workflow_runs
$$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@a.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000a1', 'Org', '00000000-0000-0000-0000-0000000000a1');
insert into memberships values ('a0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, track_signups, signups_enabled_at) values
  ('a1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'S1', 'connected', 'wr_live_a001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000a1', true, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'S2', 'connected', 'wr_live_a002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000a1', true, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1', 'S3', 'connected', 'wr_live_a003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000a1', true, now() - interval '30 days');

insert into workflows (id, organization_id, name)
select ('a4000000-0000-0000-0000-0000000000a' || n)::uuid, 'a0000000-0000-0000-0000-0000000000a1', 'w' || n from generate_series(1, 9) n;
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000a' || n)::uuid, ('a4000000-0000-0000-0000-0000000000a' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000a1', 1, def
from (values
  (1, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"order_created","integration_ids":["a1000000-0000-0000-0000-0000000000a1"]},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"order_created","integration_ids":["a1000000-0000-0000-0000-0000000000a2","a1000000-0000-0000-0000-0000000000a3"]},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"order_status_changed","integration_ids":["a1000000-0000-0000-0000-0000000000a2"]},"steps":[]}'::jsonb),
  (5, '{"trigger":{"type":"customer_first_order"},"steps":[]}'::jsonb),
  (6, '{"trigger":{"type":"customer_first_order","integration_ids":["a1000000-0000-0000-0000-0000000000a2"]},"steps":[]}'::jsonb),
  (7, '{"trigger":{"type":"customer_signup","integration_ids":["a1000000-0000-0000-0000-0000000000a1","a1000000-0000-0000-0000-0000000000a3"]},"steps":[]}'::jsonb),
  (8, '{"trigger":{"type":"customer_signup","integration_id":"a1000000-0000-0000-0000-0000000000a2"},"steps":[]}'::jsonb),
  (9, '{"trigger":{"type":"customer_signup"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000a' || right(w.id::text, 1))::uuid;
update workflows set enabled = true;

-- ------------------------------------------------------------- order triggers
insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', '1', null, now());
delete from workflow_runs;
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-0000000000a1', 'external', 'order.created', now(), '{"event_id":"o1","applied":["order_number"]}');
select pg_temp.check('an order from shop 1 starts the all-shops automation and the one limited to shop 1 only', pg_temp.fired() = '1,2');

insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '2', null, now());
delete from workflow_runs;
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-0000000000a2', 'external', 'order.created', now(), '{"event_id":"o2","applied":["order_number"]}');
select pg_temp.check('an order from shop 2 starts the all-shops one and the shops-2-and-3 one, not shop 1''s', pg_temp.fired() = '1,3');

-- the same order sent again under a new event id is not a new order
delete from workflow_runs;
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-0000000000a2', 'external', 'order.created', now(), '{"event_id":"o2-again","applied":["order_number"]}');
select pg_temp.check('order.created sent again for the same order starts nothing: a new order is announced once', pg_temp.fired() = '');

delete from workflow_runs;
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-0000000000a2', 'external', 'order.status_changed', now(), '{"event_id":"o2s","applied":["status"],"status_to":"completed"}'),
  ('a0000000-0000-0000-0000-0000000000a1', 'a3000000-0000-0000-0000-0000000000a1', 'external', 'order.status_changed', now(), '{"event_id":"o1s","applied":["status"],"status_to":"completed"}');
select pg_temp.check('a status change starts the status automation only for shop 2''s order', pg_temp.fired() = '4');

-- ------------------------------------------------------------- first orders, per shop
delete from workflow_runs;
delete from customer_events;
insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at, applied_at) values
  ('a3000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', '3', 'ana@example.com', now(), jsonb_build_object('customer', now()::text));
select pg_temp.check('a brand-new customer ordering at shop 1: the all-shops automation fires, shop 2''s does not',
  pg_temp.fired() = '5'
  and (select workspace_first from customer_events where type = 'first_order'));

delete from workflow_runs;
insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at, applied_at) values
  ('a3000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '4', 'ana@example.com', now(), jsonb_build_object('customer', now()::text));
select pg_temp.check('the same person''s first order at shop 2 fires shop 2''s automation, but not the all-shops one (not new to the workspace)',
  pg_temp.fired() = '6'
  and (select count(*) = 2 from customer_events where type = 'first_order')
  and (select not workspace_first from customer_events where type = 'first_order' and integration_id = 'a1000000-0000-0000-0000-0000000000a2'));

delete from workflow_runs;
insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at, applied_at) values
  ('a3000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '5', 'ANA@example.com', now(), jsonb_build_object('customer', now()::text));
select pg_temp.check('a repeat order at a shop fires nothing', pg_temp.fired() = '');

delete from workflow_runs;
insert into orders (id, organization_id, integration_id, external_id, customer_email, last_event_at, applied_at) values
  ('a3000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '6', 'ben@example.com', now(), jsonb_build_object('customer', now()::text));
select pg_temp.check('a new customer at shop 2 is first in the workspace and at the shop: both automations fire', pg_temp.fired() = '5,6');

-- ------------------------------------------------------------- signups, per shop (a list, a single legacy id, and all)
delete from workflow_runs;
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', 'customer.created', now(), 'sign@example.com', 'Sign', null, null, null);
select pg_temp.check('a signup through shop 1: the list [1,3] and the all-shops automation fire, the shop-2 one does not', pg_temp.fired() = '7,9');

delete from workflow_runs;
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', 'customer.created', now(), 'sign@example.com', null, null, null, null);
select pg_temp.check('the same person signing up through shop 2: the older single-shop automation and the all-shops one fire', pg_temp.fired() = '8,9');

delete from workflow_runs;
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a3', 'customer.created', now(), 'sign@example.com', null, null, null, null);
select pg_temp.check('through shop 3: the list [1,3] and the all-shops automation fire', pg_temp.fired() = '7,9');

-- the run says which shop it came from
select pg_temp.check('runs carry the shop of the event',
  (select bool_and(context->'event'->>'integration_id' = 'a1000000-0000-0000-0000-0000000000a3') from workflow_runs));

rollback;
\echo AUTOMATIONS BY SHOP SQL CHECKS PASSED
