-- RLS and authorization tests. Run against a database with all migrations applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
-- Everything runs in one transaction and is rolled back. Any failed check aborts with an error.
begin;

create schema rls_test;
grant usage on schema rls_test to anon, authenticated;

create function rls_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true); -- older auth.uid() implementations read this
  perform set_config('role', 'authenticated', true);
end $$;

create function rls_test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;

create function rls_test.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok   - %', label;
end $$;

-- Runs a DML statement as the current role and returns the number of rows it affected.
create function rls_test.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- The statement must raise an error (any SQLSTATE unless one is given).
create function rls_test.fails(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if state is not null and sqlstate <> state then
      raise exception 'FAIL: % (wrong error %: %)', label, sqlstate, sqlerrm;
    end if;
    raise notice 'ok   - % [%]', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;

grant execute on all functions in schema rls_test to anon, authenticated;

-- Fixtures (as the table owner, which bypasses RLS)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),   -- owner of org A
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),   -- owner of org B
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),   -- member of org A
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),   -- admin of org A
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev'),   -- added to org A during the test
  ('00000000-0000-0000-0000-00000000000f', 'f@test.dev');   -- no organization

insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-000000000001', 'Org A', '00000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000001', 'Org B', '00000000-0000-0000-0000-00000000000b');
insert into memberships (organization_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'member'),
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'admin'),
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'owner');

insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Store A', 'connected', 'wr_live_aaaa', extensions.digest('key-a', 'sha256'), 'store-a', '00000000-0000-0000-0000-00000000000a'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Store B', 'connected', 'wr_live_bbbb', extensions.digest('key-b', 'sha256'), 'store-b', '00000000-0000-0000-0000-00000000000b');

insert into webhook_events (id, organization_id, integration_id, event_id, raw_payload) values
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'evt-a', '{"pii":"secret"}');
insert into orders (id, organization_id, integration_id, external_id, last_event_at) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '1001', now());
insert into order_items (organization_id, order_id, position) values
  ('a0000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 0);
insert into order_events (organization_id, order_id, source, type, occurred_at) values
  ('a0000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'external', 'order.created', now());
insert into workflows (id, organization_id, name, created_by) values
  ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'WF A', '00000000-0000-0000-0000-00000000000a');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1, '{}');
insert into workflow_runs (id, organization_id, workflow_id, version_id, trigger_source) values
  ('a6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'manual');
insert into step_runs (organization_id, run_id, step_key) values
  ('a0000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 's1');
insert into approvals (id, organization_id, run_id, title) values
  ('a7000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'Approve A'),
  ('a7000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'Approve A2'),
  ('a7000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'Approve A3');

-- ---------------------------------------------------------------- tenant isolation
select rls_test.as_user('00000000-0000-0000-0000-00000000000b');  -- user B
select rls_test.eq('B sees only own org', (select count(*) from organizations), 1::bigint);
select rls_test.eq('B sees only own memberships', (select count(*) from memberships), 1::bigint);
select rls_test.eq('B cannot read org A integrations', (select count(*) from integrations where organization_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint);
select rls_test.eq('B cannot read org A webhook events', (select count(*) from webhook_events), 0::bigint);
select rls_test.eq('B cannot read org A orders', (select count(*) from orders), 0::bigint);
select rls_test.eq('B cannot read org A order items', (select count(*) from order_items), 0::bigint);
select rls_test.eq('B cannot read org A order events', (select count(*) from order_events), 0::bigint);
select rls_test.eq('B cannot read org A workflows', (select count(*) from workflows where organization_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint);
select rls_test.eq('B cannot read org A versions', (select count(*) from workflow_versions), 0::bigint);
select rls_test.eq('B cannot read org A runs', (select count(*) from workflow_runs), 0::bigint);
select rls_test.eq('B cannot read org A step runs', (select count(*) from step_runs), 0::bigint);
select rls_test.eq('B cannot read org A approvals', (select count(*) from approvals), 0::bigint);
select rls_test.fails('B cannot create a workflow in org A', $$ insert into workflows (organization_id, name) values ('a0000000-0000-0000-0000-000000000001', 'x') $$);
select rls_test.fails('B cannot create an integration in org A', $$ select create_integration('a0000000-0000-0000-0000-000000000001', 'x', 'MKD') $$, '42501');
select rls_test.fails('B cannot join org A', $$ insert into memberships values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member') $$);
select rls_test.fails('B cannot list org A members', $$ select * from list_members('a0000000-0000-0000-0000-000000000001') $$, '42501');
select rls_test.fails('B cannot rotate org A key', $$ select rotate_integration_key('a1000000-0000-0000-0000-000000000001') $$, '42501');
select rls_test.fails('B cannot revoke org A integration', $$ select revoke_integration('a1000000-0000-0000-0000-000000000001') $$, '42501');
select rls_test.fails('B cannot decide org A approval', $$ select decide_approval('a7000000-0000-0000-0000-000000000001', 'approved') $$);
select rls_test.fails('B cannot note on org A order', $$ select add_order_note('a3000000-0000-0000-0000-000000000001', 'hi') $$);
select rls_test.eq('B cannot rename org A', rls_test.affected($$ update organizations set name = 'pwned' where id = 'a0000000-0000-0000-0000-000000000001' $$), 0::bigint);
select rls_test.eq('B cannot update org A workflow', rls_test.affected($$ update workflows set name = 'pwned' where id = 'a4000000-0000-0000-0000-000000000001' $$), 0::bigint);
reset role;

-- ---------------------------------------------------------------- owner A
select rls_test.as_user('00000000-0000-0000-0000-00000000000a');
select rls_test.eq('A sees own org only', (select count(*) from organizations), 1::bigint);
select rls_test.eq('A sees own integration', (select count(*) from integrations), 1::bigint);
select rls_test.eq('A sees own orders', (select count(*) from orders), 1::bigint);
select rls_test.eq('owner can read workflows and versions', (select count(*) from workflows) + (select count(*) from workflow_versions), 2::bigint);
select rls_test.eq('owner can create a preset workflow', rls_test.affected($$ insert into workflows (organization_id, name, preset, preset_config, draft_definition) values ('a0000000-0000-0000-0000-000000000001', 'P', 'notify', '{}', '{}') $$), 1::bigint);
select rls_test.fails('unknown preset kinds are rejected', $$ insert into workflows (organization_id, name, preset) values ('a0000000-0000-0000-0000-000000000001', 'P2', 'evil') $$);
select rls_test.eq('A sees own events metadata', (select count(*) from webhook_events), 1::bigint);
select rls_test.fails('key_hash is not readable', $$ select key_hash from integrations $$, '42501');
select rls_test.fails('select * on integrations is denied (hash column)', $$ select * from integrations $$, '42501');
select rls_test.fails('raw_payload is not readable', $$ select raw_payload from webhook_events $$, '42501');
select rls_test.fails('clients cannot write orders', $$ insert into orders (organization_id, integration_id, external_id, last_event_at) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','x', now()) $$);
select rls_test.fails('clients cannot write webhook events', $$ insert into webhook_events (organization_id, integration_id, event_id, raw_payload) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','x','{}') $$);
select rls_test.fails('clients cannot write runs', $$ insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source) values ('a0000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','manual') $$);
select rls_test.fails('clients cannot write approvals', $$ insert into approvals (organization_id, title) values ('a0000000-0000-0000-0000-000000000001','x') $$);
select rls_test.fails('clients cannot change integration status', $$ update integrations set status = 'connected' $$);
select rls_test.fails('clients cannot set the store binding', $$ update integrations set external_store_id = 'evil' $$);
select rls_test.fails('clients cannot call publish_workflow', $$ select publish_workflow('a4000000-0000-0000-0000-000000000001', '{}', '00000000-0000-0000-0000-00000000000a') $$, '42501');
select rls_test.fails('clients cannot call apply_order_plan', $$ select apply_order_plan(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', null, '{}', null, '{}') $$, '42501');
select rls_test.fails('cannot enable a workflow without a published version', $$ update workflows set enabled = true where id = 'a4000000-0000-0000-0000-000000000001' $$);
select rls_test.fails('cannot add an owner through add_member', $$ select add_member_by_email('a0000000-0000-0000-0000-000000000001', 'e@test.dev', 'owner') $$);
select rls_test.fails('sole owner cannot demote self', $$ update memberships set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000a' $$);
select rls_test.eq('A creates integration and gets a key', (select left(secret_key, 8) from create_integration('a0000000-0000-0000-0000-000000000001', 'New store', 'MKD')), 'wr_live_');
select rls_test.eq('A can rename own integration', rls_test.affected($$ update integrations set name = 'Renamed' where id = 'a1000000-0000-0000-0000-000000000001' $$), 1::bigint);
select rls_test.eq('A can add a member by email', (select count(*) from (select add_member_by_email('a0000000-0000-0000-0000-000000000001', 'e@test.dev', 'member')) s), 1::bigint);
select rls_test.fails('unknown email is rejected', $$ select add_member_by_email('a0000000-0000-0000-0000-000000000001', 'nobody@test.dev', 'member') $$);
select rls_test.eq('A lists members of own org', (select count(*) from list_members('a0000000-0000-0000-0000-000000000001')), 4::bigint);
select rls_test.eq('A decides an approval', (select count(*) from (select decide_approval('a7000000-0000-0000-0000-000000000001', 'approved', 'ok')) s), 1::bigint);
select rls_test.fails('an approval cannot be decided twice', $$ select decide_approval('a7000000-0000-0000-0000-000000000001', 'rejected') $$);
select rls_test.fails('invalid decision is rejected', $$ select decide_approval('a7000000-0000-0000-0000-000000000002', 'maybe') $$);
select rls_test.eq('A rotates a key and the old hash stops matching', (
  select (select count(*) from (select rotate_integration_key('a1000000-0000-0000-0000-000000000001')) r) ), 1::bigint);
reset role;
select rls_test.eq('rotated key invalidates the previous hash', (select count(*) from integrations where key_hash = extensions.digest('key-a', 'sha256')), 0::bigint);
select rls_test.eq('approval records the decider', (select decided_by::text from approvals where id = 'a7000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------- plain member C
select rls_test.as_user('00000000-0000-0000-0000-00000000000c');
select rls_test.eq('member can read own org orders', (select count(*) from orders), 1::bigint);
select rls_test.eq('member cannot read workflows (definitions may hold destination URLs)', (select count(*) from workflows), 0::bigint);
select rls_test.eq('member cannot read workflow versions', (select count(*) from workflow_versions), 0::bigint);
select rls_test.eq('member can still read runs', (select count(*) from workflow_runs), 1::bigint);
select rls_test.fails('member cannot create integrations', $$ select create_integration('a0000000-0000-0000-0000-000000000001', 'x', 'MKD') $$, '42501');
select rls_test.fails('member cannot rotate keys', $$ select rotate_integration_key('a1000000-0000-0000-0000-000000000001') $$, '42501');
select rls_test.fails('member cannot revoke', $$ select revoke_integration('a1000000-0000-0000-0000-000000000001') $$, '42501');
select rls_test.fails('member cannot create workflows', $$ insert into workflows (organization_id, name) values ('a0000000-0000-0000-0000-000000000001', 'x') $$);
select rls_test.eq('member cannot edit workflows', rls_test.affected($$ update workflows set name = 'x' where id = 'a4000000-0000-0000-0000-000000000001' $$), 0::bigint);
select rls_test.eq('member cannot rename integration', rls_test.affected($$ update integrations set name = 'x' $$), 0::bigint);
select rls_test.fails('member cannot add members', $$ select add_member_by_email('a0000000-0000-0000-0000-000000000001', 'e@test.dev', 'member') $$, '42501');
select rls_test.eq('member promote attempt changed nothing', rls_test.affected($$ update memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000c' $$), 0::bigint);
select rls_test.fails('member cannot decide admin-level approvals', $$ select decide_approval('a7000000-0000-0000-0000-000000000002', 'approved') $$, '42501');
select rls_test.eq('member can add an internal note', (select count(*) from (select add_order_note('a3000000-0000-0000-0000-000000000001', 'called customer')) s), 1::bigint);
select rls_test.fails('empty note is rejected', $$ select add_order_note('a3000000-0000-0000-0000-000000000001', '   ') $$);
reset role;
select rls_test.eq('note is recorded as a WorkRelay action', (select count(*) from order_events where type = 'note.added' and source = 'workrelay' and actor_user_id = '00000000-0000-0000-0000-00000000000c'), 1::bigint);

-- ---------------------------------------------------------------- admin D
select rls_test.as_user('00000000-0000-0000-0000-00000000000d');
select rls_test.eq('admin can create a workflow', rls_test.affected($$ insert into workflows (organization_id, name) values ('a0000000-0000-0000-0000-000000000001', 'Admin WF') $$), 1::bigint);
select rls_test.eq('admin can decide admin-level approvals', (select count(*) from (select decide_approval('a7000000-0000-0000-0000-000000000002', 'rejected')) s), 1::bigint);
select rls_test.eq('admin cannot promote self to owner', rls_test.affected($$ update memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000d' $$), 0::bigint);
select rls_test.eq('admin cannot delete the owner', rls_test.affected($$ delete from memberships where user_id = '00000000-0000-0000-0000-00000000000a' $$), 0::bigint);
reset role;
select rls_test.eq('owner membership survived', (select count(*) from memberships where user_id = '00000000-0000-0000-0000-00000000000a'), 1::bigint);

-- ---------------------------------------------------------------- reviewer-specific approvals
update approvals set reviewer_user_id = '00000000-0000-0000-0000-00000000000d' where id = 'a7000000-0000-0000-0000-000000000003';
select rls_test.as_user('00000000-0000-0000-0000-00000000000a');
select rls_test.fails('owner cannot decide an approval assigned to someone else', $$ select decide_approval('a7000000-0000-0000-0000-000000000003', 'approved') $$, '42501');
reset role;

-- ---------------------------------------------------------------- user without an organization, and anon
select rls_test.as_user('00000000-0000-0000-0000-00000000000f');
select rls_test.eq('outsider sees no organizations', (select count(*) from organizations), 0::bigint);
select rls_test.eq('outsider sees no orders', (select count(*) from orders), 0::bigint);
select create_organization('Org F') as new_org \gset
select rls_test.eq('outsider can create a workspace and becomes owner',
  (select count(*) from memberships where organization_id = :'new_org' and role = 'owner' and user_id = '00000000-0000-0000-0000-00000000000f'), 1::bigint);
reset role;

select rls_test.as_anon();
select rls_test.fails('anon cannot read orders', $$ select * from orders $$, '42501');
select rls_test.fails('anon cannot read organizations', $$ select * from organizations $$, '42501');
select rls_test.fails('anon cannot create organizations', $$ select create_organization('x') $$, '42501');
select rls_test.fails('anon cannot create integrations', $$ select create_integration('a0000000-0000-0000-0000-000000000001', 'x', 'MKD') $$, '42501');
reset role;

-- ---------------------------------------------------------------- immutability and uniqueness (owner level)
select rls_test.fails('published versions are immutable', $$ update workflow_versions set definition = '{"x":1}' $$);
select rls_test.fails('duplicate webhook event id is rejected', $$ insert into webhook_events (organization_id, integration_id, event_id, raw_payload) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','evt-a','{}') $$, '23505');
select rls_test.fails('duplicate order is rejected', $$ insert into orders (organization_id, integration_id, external_id, last_event_at) values ('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','1001', now()) $$, '23505');
select rls_test.fails('a store cannot be connected twice', $$ insert into integrations (organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values ('b0000000-0000-0000-0000-000000000001','dup','connected','wr_live_cccc', extensions.digest('key-c','sha256'), 'store-a', '00000000-0000-0000-0000-00000000000b') $$, '23505');
select rls_test.fails('duplicate workflow run per event is rejected', $$ insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id) select organization_id, workflow_id, version_id, 'webhook', 'e1' from workflow_runs limit 1; insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id) select organization_id, workflow_id, version_id, 'webhook', 'e1' from workflow_runs limit 1 $$, '23505');

rollback;
\echo ALL RLS CHECKS PASSED
