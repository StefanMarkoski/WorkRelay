-- "An order's status changes" fired whenever a shop's update carried a status, even when it was the status the order already
-- had, so a shop repeating "delivered" notified again. It now fires only when the status really differs from before.
-- Manual changes from WorkRelay are unaffected (they are only recorded when the status changed). Everything else in
-- enqueue_on_order_event is 0027's.

create or replace function public.enqueue_on_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ord orders; payload jsonb; to_status text; applied jsonb; queued int;
begin
  if not (
    (new.source = 'external' and new.type in ('order.created', 'order.updated', 'order.status_changed'))
    or (new.source = 'workrelay' and new.type = 'order.status_changed')
  ) then
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
      (new.source = 'external' and v.definition->'trigger'->>'type' = 'webhook' and v.definition->'trigger'->>'integration_id' = ord.integration_id::text)
      or (new.source = 'external' and v.definition->'trigger'->>'type' = 'order_created' and new.type = 'order.created'
          -- "a new order" is announced once per order: a second order.created for the same order (a retry under a new
          -- event id, or the shop sending it again) updates the order but is not a new order
          and not exists (select 1 from order_events e where e.order_id = new.order_id and e.source = 'external'
                            and e.type = 'order.created' and e.id <> new.id)
          and (v.definition->'trigger'->'integration_ids' is null or v.definition->'trigger'->'integration_ids' ? ord.integration_id::text))
      or (v.definition->'trigger'->>'type' = 'order_status_changed' and applied ? 'status'
          -- the status has to be different from before: the shop saying "delivered" again about a delivered order is no change
          and new.data->>'status_from' is distinct from new.data->>'status_to'
          and (v.definition->'trigger'->>'to_status' is null or v.definition->'trigger'->>'to_status' = to_status)
          and (v.definition->'trigger'->'integration_ids' is null or v.definition->'trigger'->'integration_ids' ? ord.integration_id::text))
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
