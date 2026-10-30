-- Manual status edits (set_order_statuses): roles, validation, no-op edits, timeline events and automation triggers.
begin;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

create schema mt_test;
grant usage on schema mt_test to authenticated;

create function mt_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end $$;

create function mt_test.fails(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', label, sqlstate, sqlerrm; end if;
    raise notice 'ok   - % [%]', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema mt_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@m.dev'), ('00000000-0000-0000-0000-0000000000c2', 'admin@m.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'member@m.dev'), ('00000000-0000-0000-0000-0000000000c4', 'other@m.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'Org', '00000000-0000-0000-0000-0000000000c1'),
  ('a0000000-0000-0000-0000-0000000000c2', 'Other org', '00000000-0000-0000-0000-0000000000c4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', 'admin'),
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3', 'member'),
  ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c4', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'S', 'connected', 'wr_live_mmmm', extensions.digest('k', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000c1');

-- three published, enabled workflows: status -> shipped-ish, any status change, order created; one webhook trigger
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'on completed'),
  ('a4000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'on any status'),
  ('a4000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000c1', 'on created'),
  ('a4000000-0000-0000-0000-0000000000c4', 'a0000000-0000-0000-0000-0000000000c1', 'on webhook');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000c' || n)::uuid, ('a4000000-0000-0000-0000-0000000000c' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000c1', 1, def
from (values
  (1, '{"trigger":{"type":"order_status_changed","to_status":"completed"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"order_status_changed"},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"webhook","integration_id":"a1000000-0000-0000-0000-0000000000c1"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000c' || right(w.id::text, 1))::uuid, enabled = true
where organization_id = 'a0000000-0000-0000-0000-0000000000c1';

insert into orders (id, organization_id, integration_id, external_id, status, payment_status, fulfillment_status, external_status, last_event_at)
values ('a3000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1',
        '1', 'pending', 'paid', 'unfulfilled', 'Awaiting Shipment', now() - interval '1 day');

-- ------------------------------------------------------------- who may edit (any member, nobody outside), and what may be set
set local role authenticated;
select mt_test.as_user('00000000-0000-0000-0000-0000000000c4');
select mt_test.fails('another organization cannot edit', $$ select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'completed') $$, '42501');
select mt_test.as_user('00000000-0000-0000-0000-0000000000c2');
select mt_test.fails('a made-up value is rejected', $$ select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'shipped') $$);
select mt_test.fails('"unknown" cannot be chosen', $$ select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', null, 'unknown') $$);
select mt_test.fails('an empty edit is rejected', $$ select set_order_statuses('a3000000-0000-0000-0000-0000000000c1') $$);
select mt_test.fails('a note over 500 characters is rejected', format($$ select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'completed', null, null, %L) $$, repeat('x', 501)));
reset role;
select pg_temp.check('rejected edits changed nothing and wrote no event',
  (select status = 'pending' and version = 1 from orders where id = 'a3000000-0000-0000-0000-0000000000c1')
  and (select count(*) = 0 from order_events) and (select count(*) = 0 from workflow_runs));

-- ------------------------------------------------------------- a no-op edit
set local role authenticated;
select mt_test.as_user('00000000-0000-0000-0000-0000000000c2');
select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'pending', 'paid') as noop \gset
reset role;
select pg_temp.check('setting the values it already has returns false and writes nothing',
  :'noop' = 'f' and (select count(*) = 0 from order_events) and (select version = 1 from orders where id = 'a3000000-0000-0000-0000-0000000000c1'));

-- ------------------------------------------------------------- a payment-only edit fires no status automation
set local role authenticated;
select mt_test.as_user('00000000-0000-0000-0000-0000000000c3');
select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', null, 'refunded', null, 'Refunded in the shop admin') as changed \gset
reset role;
select pg_temp.check('a payment-only edit is recorded as order.updated by the member who made it, with the note',
  :'changed' = 't' and (select count(*) = 1 and bool_and(source = 'workrelay' and type = 'order.updated'
     and actor_user_id = '00000000-0000-0000-0000-0000000000c3'
     and data->>'payment_from' = 'paid' and data->>'payment_to' = 'refunded' and data->>'note' = 'Refunded in the shop admin'
     and data->>'by' = 'dashboard') from order_events));
select pg_temp.check('a payment-only edit starts no automation', (select count(*) = 0 from workflow_runs));

-- ------------------------------------------------------------- a status edit
set local role authenticated;
select mt_test.as_user('00000000-0000-0000-0000-0000000000c1');
select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'completed', null, 'fulfilled');
reset role;
select pg_temp.check('the order now holds the new values, a bumped version, and the shop''s own text untouched',
  (select status = 'completed' and payment_status = 'refunded' and fulfillment_status = 'fulfilled'
      and version = 3 and external_status = 'Awaiting Shipment' from orders where id = 'a3000000-0000-0000-0000-0000000000c1'));
select pg_temp.check('each edited field is stamped so an older shop event would be outdated',
  (select (applied_at->>'status')::timestamptz > now() - interval '1 minute'
      and (applied_at->>'fulfillment_status')::timestamptz > now() - interval '1 minute'
      and (applied_at->>'payment_status')::timestamptz > now() - interval '1 minute'
   from orders where id = 'a3000000-0000-0000-0000-0000000000c1'));
select pg_temp.check('the status edit is a status_changed event carrying from and to',
  (select count(*) = 1 from order_events where type = 'order.status_changed' and source = 'workrelay'
     and data->>'status_from' = 'pending' and data->>'status_to' = 'completed' and data->'applied' ? 'status'));
select pg_temp.check('a manual status change starts the status automations only (the matching one and the any-status one)',
  (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000c1', 'a4000000-0000-0000-0000-0000000000c2')
     and trigger_source = 'order_status_changed' and context->'order'->>'status' = 'completed') from workflow_runs));

-- a status that no workflow is waiting for starts only the any-status one
set local role authenticated;
select mt_test.as_user('00000000-0000-0000-0000-0000000000c2');
select set_order_statuses('a3000000-0000-0000-0000-0000000000c1', 'cancelled');
reset role;
select pg_temp.check('a different target status starts only the any-status automation',
  (select count(*) = 1 from workflow_runs where context->'order'->>'status' = 'cancelled'
     and workflow_id = 'a4000000-0000-0000-0000-0000000000c2'));

rollback;
\echo MANUAL STATUS SQL CHECKS PASSED
