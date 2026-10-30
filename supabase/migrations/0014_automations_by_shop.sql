-- Automations can be limited to chosen shops. A trigger may carry "integration_ids": a list of shop ids. Without it
-- (every automation made so far) the automation covers all shops, including ones connected later.
--  * order_created / order_status_changed: fire only for orders of a listed shop.
--  * customer_signup: fire only for signups through a listed shop (the older single "integration_id" still works).
--  * customer_first_order: events are now recorded per customer AND shop. "All shops" automations take only the event that
--    is the customer's first order anywhere in the workspace; automations limited to shops take that shop's first-order events.

-- ------------------------------------------------------------------------------------------------ first order, per shop
alter table public.customer_events add column workspace_first boolean not null default true; -- rows from 0012 were first anywhere
drop index public.customer_events_first_order_uniq;
create unique index customer_events_first_order_uniq on public.customer_events (customer_id, integration_id) where type = 'first_order';

create or replace function public.sync_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := nullif(lower(btrim(new.customer_email)), ''); at timestamptz; cid uuid; candidate boolean := true;
begin
  if k is null then return new; end if; -- no email: cannot be matched, so no customer
  at := coalesce((new.applied_at->>'customer')::timestamptz, new.last_event_at);
  insert into customers (organization_id, email_key, email, name, phone, profile_at, first_seen_at)
  values (new.organization_id, k, btrim(new.customer_email), nullif(btrim(new.customer_name), ''),
          nullif(btrim(new.customer_phone), ''), at, coalesce(new.placed_at, new.created_at))
  on conflict (organization_id, email_key) do update set
    email = case when excluded.profile_at >= customers.profile_at then excluded.email else customers.email end,
    name = case when excluded.profile_at >= customers.profile_at then coalesce(excluded.name, customers.name)
                else coalesce(customers.name, excluded.name) end,
    phone = case when excluded.profile_at >= customers.profile_at then coalesce(excluded.phone, customers.phone)
                 else coalesce(customers.phone, excluded.phone) end,
    profile_at = greatest(customers.profile_at, excluded.profile_at),
    first_seen_at = least(customers.first_seen_at, excluded.first_seen_at)
  returning id into cid;

  -- On an update, only an order that moved to this email can be a first order (a renamed customer is not).
  if tg_op = 'UPDATE' then candidate := lower(btrim(old.customer_email)) is distinct from k; end if;
  if candidate and not exists (
    select 1 from orders o
    where o.organization_id = new.organization_id and o.integration_id = new.integration_id
      and lower(btrim(o.customer_email)) = k and o.id <> new.id
  ) then
    insert into customer_events (organization_id, customer_id, type, integration_id, order_id, workspace_first)
    values (new.organization_id, cid, 'first_order', new.integration_id, new.id,
            not exists (select 1 from orders o where o.organization_id = new.organization_id
                        and lower(btrim(o.customer_email)) = k and o.id <> new.id))
    on conflict do nothing; -- a racing second order, or an email moved back and forth, never fires twice for a shop
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------------------------------------ order automations
-- Same as 0010, plus the shop filter.
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
          and (v.definition->'trigger'->'integration_ids' is null or v.definition->'trigger'->'integration_ids' ? ord.integration_id::text))
      or (v.definition->'trigger'->>'type' = 'order_status_changed' and applied ? 'status'
          and (v.definition->'trigger'->>'to_status' is null or v.definition->'trigger'->>'to_status' = to_status)
          and (v.definition->'trigger'->'integration_ids' is null or v.definition->'trigger'->'integration_ids' ? ord.integration_id::text))
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;

-- ------------------------------------------------------------------------------------------------ customer automations
create or replace function public.enqueue_on_customer_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare c customers; o orders; payload jsonb; queued int;
begin
  select * into c from customers where id = new.customer_id;
  payload := jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
                                   'registered_at', c.registered_at, 'external_id', c.external_id),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id,
                                'type', case new.type when 'signed_up' then 'customer.signed_up' else 'customer.first_order' end));
  if new.order_id is not null then
    select * into o from orders where id = new.order_id;
    if found then payload := payload || jsonb_build_object('order', to_jsonb(o) - 'applied_at' - 'data_quality' - 'version'); end if;
  end if;

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, v.definition->'trigger'->>'type', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and (
      (new.type = 'signed_up' and v.definition->'trigger'->>'type' = 'customer_signup'
        and (
          case when v.definition->'trigger'->'integration_ids' is not null
                 then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
               when v.definition->'trigger'->>'integration_id' is not null
                 then v.definition->'trigger'->>'integration_id' = new.integration_id::text
               else true end))
      or (new.type = 'first_order' and v.definition->'trigger'->>'type' = 'customer_first_order'
        and (
          case when v.definition->'trigger'->'integration_ids' is not null
                 then v.definition->'trigger'->'integration_ids' ? new.integration_id::text -- that shop's first order
               else new.workspace_first end))                                                  -- all shops: first anywhere
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
