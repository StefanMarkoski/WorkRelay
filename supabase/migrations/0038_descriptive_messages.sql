-- More descriptive automation messages: what was bought, who bought it (name and email), the total, and the shop.
--  * Order messages say what was ordered ("Bought: 2× Black tee (M), 1× Mug", the first 5 lines and "and N more"), the customer's full
--    name with their email, the total and the shop; a status change says what it changed from.
--  * The messages are safe to post in a channel everyone can read: no phone numbers, addresses, notes or payment details.
--  * Discord messages no longer parse mentions, so a customer or product named "@everyone" cannot ping a channel.
--  * Saved automations get the new wording as a new version (the old one stays in the history). Low-stock and sync messages keep their
--    wording (the sync count would only be that of the first chunk of a large sync); they only gain the mention protection.

-- What was bought, as text: the first 5 lines ("1× Black tee (M), 2× Mug"), then "and N more"; names cut at 60 characters.
create function public.order_items_text(p_order uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
           (select string_agg(x.t, ', ' order by x.position)
            from (select position, coalesce(quantity::text, '?') || '× ' || left(coalesce(nullif(btrim(name), ''), nullif(btrim(sku), ''), 'item'), 60) as t
                  from order_items where order_id = p_order order by position limit 5) x),
           'no items listed')
         || case when (select count(*) from order_items where order_id = p_order) > 5
                 then ', and ' || ((select count(*) from order_items where order_id = p_order) - 5) || ' more' else '' end
$$;
revoke execute on function public.order_items_text(uuid) from public, anon, authenticated;

create or replace function public.enqueue_on_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ord orders; payload jsonb; to_status text; applied jsonb; queued int; shop text;
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
  select name into shop from integrations where id = ord.integration_id;
  payload := jsonb_build_object(
    -- what the messages say beyond the order itself: what was bought, at which shop, and (for a change) the status it came from.
    -- Phone, addresses and notes are deliberately not added: these messages end up in shared channels.
    'order', (to_jsonb(ord) - 'applied_at' - 'data_quality' - 'version')
             || jsonb_build_object('items_text', order_items_text(ord.id), 'shop', shop, 'status_from', new.data->>'status_from'),
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

create or replace function public.enqueue_on_customer_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare c customers; o orders; payload jsonb; queued int; shop text;
begin
  select * into c from customers where id = new.customer_id;
  select name into shop from integrations where id = new.integration_id;
  payload := jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
                                   'registered_at', c.registered_at, 'external_id', c.external_id, 'shop', shop),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id,
                                'type', case new.type when 'signed_up' then 'customer.signed_up' else 'customer.first_order' end));
  if new.order_id is not null then
    select * into o from orders where id = new.order_id;
    if found then
      payload := payload || jsonb_build_object('order', (to_jsonb(o) - 'applied_at' - 'data_quality' - 'version')
                                                         || jsonb_build_object('items_text', order_items_text(o.id), 'shop', shop));
    end if;
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

-- Saved automations: the new wording, as a new version. Each old message is replaced exactly (they all came from the presets), in the
-- three shapes a body can have (Discord content, Slack text, a generic webhook's "message"); Discord also stops parsing mentions.
create function public.upgrade_message_wording() returns int
language plpgsql security definer set search_path = public as $$
declare w record; txt text; newdef jsonb; vid uuid; n int := 0; pair text[]; pairs text[][] := array[
  array['New order {{order.display_number}} from {{order.customer}}: {{order.total}}',
        'New order {{order.display_number}} from {{order.customer_line}}: {{order.total}}. Bought: {{order.items_text}}. Shop: {{order.shop}}'],
  array['Order {{order.display_number}} was cancelled ({{order.total}})',
        'Order {{order.display_number}} from {{order.customer_line}} was cancelled ({{order.total}}). Bought: {{order.items_text}}. Shop: {{order.shop}}'],
  array['Order {{order.display_number}} is now {{order.status}} ({{order.total}})',
        'Order {{order.display_number}} from {{order.customer_line}} {{order.status_phrase}} ({{order.total}}). Bought: {{order.items_text}}. Shop: {{order.shop}}'],
  array['New customer signed up: {{customer.display_name}} ({{customer.email}})',
        'New customer signed up: {{customer.line}}. Shop: {{customer.shop}}'],
  array['New customer {{customer.display_name}} ({{customer.email}}) placed their first order: {{order.display_number}}, {{order.total}}',
        'New customer {{customer.line}} placed their first order: {{order.display_number}}, {{order.total}}. Bought: {{order.items_text}}. Shop: {{customer.shop}}'],
  array['{{product.line}} Source: {{product.source}}', '{{product.line}} Source: {{product.source}}'],
  array['{{sync.by}} has synced their products{{sync.where}}', '{{sync.by}} has synced their products{{sync.where}}']
];
begin
  for w in
    select wf.id as workflow_id, wf.organization_id, v.definition
    from workflows wf join workflow_versions v on v.id = wf.current_version_id
    where wf.preset = 'notify'
    for update of wf
  loop
    txt := w.definition::text;
    foreach pair slice 1 in array pairs loop
      txt := replace(txt, '\"content\":\"' || pair[1] || '\"}', '\"content\":\"' || pair[2] || '\",\"allowed_mentions\":{\"parse\":[]}}');
      txt := replace(txt, '\"text\":\"' || pair[1] || '\"}', '\"text\":\"' || pair[2] || '\"}');
      txt := replace(txt, '\"message\":\"' || pair[1] || '\"}', '\"message\":\"' || pair[2] || '\"}');
    end loop;
    continue when txt = w.definition::text;
    newdef := txt::jsonb;
    insert into workflow_versions (workflow_id, organization_id, version, definition)
    values (w.workflow_id, w.organization_id, (select max(version) + 1 from workflow_versions where workflow_id = w.workflow_id), newdef)
    returning id into vid;
    update workflows set current_version_id = vid, draft_definition = newdef, updated_at = now() where id = w.workflow_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.upgrade_message_wording() from public, anon, authenticated;

select public.upgrade_message_wording();


-- The order is written in one function: complete a first-order run's items once they exist.
create or replace function public.apply_order_plan(
  p_event_row uuid, p_org uuid, p_integration uuid, p_external_id text,
  p_expected_version int, p_order jsonb, p_items jsonb, p_timeline jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare cur_id uuid; cur_version int; r public.orders;
begin
  select id, version into cur_id, cur_version from orders
    where integration_id = p_integration and external_id = p_external_id for update;

  r := jsonb_populate_record(null::public.orders, p_order);

  if cur_id is null then
    if p_expected_version is not null then return 'conflict'; end if;
    begin
      insert into orders (
        organization_id, integration_id, external_id, order_number, customer_name, customer_email,
        customer_phone, placed_at, currency, subtotal_minor, discount_minor, shipping_minor, tax_minor,
        total_minor, status, payment_status, fulfillment_status, external_status, external_payment_status,
        external_fulfillment_status, billing_address, shipping_address, notes, data_quality, applied_at, last_event_at)
      values (
        p_org, p_integration, p_external_id, r.order_number, r.customer_name, r.customer_email,
        r.customer_phone, r.placed_at, r.currency, r.subtotal_minor, r.discount_minor, r.shipping_minor, r.tax_minor,
        r.total_minor, r.status, r.payment_status, r.fulfillment_status, r.external_status, r.external_payment_status,
        r.external_fulfillment_status, r.billing_address, r.shipping_address, r.notes, r.data_quality, r.applied_at, r.last_event_at)
      returning id into cur_id;
    exception when unique_violation then
      return 'conflict';
    end;
  else
    if p_expected_version is distinct from cur_version then return 'conflict'; end if;
    update orders set
      order_number = r.order_number, customer_name = r.customer_name, customer_email = r.customer_email,
      customer_phone = r.customer_phone, placed_at = r.placed_at, currency = r.currency,
      subtotal_minor = r.subtotal_minor, discount_minor = r.discount_minor, shipping_minor = r.shipping_minor,
      tax_minor = r.tax_minor, total_minor = r.total_minor, status = r.status, payment_status = r.payment_status,
      fulfillment_status = r.fulfillment_status, external_status = r.external_status,
      external_payment_status = r.external_payment_status, external_fulfillment_status = r.external_fulfillment_status,
      billing_address = r.billing_address, shipping_address = r.shipping_address, notes = r.notes,
      data_quality = r.data_quality, applied_at = r.applied_at, last_event_at = r.last_event_at,
      version = version + 1, updated_at = now()
    where id = cur_id;
  end if;

  if p_items is not null then
    delete from order_items where order_id = cur_id;
    insert into order_items (organization_id, order_id, position, external_id, sku, name, quantity, unit_price_minor)
    select p_org, cur_id, x.position, x.external_id, x.sku, x.name, x.quantity, x.unit_price_minor
    from jsonb_to_recordset(p_items) as x(position int, external_id text, sku text, name text, quantity int, unit_price_minor bigint);
    -- A customer's first-order event is created when the order row is saved, a moment before its items are. The run it queued says
    -- what was bought only once the items exist, so it is completed here (the engine cannot touch it before this transaction commits).
    update workflow_runs set context = jsonb_set(context, '{order,items_text}', to_jsonb(order_items_text(cur_id)), true)
    where organization_id = p_org and status = 'pending' and trigger_source = 'customer_first_order' and context->'order'->>'id' = cur_id::text;
  end if;

  insert into order_events (organization_id, order_id, source, type, occurred_at, webhook_event_id, data)
  values (p_org, cur_id, 'external', p_timeline->>'type', (p_timeline->>'occurred_at')::timestamptz,
          p_event_row, coalesce(p_timeline->'data', '{}'));

  update webhook_events set status = 'processed', processed_at = now(), error = null where id = p_event_row;
  return 'ok';
end $$;
