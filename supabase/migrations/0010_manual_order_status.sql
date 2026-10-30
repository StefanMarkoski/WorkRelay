-- Manual status edits: any member of the workspace can set an order's status, payment status and fulfillment status.
-- A manual edit is one more writer under the same rules as a webhook event: it stamps the field's applied_at with the
-- database clock (so a later shop event wins, an older one is recorded as outdated), bumps the version, and writes a
-- timeline event. The shop's own text (external_*) is left alone so any disagreement stays visible.

create function public.set_order_statuses(
  p_order uuid, p_status text default null, p_payment text default null, p_fulfillment text default null, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  new_status public.order_status;
  new_payment public.payment_status;
  new_fulfillment public.fulfillment_status;
  applied text[] := '{}';
  data jsonb := jsonb_build_object('by', 'dashboard');
  note text := nullif(trim(coalesce(p_note, '')), '');
  at timestamptz := now();
begin
  select * into o from orders where id = p_order for update;
  if not found or not is_org_member(o.organization_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if note is not null and char_length(note) > 500 then raise exception 'note too long'; end if;
  if p_status is null and p_payment is null and p_fulfillment is null then raise exception 'nothing to change'; end if;

  -- 'unknown' is what WorkRelay stores when it cannot read the shop's word; it is not something to pick.
  if 'unknown' in (coalesce(p_status, ''), coalesce(p_payment, ''), coalesce(p_fulfillment, '')) then
    raise exception 'invalid status value';
  end if;
  begin
    if p_status is not null then new_status := p_status::public.order_status; end if;
    if p_payment is not null then new_payment := p_payment::public.payment_status; end if;
    if p_fulfillment is not null then new_fulfillment := p_fulfillment::public.fulfillment_status; end if;
  exception when invalid_text_representation then
    raise exception 'invalid status value';
  end;

  if new_status is not null and new_status <> o.status then
    applied := array_append(applied, 'status');
    data := data || jsonb_build_object('status_from', o.status, 'status_to', new_status);
    o.applied_at := jsonb_set(o.applied_at, '{status}', to_jsonb(at));
    o.status := new_status;
  end if;
  if new_payment is not null and new_payment <> o.payment_status then
    applied := array_append(applied, 'payment_status');
    data := data || jsonb_build_object('payment_from', o.payment_status, 'payment_to', new_payment);
    o.applied_at := jsonb_set(o.applied_at, '{payment_status}', to_jsonb(at));
    o.payment_status := new_payment;
  end if;
  if new_fulfillment is not null and new_fulfillment <> o.fulfillment_status then
    applied := array_append(applied, 'fulfillment_status');
    data := data || jsonb_build_object('fulfillment_from', o.fulfillment_status, 'fulfillment_to', new_fulfillment);
    o.applied_at := jsonb_set(o.applied_at, '{fulfillment_status}', to_jsonb(at));
    o.fulfillment_status := new_fulfillment;
  end if;

  if cardinality(applied) = 0 then return false; end if; -- nothing changed: no write, no event, no automation

  data := data || jsonb_build_object('applied', to_jsonb(applied));
  if note is not null then data := data || jsonb_build_object('note', note); end if;

  update orders set status = o.status, payment_status = o.payment_status, fulfillment_status = o.fulfillment_status,
    applied_at = o.applied_at, last_event_at = greatest(last_event_at, at), version = version + 1, updated_at = at
  where id = o.id;

  insert into order_events (organization_id, order_id, source, type, occurred_at, actor_user_id, data)
    values (o.organization_id, o.id, 'workrelay',
            case when 'status' = any (applied) then 'order.status_changed' else 'order.updated' end,
            at, auth.uid(), data);
  return true;
end $$;

revoke execute on function public.set_order_statuses(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_order_statuses(uuid, text, text, text, text) to authenticated;

-- A manual status change can start "order status changed" automations. It never starts the "webhook" or
-- "order created" ones: those mean the shop sent something.
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
      or (new.source = 'external' and v.definition->'trigger'->>'type' = 'order_created' and new.type = 'order.created')
      or (v.definition->'trigger'->>'type' = 'order_status_changed' and applied ? 'status'
          and (v.definition->'trigger'->>'to_status' is null or v.definition->'trigger'->>'to_status' = to_status))
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
