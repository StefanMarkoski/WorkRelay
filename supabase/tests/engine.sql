-- Enqueueing, idempotency, leases, timeouts, approvals-resume gating, manual runs.
begin;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@e.dev'), ('00000000-0000-0000-0000-0000000000b2', 'member@e.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000b1', 'Org', '00000000-0000-0000-0000-0000000000b1');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'member');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'S', 'connected', 'wr_live_yyyy', extensions.digest('k', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000b1');

-- three published+enabled workflows (created / status=completed / any webhook) and one disabled
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'on created'),
  ('a4000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'on completed'),
  ('a4000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000b1', 'on webhook'),
  ('a4000000-0000-0000-0000-0000000000b4', 'a0000000-0000-0000-0000-0000000000b1', 'disabled');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000b' || n)::uuid, ('a4000000-0000-0000-0000-0000000000b' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000b1', 1, def
from (values
  (1, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"order_status_changed","to_status":"completed"},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"webhook","integration_id":"a1000000-0000-0000-0000-0000000000b1"},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000b' || right(w.id::text, 1))::uuid;
update workflows set enabled = true where id <> 'a4000000-0000-0000-0000-0000000000b4';

insert into orders (id, organization_id, integration_id, external_id, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '1', now());

-- order.created -> created + webhook workflows (not the completed one, not the disabled one)
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 'external', 'order.created', now(), '{"event_id":"e1","applied":["order_number"]}');
select pg_temp.check('created event enqueues created + webhook workflows only',
  (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000b1','a4000000-0000-0000-0000-0000000000b3')) from workflow_runs));
select pg_temp.check('run references the published version and carries order context',
  (select bool_and(version_id is not null and context->'order'->>'external_id' = '1' and context->'event'->>'id' = 'e1') from workflow_runs));

-- status change to completed -> completed workflow + webhook workflow
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 'external', 'order.status_changed', now(),
   '{"event_id":"e2","applied":["status"],"status_from":"pending","status_to":"completed"}');
select pg_temp.check('status change enqueues the matching workflows',
  (select count(*) from workflow_runs where event_id = 'e2' and workflow_id = 'a4000000-0000-0000-0000-0000000000b2') = 1);

-- a stale status (not applied) enqueues nothing for status triggers
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 'external', 'order.status_changed', now(),
   '{"event_id":"e3","applied":[],"stale":["status"],"status_to":null}');
select pg_temp.check('stale status change does not trigger status workflows',
  (select count(*) from workflow_runs where event_id = 'e3' and workflow_id = 'a4000000-0000-0000-0000-0000000000b2') = 0);

-- same event again (duplicate delivery) does not duplicate runs
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 'external', 'order.created', now(), '{"event_id":"e1","applied":[]}');
select pg_temp.check('repeated event id creates no duplicate runs', (select count(*) from workflow_runs where event_id = 'e1') = 2);

-- WorkRelay notes never trigger workflows
insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 'workrelay', 'note.added', now(), '{"note":"x"}');
select pg_temp.check('internal notes do not enqueue runs', (select count(*) from workflow_runs) = 5);

-- claiming: leases prevent double processing
select pg_temp.check('claim returns due runs and marks them running',
  (select count(*) = 5 and bool_and(status = 'running' and locked_until > now() and attempt = 1 and deadline_at > now()) from claim_runs(10, 60)));
select pg_temp.check('a second claim gets nothing while leases are held', (select count(*) from claim_runs(10, 60)) = 0);

-- crash recovery: expired lease -> claimable again
update workflow_runs set locked_until = now() - interval '1 second';
select pg_temp.check('expired leases are re-claimed', (select count(*) = 5 and bool_and(attempt = 2) from claim_runs(10, 60)));

-- backoff: next_run_at in the future is not claimed
update workflow_runs set locked_until = null, status = 'pending', next_run_at = now() + interval '1 hour';
select pg_temp.check('runs scheduled for later are not claimed', (select count(*) from claim_runs(10, 60)) = 0);

-- timeouts
update workflow_runs set status = 'running', next_run_at = now(), deadline_at = now() - interval '1 second' where event_id = 'e2';
select pg_temp.check('sweep fails overdue runs', sweep_run_timeouts() = (select count(*) from workflow_runs where event_id = 'e2')::int);
select pg_temp.check('timed-out runs record the reason', (select bool_and(status = 'failed' and error = 'Execution timed out' and finished_at is not null) from workflow_runs where event_id = 'e2'));

-- approval gating: a waiting run is only claimed once its approval is decided
delete from workflow_runs;
insert into workflow_runs (id, organization_id, workflow_id, version_id, trigger_source, status, current_step_key) values
  ('a6000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a5000000-0000-0000-0000-0000000000b1', 'manual', 'waiting_approval', 'ask');
insert into approvals (id, organization_id, run_id, step_key, title) values
  ('a7000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'a6000000-0000-0000-0000-0000000000b1', 'ask', 'Approve?');
select pg_temp.check('run waiting on a pending approval is not claimed', (select count(*) from claim_runs(10, 60)) = 0);
select pg_temp.check('timeout sweep ignores runs waiting for a human', sweep_run_timeouts() = 0);
update approvals set status = 'approved', decided_at = now(), decided_by = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check('decided approval makes the run claimable and extends its deadline',
  (select count(*) = 1 and bool_and(deadline_at > now()) from claim_runs(10, 60)));
do $$ begin
  begin
    insert into approvals (organization_id, run_id, step_key, title)
      values ('a0000000-0000-0000-0000-0000000000b1', 'a6000000-0000-0000-0000-0000000000b1', 'ask', 'Again');
    raise exception 'FAIL: duplicate approval for the same run step was accepted';
  exception when unique_violation then raise notice 'ok   - duplicate approval for the same run step is rejected'; end;
end $$;

-- manual runs: roles and published-version requirement
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b1', 'unpublished');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin
  begin perform start_manual_run('a4000000-0000-0000-0000-0000000000b1'); raise exception 'FAIL: member started a manual run';
  exception when insufficient_privilege then raise notice 'ok   - members cannot start manual runs'; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ begin
  begin perform start_manual_run('a4000000-0000-0000-0000-0000000000b9'); raise exception 'FAIL: ran an unpublished workflow';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   - unpublished workflows cannot run'; end;
end $$;
select start_manual_run('a4000000-0000-0000-0000-0000000000b1') as rid \gset
reset role;
select pg_temp.check('owner starts a manual run pinned to the live version',
  (select status = 'pending' and trigger_source = 'manual' and version_id = 'a5000000-0000-0000-0000-0000000000b1' from workflow_runs where id = :'rid'));

rollback;
\echo ENGINE SQL CHECKS PASSED
