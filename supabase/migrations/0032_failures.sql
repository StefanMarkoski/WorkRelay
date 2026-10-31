-- Failures: one list of everything that went wrong, for the Failures page and the count beside it in the menu.
--  * "event": an incoming webhook event (an order, a signup, a product feed) that WorkRelay could not accept or process.
--    Ignored events are not failures. "run": an automation run that ended as failed.
--  * Events carry their shop; a run has none (it can cover several shops), so asking for one shop lists events only.
--  * Runs as the caller, so row security decides what is seen. Only reasons and ids are returned, never a payload.

create function public.list_failures(
  p_org uuid, p_kind text default null, p_integration uuid default null, p_days int default 7,
  p_limit int default 25, p_offset int default 0
) returns table (
  id uuid, kind text, at timestamptz, integration_id uuid, integration_name text, subject text, ref text, error text, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with f as (
    select e.id, 'event'::text as kind, e.received_at as at, e.integration_id, i.name as integration_name,
           coalesce(e.event_type, 'unknown') as subject, e.event_id as ref, e.error
    from webhook_events e
    join integrations i on i.id = e.integration_id
    where e.organization_id = p_org and e.status = 'failed'
      and e.received_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))
      and (p_integration is null or e.integration_id = p_integration)
    union all
    select r.id, 'run', coalesce(r.finished_at, r.created_at), null::uuid, null::text, w.name, r.event_id, r.error
    from workflow_runs r
    join workflows w on w.id = r.workflow_id
    where r.organization_id = p_org and r.status = 'failed' and p_integration is null
      and coalesce(r.finished_at, r.created_at) >= now() - make_interval(days => least(greatest(p_days, 1), 365))
  )
  select f.id, f.kind, f.at, f.integration_id, f.integration_name, f.subject, f.ref, f.error, count(*) over ()
  from f
  where p_kind is null or f.kind = p_kind
  order by f.at desc, f.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
