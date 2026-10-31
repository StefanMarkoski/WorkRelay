-- Failure retention (0036): the setting and who may change it, the preview count, and the automatic cleanup.
begin;

create schema fr2_test;
grant usage on schema fr2_test to authenticated;
create function fr2_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function fr2_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function fr2_test.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema fr2_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'owner@fr2.dev'), ('00000000-0000-0000-0000-0000000000b8', 'member@fr2.dev'), ('00000000-0000-0000-0000-0000000000c8', 'other@fr2.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000a8', 'Org A', '00000000-0000-0000-0000-0000000000a8'),
  ('a0000000-0000-0000-0000-0000000000b8', 'Org B', '00000000-0000-0000-0000-0000000000c8');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a8', 'owner'),
  ('a0000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000b8', 'member'),
  ('a0000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000c8', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-0000000000a8', 'Alpha', 'connected', 'wr_live_a801', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000a8'),
  ('a1000000-0000-0000-0000-0000000000b8', 'a0000000-0000-0000-0000-0000000000b8', 'Beta', 'connected', 'wr_live_b801', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000c8');

-- Org A (default 90 days): failed events 10, 40 and 100 days old; a processed and an ignored event 200 days old.
-- Org B: a failed event 100 days old (its owner will keep failures for 365 days).
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at) values
  ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'f10', 'order.created', 'failed', '{}', 'x', now() - interval '10 days'),
  ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'f40', 'order.created', 'failed', '{}', 'x', now() - interval '40 days'),
  ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'f100', 'order.created', 'failed', '{}', 'x', now() - interval '100 days'),
  ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'p200', 'order.created', 'processed', '{}', null, now() - interval '200 days'),
  ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'i200', 'order.paid', 'ignored', '{}', 'unsupported', now() - interval '200 days'),
  ('a0000000-0000-0000-0000-0000000000b8', 'a1000000-0000-0000-0000-0000000000b8', 'bf100', 'order.created', 'failed', '{}', 'x', now() - interval '100 days');
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-0000000000a8', 'Notify');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000a8', 'a4000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-0000000000a8', 1, '{}');
insert into workflow_runs (id, organization_id, workflow_id, version_id, trigger_source, status, error, finished_at, created_at) values
  ('a6000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a8', 'a4000000-0000-0000-0000-0000000000a8', 'a5000000-0000-0000-0000-0000000000a8', 'order', 'failed', 'x', now() - interval '50 days', now() - interval '50 days'),
  ('a6000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a8', 'a4000000-0000-0000-0000-0000000000a8', 'a5000000-0000-0000-0000-0000000000a8', 'order', 'failed', 'x', now() - interval '120 days', now() - interval '120 days'),
  ('a6000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a8', 'a4000000-0000-0000-0000-0000000000a8', 'a5000000-0000-0000-0000-0000000000a8', 'order', 'succeeded', null, now() - interval '300 days', now() - interval '300 days');
insert into step_runs (organization_id, run_id, step_key, status) values ('a0000000-0000-0000-0000-0000000000a8', 'a6000000-0000-0000-0000-0000000000a2', 's1', 'failed');

select fr2_test.as_user('00000000-0000-0000-0000-0000000000a8');
select fr2_test.check('the default is 90 days', (select failure_retention_days = 90 from organizations where id = 'a0000000-0000-0000-0000-0000000000a8'));
select fr2_test.check('the preview counts failed events and failed runs older than a number of days, and nothing else',
  (select failures_older_than('a0000000-0000-0000-0000-0000000000a8', 90) = 2)   -- the 100-day event and the 120-day run
  and (select failures_older_than('a0000000-0000-0000-0000-0000000000a8', 30) = 4) -- plus the 40-day event and the 50-day run
  and (select failures_older_than('a0000000-0000-0000-0000-0000000000a8', 365) = 0)
  and (select failures_older_than('a0000000-0000-0000-0000-0000000000a8', 5) = 5));
select fr2_test.check('and it does not look into another workspace',
  (select failures_older_than('a0000000-0000-0000-0000-0000000000b8', 1) = 0));

select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 365) as r365 \gset
select fr2_test.check('an owner can change it, and 365 is the largest allowed; nothing is older, so nothing is removed',
  (select failure_retention_days = 365 from organizations where id = 'a0000000-0000-0000-0000-0000000000a8') and :r365 = 0
  and (select count(*) = 5 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000a8'));
select fr2_test.fails('0 days is refused', $$select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 0)$$);
select fr2_test.fails('366 days is refused', $$select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 366)$$);
select fr2_test.fails('nothing is refused as a number', $$select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', null)$$);
select fr2_test.check('and a refused number changes nothing', (select failure_retention_days = 365 from organizations where id = 'a0000000-0000-0000-0000-0000000000a8')
  and (select count(*) = 5 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000a8'));

select fr2_test.as_user('00000000-0000-0000-0000-0000000000b8');
select fr2_test.fails('a plain member cannot change it', $$select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 1)$$);
select fr2_test.fails('and cannot write the column directly', $$update organizations set failure_retention_days = 1 where id = 'a0000000-0000-0000-0000-0000000000a8'$$);
select fr2_test.as_user('00000000-0000-0000-0000-0000000000c8');
select fr2_test.fails('someone from another workspace cannot change it', $$select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 1)$$);
select fr2_test.check('and nothing was deleted by those attempts', (select count(*) = 5 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000a8') is not null);
select fr2_test.as_user('00000000-0000-0000-0000-0000000000a8');

-- saving a smaller number removes the older failures at once, with no waiting for the cleanup
select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 30) as r30 \gset
select fr2_test.check('saving 30 removed 2 failed events and 2 failed runs on the spot (older than 30 days)', :r30 = 4);
select fr2_test.check('Org A kept its recent failed event and everything that is not a failure, and the runs'' steps went with them',
  (select array_agg(event_id order by event_id) = array['f10', 'i200', 'p200'] from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000a8')
  and (select array_agg(id::text order by id) = array['a6000000-0000-0000-0000-0000000000a3'] from workflow_runs where organization_id = 'a0000000-0000-0000-0000-0000000000a8')
  and (select count(*) = 0 from step_runs where run_id = 'a6000000-0000-0000-0000-0000000000a2'));
reset role; -- the owner of Org A cannot see Org B's rows, so look as the administrator
select fr2_test.check('another workspace is not touched', (select count(*) = 1 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000b8'));
select fr2_test.as_user('00000000-0000-0000-0000-0000000000a8');

-- 1 day: everything older than a day goes immediately, including a failure only 2 days old
reset role;
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at)
values ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'f2', 'order.created', 'failed', '{}', 'x', now() - interval '2 days'),
       ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'fnow', 'order.created', 'failed', '{}', 'x', now() - interval '3 hours');
select fr2_test.as_user('00000000-0000-0000-0000-0000000000a8');
select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 1) as r1 \gset
select fr2_test.check('saving 1 day removed the 10-day and the 2-day failed events at once, and kept the one from 3 hours ago',
  :r1 = 2 and (select array_agg(event_id order by event_id) = array['fnow', 'i200', 'p200'] from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000a8'));
select set_failure_retention('a0000000-0000-0000-0000-0000000000a8', 30);

reset role;
select fr2_test.check('only the engine (service role) may run the cleanup',
  (select not has_function_privilege('authenticated', 'public.purge_old_failures()', 'execute')) and (select has_function_privilege('service_role', 'public.purge_old_failures()', 'execute'))
  and (select not has_function_privilege('authenticated', 'public.purge_org_failures(uuid, int)', 'execute')));

-- the engine's cleanup keeps it true afterwards
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at)
values ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'late', 'order.created', 'failed', '{}', 'x', now() - interval '60 days');
select purge_old_failures() as removed_a \gset
select fr2_test.check('the engine''s cleanup removes a failure that became too old, and applies each workspace''s own number: Org B keeps 90 days, so its 100-day-old failure goes too',
  :removed_a = 2 and (select count(*) = 0 from webhook_events where event_id in ('late', 'bf100')));
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at)
values ('a0000000-0000-0000-0000-0000000000a8', 'a1000000-0000-0000-0000-0000000000a8', 'late2', 'order.created', 'failed', '{}', 'x', now() - interval '60 days');
select purge_old_failures() as removed_b \gset
select fr2_test.check('a second call right away does nothing (at most once every 5 minutes)', :removed_b = 0 and (select count(*) = 1 from webhook_events where event_id = 'late2'));
update maintenance_state set last_run = now() - interval '6 minutes';
select purge_old_failures() as removed_c \gset
select fr2_test.check('after 5 minutes it runs again', :removed_c = 1);

-- a huge backlog is worked off in pieces of 2000, each call carrying on at once until it is done
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, received_at)
select 'a0000000-0000-0000-0000-0000000000b8', 'a1000000-0000-0000-0000-0000000000b8', 'bulk' || g, 'order.created', 'failed', '{}', 'x', now() - interval '200 days' from generate_series(1, 4500) g;
select fr2_test.as_user('00000000-0000-0000-0000-0000000000c8');
select set_failure_retention('a0000000-0000-0000-0000-0000000000b8', 100) as rbulk \gset
reset role;
select fr2_test.check('saving a smaller number for 4500 old failures removes the first 2000 at once (it is capped per pass)',
  :rbulk = 2000 and (select count(*) = 2500 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000b8'));
update maintenance_state set last_run = now() - interval '6 minutes';
select purge_old_failures() as bulk1 \gset
select purge_old_failures() as bulk2 \gset
select purge_old_failures() as bulk3 \gset
select fr2_test.check('the engine carries on straight away while a pass hits its limit: 2000, then the last 500, then it rests',
  :bulk1 = 2000 and :bulk2 = 500 and :bulk3 = 0 and (select count(*) = 0 from webhook_events where organization_id = 'a0000000-0000-0000-0000-0000000000b8'));

rollback;
select 'FAILURE RETENTION CHECKS PASSED';
