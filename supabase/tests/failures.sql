-- Failures (0032): failed events and failed runs in one list, newest first, filters, windows, paging, isolation.
begin;

create schema fl_test;
grant usage on schema fl_test to authenticated;
create function fl_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function fl_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema fl_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@fl.dev'), ('00000000-0000-0000-0000-0000000000c2', 'other@fl.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000c1', 'Org A', '00000000-0000-0000-0000-0000000000c1'),
  ('a0000000-0000-0000-0000-0000000000c2', 'Org B', '00000000-0000-0000-0000-0000000000c2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Alpha', 'connected', 'wr_live_c001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000c1'),
  ('a1000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'Beta', 'connected', 'wr_live_c002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000c1'),
  ('a1000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000c2', 'Gamma', 'connected', 'wr_live_c003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000c2');

-- events: two failed in Alpha (one recent, one 3 days old), one failed in Beta, one 20 days old, one ignored, one processed, one of Org B
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at) values
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'e1', 'order.created', 'failed', '{}', 'order.totals.total_minor: Too small: expected number to be >=0', now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'e2', 'inventory.push', 'failed', '{}', 'malformed_json', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c2', 'e3', 'customer.created', 'failed', '{}', 'internal error', now() - interval '2 hours'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'e4', 'order.created', 'failed', '{}', 'old failure', now() - interval '20 days'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'e5', 'order.paid', 'ignored', '{}', 'unsupported event_type: order.paid', now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1', 'e6', 'order.created', 'processed', '{}', null, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-0000000000c2', 'a1000000-0000-0000-0000-0000000000c3', 'e7', 'order.created', 'failed', '{}', 'secret of another workspace', now() - interval '1 hour');
-- runs: one failed 30 minutes ago, one succeeded, one failed 10 days ago
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Notify Discord');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000c1', 'a4000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 1, '{}');
insert into workflow_runs (id, organization_id, workflow_id, version_id, trigger_source, status, error, finished_at, created_at) values
  ('a6000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'a4000000-0000-0000-0000-0000000000c1', 'a5000000-0000-0000-0000-0000000000c1', 'order', 'failed', 'Step "Post" failed: HTTP 404', now() - interval '30 minutes', now() - interval '31 minutes'),
  ('a6000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'a4000000-0000-0000-0000-0000000000c1', 'a5000000-0000-0000-0000-0000000000c1', 'order', 'succeeded', null, now() - interval '30 minutes', now() - interval '31 minutes'),
  ('a6000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000c1', 'a4000000-0000-0000-0000-0000000000c1', 'a5000000-0000-0000-0000-0000000000c1', 'order', 'failed', 'Execution timed out', now() - interval '10 days', now() - interval '10 days');

select fl_test.as_user('00000000-0000-0000-0000-0000000000c1');

select fl_test.check('the last 7 days hold the 3 failed events and the 1 failed run, newest first; ignored and processed events and successful runs are left out',
  (select count(*) = 4 and max(total_count) = 4 from list_failures('a0000000-0000-0000-0000-0000000000c1'))
  and (select array_agg(coalesce(ref, 'run') order by ordinality) = array['run', 'e1', 'e3', 'e2']
         from list_failures('a0000000-0000-0000-0000-0000000000c1') with ordinality)
  and (select array_agg(kind order by ordinality) = array['run', 'event', 'event', 'event'] from list_failures('a0000000-0000-0000-0000-0000000000c1') with ordinality));
select fl_test.check('a day only covers what failed in the last 24 hours: 2 events and the run',
  (select count(*) = 3 from list_failures('a0000000-0000-0000-0000-0000000000c1', null, null, 1)));
select fl_test.check('30 days reaches the old event and the old run',
  (select count(*) = 6 from list_failures('a0000000-0000-0000-0000-0000000000c1', null, null, 30)));
select fl_test.check('by kind: events or runs only',
  (select count(*) = 3 and bool_and(kind = 'event') from list_failures('a0000000-0000-0000-0000-0000000000c1', 'event'))
  and (select count(*) = 1 and bool_and(kind = 'run' and subject = 'Notify Discord' and error like '%HTTP 404%') from list_failures('a0000000-0000-0000-0000-0000000000c1', 'run')));
select fl_test.check('by shop: only that shop''s events (a run belongs to no shop, so it is not listed)',
  (select count(*) = 2 and bool_and(integration_name = 'Alpha') from list_failures('a0000000-0000-0000-0000-0000000000c1', null, 'a1000000-0000-0000-0000-0000000000c1')));
select fl_test.check('an event carries its shop, its type and its id',
  (select integration_name = 'Beta' and subject = 'customer.created' and ref = 'e3' and error = 'internal error' from list_failures('a0000000-0000-0000-0000-0000000000c1', 'event') where ref = 'e3'));
select fl_test.check('paging',
  (select count(*) = 2 and max(total_count) = 4 from list_failures('a0000000-0000-0000-0000-0000000000c1', null, null, 7, 2, 0))
  and (select count(*) = 2 from list_failures('a0000000-0000-0000-0000-0000000000c1', null, null, 7, 2, 2)));

select fl_test.as_user('00000000-0000-0000-0000-0000000000c2');
select fl_test.check('another workspace sees only its own failure, never the first workspace''s',
  (select count(*) = 1 and bool_and(error = 'secret of another workspace') from list_failures('a0000000-0000-0000-0000-0000000000c2'))
  and (select count(*) = 0 from list_failures('a0000000-0000-0000-0000-0000000000c1')));

rollback;
select 'FAILURES CHECKS PASSED';
