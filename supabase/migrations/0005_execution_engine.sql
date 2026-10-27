-- Execution engine: durable run queue, event-driven enqueueing, leases, timeouts, manual runs.

alter table public.workflow_runs
  add column context jsonb not null default '{}',
  add column current_step_key text,
  add column step_attempt int not null default 0,
  add column next_run_at timestamptz not null default now(),
  add column locked_until timestamptz,
  add column deadline_at timestamptz;

create index workflow_runs_claim_idx on public.workflow_runs (next_run_at)
  where status in ('pending', 'running', 'waiting_approval');
-- One approval request per run step: re-executing a step cannot create a duplicate request.
create unique index approvals_run_step_uniq on public.approvals (run_id, step_key) where run_id is not null;

-- Matching enabled workflows get one run per (workflow, event); unique (workflow_id, event_id) makes this idempotent.
create function public.enqueue_on_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ord orders; payload jsonb; to_status text; applied jsonb;
begin
  if new.source <> 'external' or new.type not in ('order.created', 'order.updated', 'order.status_changed') then
    return new;
  end if;
  select * into ord from orders where id = new.order_id;
  applied := coalesce(new.data->'applied', '[]');
  to_status := new.data->>'status_to';
  payload := jsonb_build_object(
    'order', to_jsonb(ord) - 'applied_at' - 'data_quality' - 'version',
    'event', jsonb_build_object('id', new.data->>'event_id', 'type', new.type));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id,
         v.definition->'trigger'->>'type',
         coalesce(new.data->>'event_id', new.id::text),
         payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and (
      (v.definition->'trigger'->>'type' = 'webhook' and v.definition->'trigger'->>'integration_id' = ord.integration_id::text)
      or (v.definition->'trigger'->>'type' = 'order_created' and new.type = 'order.created')
      or (v.definition->'trigger'->>'type' = 'order_status_changed' and applied ? 'status'
          and (v.definition->'trigger'->>'to_status' is null or v.definition->'trigger'->>'to_status' = to_status))
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  return new;
end $$;

create trigger order_events_enqueue after insert on public.order_events
  for each row execute function public.enqueue_on_order_event();

-- Manual execution for testing. Requires a published version.
create function public.start_manual_run(p_workflow uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare wf workflows; rid uuid;
begin
  select * into wf from workflows where id = p_workflow;
  if not found or not has_org_role(wf.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if wf.current_version_id is null then raise exception 'publish a version before running'; end if;
  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, context)
    values (wf.organization_id, wf.id, wf.current_version_id, 'manual',
            jsonb_build_object('manual', true, 'event', jsonb_build_object('type', 'manual')))
    returning id into rid;
  return rid;
end $$;
revoke execute on function public.start_manual_run(uuid) from public, anon;
grant execute on function public.start_manual_run(uuid) to authenticated;

-- Lease-based claiming: concurrent workers never process the same run; a crashed worker's lease expires.
create function public.claim_runs(p_limit int, p_lease_seconds int) returns setof public.workflow_runs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select r.id from workflow_runs r
    where r.next_run_at <= now()
      and (r.locked_until is null or r.locked_until < now())
      and (r.status in ('pending', 'running')
           or (r.status = 'waiting_approval' and exists (
                 select 1 from approvals a
                 where a.run_id = r.id and a.step_key = r.current_step_key and a.status <> 'pending')))
    order by r.next_run_at
    limit p_limit
    for update skip locked)
  update workflow_runs r set
    status = 'running',
    locked_until = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(r.started_at, now()),
    attempt = r.attempt + 1,
    deadline_at = case when r.status = 'waiting_approval' then now() + interval '15 minutes'
                       else coalesce(r.deadline_at, now() + interval '15 minutes') end
  from c where r.id = c.id
  returning r.*;
end $$;

-- Runs that exceed their deadline fail. Runs waiting for a human are exempt.
create function public.sweep_run_timeouts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with t as (
    update workflow_runs set status = 'failed', error = 'Execution timed out', finished_at = now(), locked_until = null
    where status in ('pending', 'running') and deadline_at is not null and deadline_at < now()
    returning 1)
  select count(*) into n from t;
  return n;
end $$;

revoke execute on function public.enqueue_on_order_event(), public.claim_runs(int, int), public.sweep_run_timeouts()
  from public, anon, authenticated;
grant execute on function public.claim_runs(int, int), public.sweep_run_timeouts() to service_role;
