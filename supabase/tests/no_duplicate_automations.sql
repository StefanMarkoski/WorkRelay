-- The exact same automation cannot be created twice (0023): what counts as the same, create and edit, switched-off twins,
-- other workspaces, existing duplicates, and that the key never holds the destination URL.
begin;

create schema nd_test;
grant usage on schema nd_test to authenticated;
create function nd_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function nd_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- the message of the error a statement raises, or 'ok'
create function nd_test.code(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function nd_test.state(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlstate; end $$;
grant execute on all functions in schema nd_test to authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f9', 'owner@nd.dev'), ('00000000-0000-0000-0000-0000000000f8', 'other@nd.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000f9', 'Org A', '00000000-0000-0000-0000-0000000000f9'),
  ('a0000000-0000-0000-0000-0000000000f8', 'Org B', '00000000-0000-0000-0000-0000000000f8');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000f9', 'owner'),
  ('a0000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f8', 'owner');

-- one way to create an automation, as the app does it
create function nd_test.make(org uuid, nm text, kind text, cfg text) returns text language plpgsql as $$
begin
  insert into workflows (organization_id, name, preset, preset_config, draft_definition) values (org, nm, kind, cfg::jsonb, '{}');
  return 'ok';
exception when others then return sqlerrm;
end $$;
grant execute on function nd_test.make(uuid, text, text, text) to authenticated;

select nd_test.as_user('00000000-0000-0000-0000-0000000000f9');
select nd_test.check('a first automation is created',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'Notify Discord when a new order arrives', 'notify',
    '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}') = 'ok');

-- ------------------------------------------------------------------------------------------------ the same automation
select nd_test.check('the exact same automation is refused, and the message names the one that exists (a new one starts switched off)',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'Whatever I call it', 'notify',
    '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}')
  = 'This exact automation already exists: "Notify Discord when a new order arrives" (it is turned off). Edit that one instead.');
select nd_test.check('the error is the standard "already exists" kind (23505), so any client can tell',
  nd_test.state($$insert into workflows (organization_id, name, preset, preset_config, draft_definition) values ('a0000000-0000-0000-0000-0000000000f9', 'x', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}', '{}')$$) = '23505');
select nd_test.check('...and nothing was created by the refused tries', (select count(*) = 1 from workflows));
select nd_test.check('the name does not matter, spaces and trailing slashes in the URL do not, nor does the order of keys',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'Other name', 'notify',
    '{"url":"  https://discord.com/api/webhooks/1/TOKEN/ ","channel":"discord","event":"created"}') like 'This exact automation already exists%');

-- ------------------------------------------------------------------------------------------------ not the same
select nd_test.check('a different event, channel or destination is a different automation',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'cancelled', 'notify', '{"event":"cancelled","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'slack', 'notify', '{"event":"created","channel":"slack","url":"https://discord.com/api/webhooks/1/TOKEN"}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'other channel', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/2/TOKEN"}') = 'ok');
select nd_test.check('the URL is compared exactly where it matters: a token that differs only in letter case is a different destination',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'token case', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/token"}') = 'ok');

-- ------------------------------------------------------------------------------------------------ shops
select nd_test.check('limited to shops: the same list in another order is the same, a different list is not, and "all shops" is not "one shop"',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's1', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x","integration_ids":["B","a"]}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's2', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x","integration_ids":["A","b"]}') like 'This exact automation already exists%'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's3', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x","integration_ids":["a"]}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's4', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x"}') = 'ok');
select nd_test.check('the older single-shop form means the same as a list of one, and an empty list means all shops',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's5', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x","integration_id":"a"}') like 'This exact automation already exists%'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 's6', 'notify', '{"event":"customer_signed_up","channel":"slack","url":"https://hooks.slack.com/x","integration_ids":[]}') like 'This exact automation already exists%');

-- ------------------------------------------------------------------------------------------------ large-order review
select nd_test.check('a large-order review: the same amount written differently is the same, another amount or reviewer is not',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'r1', 'review_large', '{"threshold":100,"reviewer_role":"admin"}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'r2', 'review_large', '{"threshold":"100.00","reviewer_role":"admin"}') like 'This exact automation already exists%'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'r3', 'review_large', '{"threshold":150,"reviewer_role":"admin"}') = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'r4', 'review_large', '{"threshold":100,"reviewer_role":"owner"}') = 'ok');

-- ------------------------------------------------------------------------------------------------ editing
select nd_test.check('editing one automation into another''s exact settings is refused',
  nd_test.code($$update workflows set preset_config = '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}' where name = 'cancelled'$$)
  like 'This exact automation already exists: "Notify Discord when a new order arrives"%');
select nd_test.check('saving an automation with its own settings again is fine (it is not its own duplicate)',
  nd_test.code($$update workflows set preset_config = '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}' where name = 'Notify Discord when a new order arrives'$$) = 'ok');
select nd_test.check('changing it to something new is fine, and frees the old settings for a new one',
  nd_test.code($$update workflows set preset_config = '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/9/NEW"}' where name = 'Notify Discord when a new order arrives'$$) = 'ok'
  and nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'reuse', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}') = 'ok');

-- ------------------------------------------------------------------------------------------------ switched off still counts
update workflows set enabled = false where name = 'reuse';
-- publish and switch on the "cancelled" automation, as the app does after creating it
reset role;
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
  select 'a5000000-0000-0000-0000-0000000000f9', id, organization_id, 1, '{"trigger":{"type":"order_status_changed"},"steps":[]}' from workflows where name = 'cancelled';
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000f9', enabled = true where name = 'cancelled';
select nd_test.as_user('00000000-0000-0000-0000-0000000000f9');
select nd_test.check('a switched-on twin is refused with "turned on"',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'again cancelled', 'notify', '{"event":"cancelled","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}')
  = 'This exact automation already exists: "cancelled" (it is turned on). Edit that one instead.');
select nd_test.check('a switched-off twin still counts, and the message says it is off',
  nd_test.make('a0000000-0000-0000-0000-0000000000f9', 'again', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}')
  = 'This exact automation already exists: "reuse" (it is turned off). Edit that one instead.');
reset role;

-- ------------------------------------------------------------------------------------------------ other workspaces and custom workflows
select nd_test.as_user('00000000-0000-0000-0000-0000000000f8');
select nd_test.check('another workspace can have the same settings (the check is per workspace)',
  nd_test.make('a0000000-0000-0000-0000-0000000000f8', 'mine', 'notify', '{"event":"created","channel":"discord","url":"https://discord.com/api/webhooks/1/TOKEN"}') = 'ok');
reset role;
select nd_test.as_user('00000000-0000-0000-0000-0000000000f9');
select nd_test.check('a workflow that is not a preset is never checked',
  nd_test.code($$insert into workflows (organization_id, name, draft_definition) values ('a0000000-0000-0000-0000-0000000000f9', 'custom', '{}')$$) = 'ok'
  and nd_test.code($$insert into workflows (organization_id, name, draft_definition) values ('a0000000-0000-0000-0000-0000000000f9', 'custom', '{}')$$) = 'ok');

-- ------------------------------------------------------------------------------------------------ the key itself
reset role;
select nd_test.check('the key is a hash: it never contains the destination URL or its token',
  (select bool_and(preset_key ~ '^[0-9a-f]{64}$' and preset_key not ilike '%discord%' and preset_key not ilike '%token%') from workflows where preset is not null));
select nd_test.as_user('00000000-0000-0000-0000-0000000000f9');
select nd_test.check('a user cannot write the key themselves',
  nd_test.code($$update workflows set preset_key = 'x'$$) like '%permission denied%');
reset role;

-- ------------------------------------------------------------------------------------------------ duplicates that already exist
-- Make two identical automations the way the old code could (trigger off), then run the backfill statement from the migration.
alter table workflows disable trigger workflows_preset_key_check;
insert into workflows (id, organization_id, name, preset, preset_config, draft_definition) values
  ('a4000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f9', 'legacy A', 'notify', '{"event":"cancelled","channel":"slack","url":"https://hooks.slack.com/legacy"}', '{}'),
  ('a4000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f9', 'legacy B', 'notify', '{"event":"cancelled","channel":"slack","url":"https://hooks.slack.com/legacy"}', '{}');
alter table workflows enable trigger workflows_preset_key_check;
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000f1', 'a4000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f9', 1, '{"trigger":{"type":"order_status_changed"},"steps":[]}'),
  ('a5000000-0000-0000-0000-0000000000f2', 'a4000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f9', 1, '{"trigger":{"type":"order_status_changed"},"steps":[]}');
update workflows set current_version_id = ('a5000000-0000-0000-0000-0000000000f' || right(id::text, 1))::uuid, enabled = true where name in ('legacy A', 'legacy B');
update workflows set preset_key = preset_fingerprint(preset, preset_config) where preset is not null;
select nd_test.check('existing duplicates are kept as they are, and share one key so the app can point them out',
  (select count(*) = 2 and count(distinct preset_key) = 1 from workflows where name in ('legacy A', 'legacy B')));
select nd_test.as_user('00000000-0000-0000-0000-0000000000f9');
select nd_test.check('an old duplicate can be switched off (that is how it is fixed)',
  nd_test.code($$update workflows set enabled = false where name = 'legacy B'$$) = 'ok');
select nd_test.check('...and that really turned off the one asked, not the other',
  (select not enabled from workflows where name = 'legacy B') and (select enabled from workflows where name = 'legacy A'));
select nd_test.check('but its settings cannot be re-saved while the other one exists',
  nd_test.code($$update workflows set preset_config = '{"event":"cancelled","channel":"slack","url":"https://hooks.slack.com/legacy"}' where name = 'legacy B'$$) like 'This exact automation already exists: "legacy A"%');
reset role;

select 'PASSED' as no_duplicate_automations;
rollback;
