-- "A shop syncs its products" (0021): one event per sync (chunks merge), who is named, which automations start, and that
-- nothing else can write or read these events.
begin;

create schema ps_test;
grant usage on schema ps_test to authenticated;
create function ps_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function ps_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function ps_test.code(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema ps_test to authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'owner@ps.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000a9', 'Org A', '00000000-0000-0000-0000-0000000000a9'),
  ('a0000000-0000-0000-0000-0000000000b9', 'Org B', '00000000-0000-0000-0000-0000000000a9');
insert into memberships values ('a0000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-0000000000a9', 'Game Store', 'connected', 'wr_live_9001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000a9'),
  ('a1000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000a9', 'Bike Shop', 'connected', 'wr_live_9002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000a9');

-- automations: any shop, Game Store only, Bike Shop only, disabled, and a different trigger
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000a9', 'sync, any shop'),
  ('a4000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000a9', 'sync, game store only'),
  ('a4000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000a9', 'sync, bike shop only'),
  ('a4000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000a9', 'sync, disabled'),
  ('a4000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000a9', 'low stock');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000e' || n)::uuid, ('a4000000-0000-0000-0000-0000000000e' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000a9', 1, def
from (values
  (1, '{"trigger":{"type":"products_synced"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"products_synced","integration_ids":["a1000000-0000-0000-0000-0000000000a9"]},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"products_synced","integration_ids":["a1000000-0000-0000-0000-0000000000b9"]},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"products_synced"},"steps":[]}'::jsonb),
  (5, '{"trigger":{"type":"low_stock"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000e' || right(w.id::text, 1))::uuid;
update workflows set enabled = true where id <> 'a4000000-0000-0000-0000-0000000000e4';

-- ------------------------------------------------------------------------------------------------ one sync, named
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Marko', 'Admin', 500);
select ps_test.check('a push creates one event and starts the enabled automations that cover the shop, and no others',
  (select count(*) = 1 from product_sync_events)
  and (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000e1', 'a4000000-0000-0000-0000-0000000000e2') and trigger_source = 'products_synced') from workflow_runs));
select ps_test.check('the run names who synced, which shop, and where it came from',
  (select bool_and(context->'sync'->>'by' = 'Marko (Admin)' and context->'sync'->>'name' = 'Marko' and context->'sync'->>'role' = 'Admin'
                   and context->'sync'->>'shop' = 'Game Store' and context->'sync'->>'where' = ' (Game Store)' and context->'event'->>'type' = 'products.synced'
                   and context->'event'->>'integration_id' = 'a1000000-0000-0000-0000-0000000000a9') from workflow_runs));

-- the next chunks of the same sync are not new notifications
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Marko', 'Admin', 500);
select ps_test.check('another chunk from the same person right after joins the same sync: still one event, one set of runs, counts added up',
  (select count(*) = 1 and bool_and(products = 1000) from product_sync_events) and (select count(*) = 2 from workflow_runs));

-- someone else, or the same person after a pause, is a new sync
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Ana', 'Staff', 200);
select ps_test.check('a different person is a new sync and notifies again',
  (select count(*) = 2 from product_sync_events) and (select count(*) = 4 from workflow_runs)
  and (select count(*) = 2 from workflow_runs where context->'sync'->>'by' = 'Ana (Staff)'));
update product_sync_events set updated_at = now() - interval '2 minutes' where by_name = 'Marko';
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Marko', 'Admin', 10);
select ps_test.check('the same person after 90 quiet seconds is a new sync, so a second click notifies again',
  (select count(*) = 3 from product_sync_events) and (select count(*) = 6 from workflow_runs));

-- a long sync is still one: each request follows the last within the window, however long the whole thing takes
delete from workflow_runs; delete from product_sync_events;
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Long', 'Run', 500);
update product_sync_events set created_at = now() - interval '30 minutes', updated_at = now() - interval '60 seconds';
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Long', 'Run', 500);
select ps_test.check('a sync that has been going for half an hour is still one sync while requests keep arriving (60 seconds apart)',
  (select count(*) = 1 and bool_and(products = 1000) from product_sync_events) and (select count(*) = 2 from workflow_runs));
update product_sync_events set updated_at = now() - interval '91 seconds';
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Long', 'Run', 5);
select ps_test.check('...and 91 seconds of quiet ends it', (select count(*) = 2 from product_sync_events));

-- ------------------------------------------------------------------------------------------------ what it started
delete from workflow_runs; delete from product_sync_events;
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Count', 'Check', 1);
select ps_test.check('each sync records how many automations it started (the any-shop one and the Game Store one: two)',
  (select notified = 2 from product_sync_events));
select announce_products_synced('a1000000-0000-0000-0000-0000000000b9', 'Count', 'Check', 1);
select ps_test.check('...for the other shop, its own two',
  (select notified = 2 from product_sync_events where integration_id = 'a1000000-0000-0000-0000-0000000000b9'));
update workflows set enabled = false;
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Nobody', 'Home', 1);
select ps_test.check('with every automation off the sync is recorded as having notified none, so the app can say so',
  (select notified = 0 from product_sync_events where by_name = 'Nobody') and (select count(*) = 4 from workflow_runs));
update workflows set enabled = true where id <> 'a4000000-0000-0000-0000-0000000000e4';
delete from workflow_runs; delete from product_sync_events;

-- ------------------------------------------------------------------------------------------------ who is named
delete from workflow_runs; delete from product_sync_events;
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Dimitar', null, 1);
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', null, 'Manager', 1);
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', null, null, 1);
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', '   ', '', 1);
select ps_test.check('name only, role only, and nobody named read naturally; blank strings count as nobody and merge with it',
  (select count(*) = 3 from product_sync_events)
  and (select count(distinct context->'sync'->>'by') = 3 and bool_and(context->'sync'->>'by' in ('Dimitar', 'Manager', 'Game Store')) from workflow_runs));
select ps_test.check('the shop is named once: in brackets after a person, and not repeated when the shop itself is the subject',
  (select bool_and(context->'sync'->>'where' = ' (Game Store)') from workflow_runs where context->'sync'->>'by' in ('Dimitar', 'Manager'))
  and (select bool_and(context->'sync'->>'where' = '') from workflow_runs where context->'sync'->>'by' = 'Game Store'));
delete from workflow_runs; delete from product_sync_events;
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', repeat('n', 500), repeat('r', 500), 1);
select ps_test.check('very long names are cut to a sensible length', (select length(by_name) = 120 and length(by_role) = 60 from product_sync_events));

-- ------------------------------------------------------------------------------------------------ another shop
delete from workflow_runs; delete from product_sync_events;
select announce_products_synced('a1000000-0000-0000-0000-0000000000b9', 'Marko', 'Admin', 5);
select ps_test.check('a sync at the other shop starts the any-shop automation and that shop''s own, not the Game Store one',
  (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000e1', 'a4000000-0000-0000-0000-0000000000e3')) from workflow_runs)
  and (select bool_and(context->'sync'->>'shop' = 'Bike Shop') from workflow_runs));
select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Marko', 'Admin', 5);
select ps_test.check('the same person syncing two shops is two syncs (the five-minute merge is per shop)', (select count(*) = 2 from product_sync_events));

-- ------------------------------------------------------------------------------------------------ safety
select ps_test.check('an unknown shop is ignored quietly', ps_test.code($$select announce_products_synced(gen_random_uuid(), 'x', 'y', 1)$$) = 'ok'
  and (select count(*) = 2 from product_sync_events));
select ps_test.as_user('00000000-0000-0000-0000-0000000000a9');
select ps_test.check('no workspace member can announce a sync by calling it directly',
  ps_test.code($$select announce_products_synced('a1000000-0000-0000-0000-0000000000a9', 'Fake', 'Person', 1)$$) like '%permission denied%');
select ps_test.check('...or write, change or delete events (members can only read their own workspace''s)',
  ps_test.code($$insert into product_sync_events (organization_id, integration_id) values ('a0000000-0000-0000-0000-0000000000a9', 'a1000000-0000-0000-0000-0000000000a9')$$) like '%permission denied%'
  and ps_test.code($$update product_sync_events set products = 99$$) like '%permission denied%'
  and ps_test.code($$delete from product_sync_events$$) like '%permission denied%');
select ps_test.check('a member reads this workspace''s sync events: names, roles and counts',
  (select count(*) = 2 and bool_or(by_name = 'Marko' and by_role = 'Admin') from product_sync_events));
reset role;

-- ------------------------------------------------------------------------------------------------ remembering the last push (0022)
delete from integration_sync;
select record_product_push('a1000000-0000-0000-0000-0000000000a9', 'Marko', 'Admin');
select ps_test.check('the first push creates the shop''s sync row and remembers when and who',
  (select count(*) = 1 and bool_and(last_push_by = 'Marko (Admin)' and last_push_at > now() - interval '1 minute') from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9'));
update integration_sync set last_push_at = now() - interval '2 hours' where integration_id = 'a1000000-0000-0000-0000-0000000000a9';
select record_product_push('a1000000-0000-0000-0000-0000000000a9', null, null);
select ps_test.check('a later push replaces it, and a push that names nobody clears the name instead of keeping an old one',
  (select last_push_at > now() - interval '1 minute' and last_push_by is null from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9'));
select record_product_push('a1000000-0000-0000-0000-0000000000a9', 'Dimitar', null);
select ps_test.check('a name alone, then a role alone, read naturally',
  (select last_push_by = 'Dimitar' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9'));
select record_product_push('a1000000-0000-0000-0000-0000000000a9', '  ', 'Manager');
select ps_test.check('blank name counts as none', (select last_push_by = 'Manager' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9'));
select ps_test.check('an unknown shop is ignored quietly', ps_test.code($$select record_product_push(gen_random_uuid(), 'x', 'y')$$) = 'ok');
select ps_test.check('a push does not disturb the schedule fields of the same row',
  (select calls is null and source_url is null and not push_enabled from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9'));
select ps_test.as_user('00000000-0000-0000-0000-0000000000a9');
select ps_test.check('a member can read when and by whom the shop last pushed, but cannot record a push, and still cannot read the auth header',
  (select last_push_by = 'Manager' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000a9')
  and ps_test.code($$select record_product_push('a1000000-0000-0000-0000-0000000000a9', 'Fake', 'Person')$$) like '%permission denied%'
  and ps_test.code($$select auth_header from integration_sync$$) like '%permission denied%');
reset role;

select 'PASSED' as products_synced;
rollback;
