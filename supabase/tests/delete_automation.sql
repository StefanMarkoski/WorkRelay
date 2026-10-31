-- Deleting an automation (0024): who can, that history is kept, that it never fires again, that its settings are free, and the counts.
begin;

create schema da_test;
grant usage on schema da_test to authenticated;
create function da_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function da_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function da_test.code(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema da_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@da.dev'), ('00000000-0000-0000-0000-0000000000d2', 'member@da.dev'),
  ('00000000-0000-0000-0000-0000000000d3', 'other@da.dev'), ('00000000-0000-0000-0000-0000000000d4', 'super@da.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'Org A', '00000000-0000-0000-0000-0000000000d1'),
  ('a0000000-0000-0000-0000-0000000000d2', 'Org B', '00000000-0000-0000-0000-0000000000d3');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'member'),
  ('a0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3', 'owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000d4');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Shop', 'connected', 'wr_live_d001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000d1');

-- two published, enabled "a shop syncs its products" automations with different destinations, as the app leaves them
insert into workflows (id, organization_id, name, preset, preset_config, draft_definition) values
  ('a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Sync to channel one', 'notify', '{"event":"products_synced","channel":"discord","url":"https://discord.com/api/webhooks/1/a"}', '{}'),
  ('a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'Sync to channel two', 'notify', '{"event":"products_synced","channel":"discord","url":"https://discord.com/api/webhooks/2/b"}', '{}');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000d1', 'a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"products_synced"},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000d2', 'a4000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"products_synced"},"steps":[]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000d' || right(id::text, 1))::uuid, enabled = true;

-- it ran once before it was deleted
select announce_products_synced('a1000000-0000-0000-0000-0000000000d1', 'Marko', 'Admin', 5);
select da_test.check('before deleting, both automations fire', (select count(*) = 2 from workflow_runs));

-- ------------------------------------------------------------------------------------------------ who can delete
select da_test.as_user('00000000-0000-0000-0000-0000000000d2');
select da_test.check('a plain member cannot delete', da_test.code($$select delete_automation('a4000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
reset role;
select da_test.as_user('00000000-0000-0000-0000-0000000000d3');
select da_test.check('an owner of another workspace cannot delete it', da_test.code($$select delete_automation('a4000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select da_test.check('...and an unknown automation is just forbidden, revealing nothing', da_test.code($$select delete_automation(gen_random_uuid())$$) = 'forbidden');
reset role;
select da_test.check('nothing changed by those attempts', (select count(*) = 2 and bool_and(deleted_at is null and enabled) from workflows));
select da_test.as_user('00000000-0000-0000-0000-0000000000d1');
select da_test.check('nobody can write deleted_at themselves',
  da_test.code($$update workflows set deleted_at = now() where id = 'a4000000-0000-0000-0000-0000000000d1'$$) like '%permission denied%');
select da_test.check('nobody can really delete the row (the history hangs off it)',
  da_test.code($$delete from workflows where id = 'a4000000-0000-0000-0000-0000000000d1'$$) like '%permission denied%'
  or (select count(*) = 2 from workflows));

-- ------------------------------------------------------------------------------------------------ deleting
select delete_automation('a4000000-0000-0000-0000-0000000000d1');
reset role;
select da_test.check('an owner deletes it: it is kept, switched off and marked deleted',
  (select deleted_at is not null and not enabled and preset_key is null from workflows where id = 'a4000000-0000-0000-0000-0000000000d1'));
select da_test.check('the other automation is untouched', (select deleted_at is null and enabled and preset_key is not null from workflows where id = 'a4000000-0000-0000-0000-0000000000d2'));
select da_test.check('its past runs are still there, and still point at it (the Executions page shows its name)',
  (select count(*) = 1 from workflow_runs r join workflows w on w.id = r.workflow_id where w.id = 'a4000000-0000-0000-0000-0000000000d1' and w.name = 'Sync to channel one'));
select da_test.check('its published version is still there too', (select count(*) = 1 from workflow_versions where workflow_id = 'a4000000-0000-0000-0000-0000000000d1'));

-- it never fires again
delete from product_sync_events;
delete from workflow_runs;
select announce_products_synced('a1000000-0000-0000-0000-0000000000d1', 'Ana', 'Staff', 5);
select da_test.check('a deleted automation never fires again, and the other one still does',
  (select count(*) = 1 and bool_and(workflow_id = 'a4000000-0000-0000-0000-0000000000d2') from workflow_runs));

-- deleting twice is harmless and keeps the first time
update workflows set deleted_at = now() - interval '1 day' where id = 'a4000000-0000-0000-0000-0000000000d1';
select da_test.as_user('00000000-0000-0000-0000-0000000000d1');
select da_test.check('deleting again does not fail', da_test.code($$select delete_automation('a4000000-0000-0000-0000-0000000000d1')$$) = 'ok');
reset role;
select da_test.check('...and keeps the original deletion time', (select deleted_at < now() - interval '23 hours' from workflows where id = 'a4000000-0000-0000-0000-0000000000d1'));

-- ------------------------------------------------------------------------------------------------ its settings are free again
select da_test.as_user('00000000-0000-0000-0000-0000000000d1');
select da_test.check('the same automation can be created again once the old one is deleted (the duplicate rule ignores deleted ones)',
  da_test.code($$insert into workflows (organization_id, name, preset, preset_config, draft_definition) values ('a0000000-0000-0000-0000-0000000000d1', 'Sync to channel one again', 'notify', '{"event":"products_synced","channel":"discord","url":"https://discord.com/api/webhooks/1/a"}', '{}')$$) = 'ok');
select da_test.check('...but a live automation is still protected',
  da_test.code($$insert into workflows (organization_id, name, preset, preset_config, draft_definition) values ('a0000000-0000-0000-0000-0000000000d1', 'twin', 'notify', '{"event":"products_synced","channel":"discord","url":"https://discord.com/api/webhooks/2/b"}', '{}')$$)
  like 'This exact automation already exists: "Sync to channel two"%');
reset role;

-- ------------------------------------------------------------------------------------------------ the counts
select da_test.as_user('00000000-0000-0000-0000-0000000000d4');
select da_test.check('the Tenants list counts only automations that still exist (two live ones, one deleted)',
  (select workflows = 2 from admin_list_tenants() where id = 'a0000000-0000-0000-0000-0000000000d1'));
reset role;

select 'PASSED' as delete_automation;
rollback;
