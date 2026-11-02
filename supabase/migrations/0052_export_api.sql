-- Export API: a shop can read its own data back (orders, customers, products with stock), read-only.
-- Four locks, all of which must hold:
--   1. the shop key (Authorization: Bearer wr_live_...) and X-Store-Id, as for every webhook;
--   2. an export secret the owner created for that shop: no secret means export is off, clearing it switches export off at once;
--   3. every request is signed with that secret (timestamp, request id, resource and query) and may be used once;
--   4. a cap of calls per hour and per shop, and every call is written to a history the owner can read.
-- The secret lives in Vault and is shown once. The edge function reads it with the service role; a browser never can.

alter table public.integrations
  add column export_secret_id uuid,                                    -- the signing secret, in Vault; never readable by a browser
  add column export_secret_version int not null default 0,
  add column export_has_secret boolean generated always as (export_secret_id is not null) stored,
  add column export_last_used_at timestamptz;

grant select (export_has_secret, export_last_used_at) on public.integrations to authenticated;

-- One row per call that reached the signature check, so it is the audit trail, the replay guard and the rate counter at once.
create table public.export_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 100),
  resource text not null check (resource in ('orders', 'customers', 'products')),
  status text not null default 'started' check (status in ('started', 'ok', 'refused', 'failed')),
  reason text,
  row_count int,
  created_at timestamptz not null default now(),
  unique (integration_id, request_id)
);
create index export_calls_recent_idx on public.export_calls (integration_id, created_at desc);

alter table public.export_calls enable row level security;
create policy export_calls_select on public.export_calls for select using (has_org_role(organization_id, array['owner','admin']::org_role[]));
revoke all on public.export_calls from anon, authenticated;
grant select (id, organization_id, integration_id, resource, status, reason, row_count, created_at) on public.export_calls to authenticated;

-- ------------------------------------------------------------------------------------------------ the owner's switch
-- Creates or replaces the secret and returns it once. Replacing it makes every old signature useless straight away.
create function public.rotate_export_secret(p_integration uuid) returns text
language plpgsql security definer set search_path = public, extensions, vault as $$
declare i integrations; raw text := 'wr_export_' || encode(gen_random_bytes(32), 'hex'); sid uuid;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status <> 'connected' then raise exception 'this connection is not connected'; end if;
  if i.export_secret_id is null then
    sid := vault.create_secret(raw, 'export:' || p_integration::text, 'WorkRelay export API signing secret');
  else
    sid := i.export_secret_id;
    perform vault.update_secret(sid, raw);
  end if;
  update integrations set export_secret_id = sid, export_secret_version = export_secret_version + 1, updated_at = now()
  where id = p_integration;
  return raw;
end $$;

create function public.clear_export_secret(p_integration uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.export_secret_id is null then return; end if;
  update integrations set export_secret_id = null, export_secret_version = export_secret_version + 1, updated_at = now()
  where id = p_integration;
  delete from vault.secrets where id = i.export_secret_id;
end $$;

-- ------------------------------------------------------------------------------------------------ one call
-- Starts a call: refuses when export is off, the shop is over its hourly cap, or this request id was used before.
-- Hands the secret to the edge function only when the call may go ahead. 120 calls an hour per shop.
create function public.export_begin(p_integration uuid, p_request_id text, p_resource text)
returns table (ok boolean, reason text, call_id uuid, secret text)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; used int; cid uuid; sec text;
begin
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then return query select false, 'not_connected', null::uuid, null::text; return; end if;
  if i.export_secret_id is null then return query select false, 'export_off', null::uuid, null::text; return; end if;

  delete from export_calls where integration_id = p_integration and created_at < now() - interval '30 days';

  select count(*) into used from export_calls where integration_id = p_integration and created_at > now() - interval '1 hour';
  if used >= 120 then return query select false, 'rate_limited', null::uuid, null::text; return; end if;

  insert into export_calls (organization_id, integration_id, request_id, resource)
  values (i.organization_id, p_integration, p_request_id, p_resource)
  on conflict (integration_id, request_id) do nothing
  returning id into cid;
  if cid is null then return query select false, 'replayed', null::uuid, null::text; return; end if;

  select decrypted_secret into sec from vault.decrypted_secrets where id = i.export_secret_id;
  if sec is null then
    update export_calls set status = 'failed', reason = 'The signing secret is missing.' where id = cid;
    return query select false, 'export_off', null::uuid, null::text; return;
  end if;
  return query select true, null::text, cid, sec;
end $$;

create function public.export_finish(p_call uuid, p_status text, p_reason text, p_rows int) returns void
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  update export_calls set status = p_status, reason = left(p_reason, 300), row_count = p_rows
  where id = p_call and status = 'started' returning integration_id into iid;
  if iid is not null and p_status = 'ok' then
    update integrations set export_last_used_at = now() where id = iid;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------ the data
-- One page, newest changes last. The cursor is (changed_at, id) so that nothing is skipped or repeated while data changes.
-- p_since: only rows changed after this moment. Returns {items: [...], next: {at, id} | null}.
create function public.export_page(p_integration uuid, p_resource text, p_since timestamptz, p_after_at timestamptz, p_after_id uuid, p_limit int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i integrations; lim int := least(greatest(coalesce(p_limit, 100), 1), 200); result jsonb;
begin
  select * into i from integrations where id = p_integration and status = 'connected';
  if not found then raise exception 'not_connected'; end if;

  if p_resource = 'orders' then
    with page as (
      select o.* from orders o
      where o.integration_id = p_integration
        and (p_since is null or o.updated_at > p_since)
        and (p_after_at is null or (o.updated_at, o.id) > (p_after_at, p_after_id))
      order by o.updated_at, o.id limit lim + 1
    ), shown as (select * from page order by updated_at, id limit lim)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'external_id', s.external_id, 'order_number', s.order_number, 'placed_at', s.placed_at, 'currency', s.currency,
          'customer', jsonb_build_object('name', s.customer_name, 'email', s.customer_email, 'phone', s.customer_phone),
          'subtotal_minor', s.subtotal_minor, 'discount_minor', s.discount_minor, 'shipping_minor', s.shipping_minor,
          'tax_minor', s.tax_minor, 'total_minor', s.total_minor,
          'status', s.status, 'payment_status', s.payment_status, 'fulfillment_status', s.fulfillment_status,
          'shop_status', s.external_status, 'shop_payment_status', s.external_payment_status, 'shop_fulfillment_status', s.external_fulfillment_status,
          'billing_address', s.billing_address, 'shipping_address', s.shipping_address, 'notes', s.notes,
          'updated_at', s.updated_at,
          'items', coalesce((select jsonb_agg(jsonb_build_object('sku', oi.sku, 'name', oi.name, 'quantity', oi.quantity,
                     'unit_price_minor', oi.unit_price_minor, 'external_id', oi.external_id) order by oi.position)
                   from order_items oi where oi.order_id = s.id), '[]'::jsonb)
        ) order by s.updated_at, s.id) from shown s), '[]'::jsonb),
      'next', case when (select count(*) from page) > lim
                   then (select jsonb_build_object('at', updated_at, 'id', id) from shown order by updated_at desc, id desc limit 1) end
    ) into result;

  elsif p_resource = 'customers' then
    -- the people who ordered from this shop or signed up through it, changed when their profile last changed
    with page as (
      select c.* from customers c
      where c.organization_id = i.organization_id
        and (exists (select 1 from customer_signups s where s.customer_id = c.id and s.integration_id = p_integration)
             or exists (select 1 from orders o where o.organization_id = i.organization_id and o.integration_id = p_integration
                        and lower(btrim(o.customer_email)) = c.email_key))
        and (p_since is null or c.profile_at > p_since)
        and (p_after_at is null or (c.profile_at, c.id) > (p_after_at, p_after_id))
      order by c.profile_at, c.id limit lim + 1
    ), shown as (select * from page order by profile_at, id limit lim)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'email', s.email, 'name', s.name, 'phone', s.phone, 'external_id', s.external_id,
          'registered_at', (select cs.registered_at from customer_signups cs where cs.customer_id = s.id and cs.integration_id = p_integration),
          'first_seen_at', s.first_seen_at, 'updated_at', s.profile_at,
          'orders', (select count(*) from orders o where o.organization_id = i.organization_id and o.integration_id = p_integration
                       and lower(btrim(o.customer_email)) = s.email_key)
        ) order by s.profile_at, s.id) from shown s), '[]'::jsonb),
      'next', case when (select count(*) from page) > lim
                   then (select jsonb_build_object('at', profile_at, 'id', id) from shown order by profile_at desc, id desc limit 1) end
    ) into result;

  elsif p_resource = 'products' then
    -- stock is the best number WorkRelay has (the estimate when the shop is estimated), stock_reported is what the shop last said.
    -- Orders move the estimate without touching the product row, so read products in full when the stock matters.
    with page as (
      select p.* from products p
      where p.integration_id = p_integration
        and (p_since is null or p.updated_at > p_since)
        and (p_after_at is null or (p.updated_at, p.id) > (p_after_at, p_after_id))
      order by p.updated_at, p.id limit lim + 1
    ), shown as (select * from page order by updated_at, id limit lim),
    est as (select e.product_id, e.estimated from stock_estimates(i.organization_id, (select array_agg(id) from shown)) e)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'sku', s.sku, 'name', s.name,
          'stock', coalesce(e.estimated, s.stock), 'stock_reported', s.stock, 'stock_is_estimate', e.estimated is not null,
          'reported_at', s.reported_at, 'notify_on', coalesce(s.notify_on_override, s.notify_on),
          'price_minor', s.price_minor, 'currency', s.currency, 'unit', s.unit, 'category', s.category, 'barcode', s.barcode,
          'updated_at', s.updated_at
        ) order by s.updated_at, s.id) from shown s left join est e on e.product_id = s.id), '[]'::jsonb),
      'next', case when (select count(*) from page) > lim
                   then (select jsonb_build_object('at', updated_at, 'id', id) from shown order by updated_at desc, id desc limit 1) end
    ) into result;
  else
    raise exception 'unknown resource';
  end if;
  return result;
end $$;

revoke execute on function public.rotate_export_secret(uuid), public.clear_export_secret(uuid) from public, anon;
grant execute on function public.rotate_export_secret(uuid), public.clear_export_secret(uuid) to authenticated;
revoke execute on function public.export_begin(uuid, text, text), public.export_finish(uuid, text, text, int),
  public.export_page(uuid, text, timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.export_begin(uuid, text, text), public.export_finish(uuid, text, text, int),
  public.export_page(uuid, text, timestamptz, timestamptz, uuid, int) to service_role;
