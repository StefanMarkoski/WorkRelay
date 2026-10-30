-- Inventory follow-ups (0016): the same SKU across shops, pulls recorded in Event history, and its retention.
begin;

create schema fu_test;
grant usage on schema fu_test to authenticated;
create function fu_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function fu_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema fu_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'member@fu.dev'), ('00000000-0000-0000-0000-0000000000c2', 'other@fu.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'Org A', '00000000-0000-0000-0000-0000000000c1'),
  ('a0000000-0000-0000-0000-0000000000c2', 'Org B', '00000000-0000-0000-0000-0000000000c2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'member'),
  ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Alpha', 'connected', 'wr_live_c001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000c1'),
  ('a1000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'Beta', 'connected', 'wr_live_c002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000c1'),
  ('a1000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000c2', 'Gamma', 'connected', 'wr_live_c003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000c2');

-- ------------------------------------------------------------------------------------------------ same SKU elsewhere
select apply_product_sync('a1000000-0000-0000-0000-0000000000c1', '[{"sku":"BIKE","name":"Bike","stock":12,"notify_on":5,"unit":"pcs"},{"sku":"ONLY-A","stock":1}]', 'pull', now());
select apply_product_sync('a1000000-0000-0000-0000-0000000000c2', '[{"sku":"BIKE","name":"Bike","stock":3,"notify_on":5,"unit":"pcs"}]', 'pull', now());
select apply_product_sync('a1000000-0000-0000-0000-0000000000c3', '[{"sku":"BIKE","name":"Bike","stock":99}]', 'pull', now());

select fu_test.as_user('00000000-0000-0000-0000-0000000000c1');
select fu_test.check('a product lists the same SKU in the workspace''s other shop, with its stock and whether it is low',
  (select count(*) = 1 and bool_and(integration_name = 'Beta' and stock = 3 and low and unit = 'pcs')
     from product_siblings((select id from products where sku = 'BIKE' and integration_id = 'a1000000-0000-0000-0000-0000000000c1'))));
select fu_test.check('the other direction sees Alpha, and not stock from a different workspace',
  (select count(*) = 1 and bool_and(integration_name = 'Alpha' and stock = 12 and not low)
     from product_siblings((select id from products where sku = 'BIKE' and integration_id = 'a1000000-0000-0000-0000-0000000000c2'))));
select fu_test.check('a SKU that exists in one shop only has no siblings',
  (select count(*) = 0 from product_siblings((select id from products where sku = 'ONLY-A'))));
reset role;
select fu_test.as_user('00000000-0000-0000-0000-0000000000c2');
select fu_test.check('another workspace cannot read these products through the function',
  (select count(*) = 0 from product_siblings((select id from products where sku = 'BIKE' and integration_id = 'a1000000-0000-0000-0000-0000000000c1' limit 1))));
reset role;

-- ------------------------------------------------------------------------------------------------ pulls in Event history
insert into integration_sync (integration_id, organization_id, source_url, calls, days, next_sync_at) values
  ('a1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'https://a.example/p', 24, 1, now());
select record_product_sync('a1000000-0000-0000-0000-0000000000c1', null, 2);
select record_product_sync('a1000000-0000-0000-0000-0000000000c1', 'The shop answered with HTTP 503', null);
select fu_test.check('a successful pull is recorded as a processed inventory.pull event with its product count',
  (select count(*) = 1 and bool_and(raw_payload->>'products' = '2' and error is null and integration_id = 'a1000000-0000-0000-0000-0000000000c1')
     from webhook_events where event_type = 'inventory.pull' and status = 'processed'));
select fu_test.check('a failed pull is recorded as failed, with the reason',
  (select count(*) = 1 and bool_and(error = 'The shop answered with HTTP 503') from webhook_events where event_type = 'inventory.pull' and status = 'failed'));
select fu_test.check('each pull is its own event (no duplicate-key clash)', (select count(distinct event_id) = 2 from webhook_events where event_type = 'inventory.pull'));
select record_product_sync('a1000000-0000-0000-0000-0000000000c2', null, 1);
select fu_test.check('a pull for a shop with no sync settings records nothing',
  (select count(*) = 2 from webhook_events where event_type = 'inventory.pull'));
select fu_test.as_user('00000000-0000-0000-0000-0000000000c1');
select fu_test.check('workspace members see these events in Event history', (select count(*) = 2 from webhook_events where event_type = 'inventory.pull'));
reset role;
select fu_test.as_user('00000000-0000-0000-0000-0000000000c2');
select fu_test.check('another workspace does not', (select count(*) = 0 from webhook_events where event_type = 'inventory.pull'));
reset role;

-- ------------------------------------------------------------------------------------------------ retention
-- Seed the old rows with the prune switched off, so the seeding itself cannot trigger it.
alter table webhook_events disable trigger webhook_events_prune_inventory;
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, received_at) values
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'old-inv', 'inventory.push', 'processed', '{}', now() - interval '40 days'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'old-order', 'order.created', 'processed', '{}', now() - interval '40 days'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c2', 'old-inv-other-shop', 'inventory.push', 'processed', '{}', now() - interval '40 days');
alter table webhook_events enable trigger webhook_events_prune_inventory;
-- The prune runs on about 1 in 50 inserts, so a few hundred new events make it (all but) certain to run at least once.
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload)
select 'a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'inventory:push:' || g, 'inventory.push', 'processed', '{}'
from generate_series(1, 800) g;
select fu_test.check('inventory events older than 30 days are pruned for the shop that is writing',
  (select count(*) = 0 from webhook_events where event_id = 'old-inv'));
select fu_test.check('an old order event is never touched, nor another shop''s inventory event',
  (select count(*) = 1 from webhook_events where event_id = 'old-order') and (select count(*) = 1 from webhook_events where event_id = 'old-inv-other-shop'));
select fu_test.check('recent inventory events are kept', (select count(*) = 800 from webhook_events where event_id like 'inventory:push:%'));

select 'PASSED' as inventory_followups;
rollback;
