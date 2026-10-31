-- A shop's push (the inbound inventory webhook) no longer depends on "Quick sync". Any connected shop can push, at any time and
-- as often as it likes: the call budget (calls per days) only ever limited WorkRelay's own scheduled and manual pulls.
-- apply_product_sync is 0015's, unchanged except that the push gate is gone (it returned -1 for a shop that was not allowed).
-- integration_sync.push_enabled and admin_set_push_enabled stay in the database, unused.

create or replace function public.apply_product_sync(p_integration uuid, p_items jsonb, p_source text, p_at timestamptz default now())
returns int
language plpgsql security definer set search_path = public as $$
declare
  i integrations; it jsonb; cur products; n int := 0;
  k text; nm text; at timestamptz; newer boolean;
  stock_in int; notify_in int; price_in bigint; cur_in text; new_stock int;
begin
  if p_source not in ('push', 'pull') then raise exception 'invalid source'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array'; end if;
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then raise exception 'shop is not connected'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    k := nullif(btrim(it->>'sku'), '');
    if k is null then raise exception 'every item needs a sku'; end if;
    nm := left(nullif(btrim(it->>'name'), ''), 300);
    stock_in := (it->>'stock')::int;
    notify_in := (it->>'notify_on')::int;
    price_in := (it->>'price_minor')::bigint;
    cur_in := upper(nullif(btrim(it->>'currency'), ''));
    if price_in is not null and cur_in is null then raise exception 'price_minor needs a currency'; end if;
    if price_in is null then cur_in := null; end if;
    at := least(coalesce((it->>'updated_at')::timestamptz, p_at), now());

    -- Insert first and let a concurrent report for the same new SKU lose quietly (it then takes the update path below),
    -- so a push and a pull racing on a brand-new product can never fail on the unique key.
    insert into products (organization_id, integration_id, sku, name, stock, notify_on, price_minor, currency, unit,
                          category, barcode, reported_at)
    values (i.organization_id, p_integration, left(k, 200), coalesce(nm, left(k, 300)), stock_in, notify_in, price_in,
            cur_in, nullif(btrim(it->>'unit'), ''), nullif(btrim(it->>'category'), ''),
            nullif(btrim(it->>'barcode'), ''), at)
    on conflict (integration_id, sku) do nothing
    returning * into cur;
    if found then
      if stock_in is not null then
        insert into stock_events (organization_id, product_id, stock_before, stock_after, source, occurred_at)
        values (i.organization_id, cur.id, null, stock_in, p_source, at);
      end if;
    else
      select * into cur from products where integration_id = p_integration and sku = left(k, 200) for update;
      newer := cur.reported_at is null or at >= cur.reported_at;
      new_stock := case when newer and stock_in is not null then stock_in else coalesce(cur.stock, stock_in) end;
      update products set
        name = case when newer and nm is not null then nm else name end,
        stock = new_stock,
        notify_on = case when newer and notify_in is not null then notify_in else coalesce(notify_on, notify_in) end,
        price_minor = case when newer and price_in is not null then price_in else coalesce(price_minor, price_in) end,
        currency = case when newer and price_in is not null then cur_in else coalesce(currency, cur_in) end,
        unit = case when newer and nullif(btrim(it->>'unit'), '') is not null then btrim(it->>'unit') else coalesce(unit, nullif(btrim(it->>'unit'), '')) end,
        category = case when newer and nullif(btrim(it->>'category'), '') is not null then btrim(it->>'category') else coalesce(category, nullif(btrim(it->>'category'), '')) end,
        barcode = case when newer and nullif(btrim(it->>'barcode'), '') is not null then btrim(it->>'barcode') else coalesce(barcode, nullif(btrim(it->>'barcode'), '')) end,
        reported_at = greatest(reported_at, at),
        updated_at = now()
      where id = cur.id;
      if new_stock is distinct from cur.stock and new_stock is not null then
        insert into stock_events (organization_id, product_id, stock_before, stock_after, source, occurred_at)
        values (cur.organization_id, cur.id, cur.stock, new_stock, p_source, at);
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_product_sync(uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_product_sync(uuid, jsonb, text, timestamptz) to service_role;
