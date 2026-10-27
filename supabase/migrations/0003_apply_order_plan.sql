-- Optimistic concurrency + a single transaction for applying an order event.
alter table public.orders add column version int not null default 1;

create function public.apply_order_plan(
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
  end if;

  insert into order_events (organization_id, order_id, source, type, occurred_at, webhook_event_id, data)
  values (p_org, cur_id, 'external', p_timeline->>'type', (p_timeline->>'occurred_at')::timestamptz,
          p_event_row, coalesce(p_timeline->'data', '{}'));

  update webhook_events set status = 'processed', processed_at = now(), error = null where id = p_event_row;
  return 'ok';
end $$;

revoke execute on function public.apply_order_plan(uuid, uuid, uuid, text, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_order_plan(uuid, uuid, uuid, text, int, jsonb, jsonb, jsonb) to service_role;
