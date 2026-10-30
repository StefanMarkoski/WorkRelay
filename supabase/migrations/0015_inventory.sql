-- Inventory: products and their stock, as reported by the shop (push or pull) or discovered from order lines.
--  * The shop is the source of truth for stock. WorkRelay never decrements it from orders.
--  * notify_on comes from the shop (nullable); notify_on_override is set by hand in the app and wins. Setting the
--    override to 0 or null clears it, so the shop's value applies again. A sync never touches the override.
--  * Price is not stored per order: the app falls back to the latest order line when the shop reports none.
--  * How often WorkRelay calls a shop (calls per days) can be set only by a platform admin.

-- ------------------------------------------------------------------------------------------------ products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 200),
  name text not null check (char_length(name) between 1 and 300),
  stock int,                               -- null: the shop never reported it
  notify_on int check (notify_on is null or notify_on >= 0),             -- from the shop
  notify_on_override int check (notify_on_override is null or notify_on_override > 0), -- set by hand; null = none
  price_minor bigint check (price_minor is null or price_minor >= 0),    -- from the shop; null: use the latest order line
  currency char(3),
  unit text,
  category text,
  barcode text,
  reported_at timestamptz,                 -- when the shop last reported this product; an older report never overwrites a newer one
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, sku),
  check ((price_minor is null) = (currency is null))
);
create index products_org_idx on public.products (organization_id, name);

alter table public.products enable row level security;
create policy prod_select on public.products for select using (is_org_member(organization_id));
revoke all on public.products from anon, authenticated;
grant select on public.products to authenticated;

-- Append-only history of stock changes.
create table public.stock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  stock_before int,
  stock_after int not null,
  source text not null check (source in ('push', 'pull')),
  occurred_at timestamptz not null default now()
);
create index stock_events_product_idx on public.stock_events (product_id, occurred_at desc);
alter table public.stock_events enable row level security;
create policy stock_events_select on public.stock_events for select using (is_org_member(organization_id));
revoke all on public.stock_events from anon, authenticated;
grant select on public.stock_events to authenticated;

-- ------------------------------------------------------------------------------------------------ products from orders
-- A product that shows up in an order line exists from then on, with stock "not reported". Existing rows are never touched.
create function public.sync_product_from_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := nullif(btrim(new.sku), '');
begin
  if k is null then return new; end if;
  insert into products (organization_id, integration_id, sku, name)
  select o.organization_id, o.integration_id, left(k, 200), left(coalesce(nullif(btrim(new.name), ''), k), 300)
  from orders o where o.id = new.order_id
  on conflict (integration_id, sku) do nothing;
  return new;
end $$;
revoke execute on function public.sync_product_from_item() from public, anon, authenticated;
create trigger order_items_sync_product after insert on public.order_items
  for each row execute function public.sync_product_from_item();

insert into public.products (organization_id, integration_id, sku, name)
select distinct on (o.integration_id, btrim(i.sku)) o.organization_id, o.integration_id, left(btrim(i.sku), 200),
       left(coalesce(nullif(btrim(i.name), ''), btrim(i.sku)), 300)
from public.order_items i join public.orders o on o.id = i.order_id
where nullif(btrim(i.sku), '') is not null
order by o.integration_id, btrim(i.sku), o.created_at desc
on conflict (integration_id, sku) do nothing;

-- ------------------------------------------------------------------------------------------------ sync settings per shop
-- One row per shop. The URL and header are set by the workspace; the rate (calls per days) only by a platform admin.
-- With no rate there is no scheduled pull. The auth header is a secret: tenants can never read it back.
create table public.integration_sync (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_url text check (source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https://')),
  auth_header text check (auth_header is null or char_length(auth_header) <= 2000),
  has_auth_header boolean generated always as (auth_header is not null) stored, -- tenants see only whether one is set
  push_enabled boolean not null default false,  -- accept pushed product updates from this shop
  paused boolean not null default false,
  calls int,                                    -- calls per `days`; set by a platform admin only
  days int,
  next_sync_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  check ((calls is null) = (days is null)),
  check (calls is null or (calls between 1 and 100000 and days between 1 and 365)),
  -- never faster than one call every 5 minutes
  check (calls is null or calls::numeric <= days::numeric * 288)
);
alter table public.integration_sync enable row level security;
create policy sync_select on public.integration_sync for select using (is_org_member(organization_id));
revoke all on public.integration_sync from anon, authenticated;
grant select (integration_id, organization_id, source_url, has_auth_header, push_enabled, paused, calls, days, next_sync_at, last_sync_at,
              last_error, updated_at)
  on public.integration_sync to authenticated; -- auth_header is deliberately left out

create function public.sync_interval(p_calls int, p_days int) returns interval
language sql immutable as $$ select make_interval(secs => (p_days::numeric * 86400 / p_calls)::double precision) $$;

-- Workspace owners/admins: where to call, how to authenticate, push on/off, pause. Not the rate.
-- p_auth_header: null keeps the stored value (it can never be read back), an empty string removes it.
create function public.set_sync_source(
  p_integration uuid, p_url text, p_auth_header text, p_push boolean, p_paused boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  insert into integration_sync (integration_id, organization_id, source_url, auth_header, push_enabled, paused)
  values (p_integration, i.organization_id, nullif(btrim(p_url), ''), nullif(btrim(p_auth_header), ''),
          coalesce(p_push, false), coalesce(p_paused, false))
  on conflict (integration_id) do update set
    source_url = excluded.source_url,
    auth_header = case when p_auth_header is null then integration_sync.auth_header else excluded.auth_header end,
    push_enabled = excluded.push_enabled, paused = excluded.paused, updated_at = now();
end $$;

-- Platform admins only: calls per days for one shop (both null removes the schedule).
create function public.admin_set_sync_rate(p_integration uuid, p_calls int, p_days int) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from integrations where id = p_integration;
  if not found then raise exception 'unknown shop'; end if;
  insert into integration_sync (integration_id, organization_id, calls, days, next_sync_at)
  values (p_integration, i.organization_id, p_calls, p_days,
          case when p_calls is null then null else now() + sync_interval(p_calls, p_days) end)
  on conflict (integration_id) do update set
    calls = excluded.calls, days = excluded.days, updated_at = now(),
    next_sync_at = case when excluded.calls is null then null else now() + sync_interval(excluded.calls, excluded.days) end;
end $$;

-- Platform admins: the shops of one tenant and their rate. No order or customer data.
create function public.admin_list_tenant_shops(p_org uuid)
returns table (id uuid, name text, status public.integration_status, calls int, days int, last_sync_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select i.id, i.name, i.status, s.calls, s.days, s.last_sync_at, s.last_error
    from integrations i left join integration_sync s on s.integration_id = i.id
    where i.organization_id = p_org order by i.created_at;
end $$;

revoke execute on function public.set_sync_source(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.set_sync_source(uuid, text, text, boolean, boolean) to authenticated;
revoke execute on function public.admin_set_sync_rate(uuid, int, int), public.admin_list_tenant_shops(uuid) from public, anon;
grant execute on function public.admin_set_sync_rate(uuid, int, int), public.admin_list_tenant_shops(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------ the manual threshold
-- 0 or null clears the override so the shop's own notify_on applies again.
create function public.set_notify_override(p_product uuid, p_value int) returns void
language plpgsql security definer set search_path = public as $$
declare p products;
begin
  select * into p from products where id = p_product;
  if not found or not has_org_role(p.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_value < 0 then raise exception 'the threshold cannot be negative'; end if;
  update products set notify_on_override = nullif(p_value, 0), updated_at = now() where id = p_product;
end $$;
revoke execute on function public.set_notify_override(uuid, int) from public, anon;
grant execute on function public.set_notify_override(uuid, int) to authenticated;

-- ------------------------------------------------------------------------------------------------ ingest
-- Called only by the Edge Functions (service role), after they validated the payload. Each item needs sku; everything
-- else is optional and an absent field never erases a stored value. An older report fills gaps but never overwrites.
-- Items: { sku, name?, stock?, notify_on?, price_minor?, currency?, unit?, category?, barcode?, updated_at? }.
-- Returns how many items were applied, or -1 when a push arrives from a shop that has not switched pushing on.
-- A report's time is capped at now(), so a shop with a clock in the future cannot make its data unbeatable.
create function public.apply_product_sync(p_integration uuid, p_items jsonb, p_source text, p_at timestamptz default now())
returns int
language plpgsql security definer set search_path = public as $$
declare
  i integrations; cfg integration_sync; it jsonb; cur products; n int := 0;
  k text; nm text; at timestamptz; newer boolean;
  stock_in int; notify_in int; price_in bigint; cur_in text; new_stock int;
begin
  if p_source not in ('push', 'pull') then raise exception 'invalid source'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array'; end if;
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then raise exception 'shop is not connected'; end if;
  if p_source = 'push' then
    select * into cfg from integration_sync where integration_id = p_integration;
    if not found or not cfg.push_enabled then return -1; end if; -- the shop has not switched pushed updates on
  end if;

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

-- ------------------------------------------------------------------------------------------------ scheduled pull
-- Called by the engine tick (service role). Claims the shops that are due and moves their next_sync_at forward in the
-- same statement, so two overlapping ticks never take the same shop and a failing shop cannot spend more than its budget.
create function public.claim_due_product_syncs(p_limit int default 3)
returns table (integration_id uuid, source_url text, auth_header text)
language sql security definer set search_path = public as $$
  with due as (
    select s.integration_id from integration_sync s
    join integrations i on i.id = s.integration_id
    where s.source_url is not null and s.calls is not null and not s.paused
      and i.status = 'connected' and s.next_sync_at <= now()
    order by s.next_sync_at
    limit least(greatest(p_limit, 1), 20)
    for update of s skip locked
  )
  update integration_sync s set next_sync_at = now() + sync_interval(s.calls, s.days)
  from due where s.integration_id = due.integration_id
  returning s.integration_id, s.source_url, s.auth_header
$$;

create function public.record_product_sync(p_integration uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update integration_sync set
    last_error = left(p_error, 500),
    last_sync_at = case when p_error is null then now() else last_sync_at end,
    updated_at = now()
  where integration_id = p_integration
$$;
revoke execute on function public.claim_due_product_syncs(int), public.record_product_sync(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_due_product_syncs(int), public.record_product_sync(uuid, text) to service_role;

-- ------------------------------------------------------------------------------------------------ reading
create index order_items_org_sku_idx on public.order_items (organization_id, sku) where sku is not null;

-- The Inventory list (and, with p_id, one product). Runs as the caller, so row security decides what is seen.
--  * effective_notify_on: the hand-set override if there is one, otherwise the shop's value, otherwise none.
--  * price: the shop's price if it reports one, otherwise the unit price on the most recent order line that has one.
--  * sold_30d: pieces on orders placed in the last 30 days, cancelled orders left out.
--  * low: stock is known, a threshold exists, and stock is at or below it.
create function public.list_products(
  p_org uuid, p_search text default null, p_integration uuid default null, p_low_only boolean default false,
  p_limit int default 25, p_offset int default 0, p_id uuid default null
) returns table (
  id uuid, integration_id uuid, integration_name text, sku text, name text, stock int, notify_on int,
  notify_on_override int, effective_notify_on int, price_minor bigint, currency char(3), price_source text,
  unit text, category text, barcode text, reported_at timestamptz, sold_30d bigint, low boolean, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with p as (
    select pr.*, i.name as shop_name, coalesce(pr.notify_on_override, pr.notify_on) as eff,
           lp.unit_price_minor as order_price, lp.currency as order_currency,
           coalesce(sold.qty, 0) as sold
    from products pr
    join integrations i on i.id = pr.integration_id
    left join lateral (
      select oi.unit_price_minor, o.currency
      from order_items oi join orders o on o.id = oi.order_id
      where oi.organization_id = pr.organization_id and oi.sku = pr.sku and o.integration_id = pr.integration_id
        and oi.unit_price_minor is not null and o.currency is not null
      order by coalesce(o.placed_at, o.created_at) desc, oi.position desc limit 1
    ) lp on pr.price_minor is null
    left join lateral (
      select sum(oi.quantity) as qty
      from order_items oi join orders o on o.id = oi.order_id
      where oi.organization_id = pr.organization_id and oi.sku = pr.sku and o.integration_id = pr.integration_id
        and o.status <> 'cancelled' and coalesce(o.placed_at, o.created_at) >= now() - interval '30 days'
    ) sold on true
    where pr.organization_id = p_org
      and (p_id is null or pr.id = p_id)
      and (p_integration is null or pr.integration_id = p_integration)
      and (coalesce(p_search, '') = '' or
           pr.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' or
           pr.sku ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  ), q as (
    select p.*, (p.stock is not null and p.eff is not null and p.stock <= p.eff) as is_low from p
  )
  select q.id, q.integration_id, q.shop_name, q.sku, q.name, q.stock, q.notify_on, q.notify_on_override, q.eff,
         coalesce(q.price_minor, q.order_price), coalesce(q.currency, q.order_currency),
         case when q.price_minor is not null then 'api' when q.order_price is not null then 'orders' end,
         q.unit, q.category, q.barcode, q.reported_at, q.sold, q.is_low, count(*) over ()
  from q
  where not p_low_only or q.is_low
  order by q.is_low desc, q.name, q.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- Orders that contain one product, newest first.
create function public.product_orders(p_product uuid, p_limit int default 25, p_offset int default 0)
returns table (
  id uuid, order_number text, external_id text, placed_at timestamptz, status public.order_status,
  quantity int, unit_price_minor bigint, currency char(3), total_count bigint
)
language sql stable security invoker set search_path = public as $$
  select o.id, o.order_number, o.external_id, coalesce(o.placed_at, o.created_at), o.status,
         sum(oi.quantity)::int, max(oi.unit_price_minor), o.currency, count(*) over ()
  from products p
  join order_items oi on oi.organization_id = p.organization_id and oi.sku = p.sku
  join orders o on o.id = oi.order_id and o.integration_id = p.integration_id
  where p.id = p_product
  group by o.id
  order by coalesce(o.placed_at, o.created_at) desc, o.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.list_products(uuid, text, uuid, boolean, int, int, uuid), public.product_orders(uuid, int, int) from public, anon;
grant execute on function public.list_products(uuid, text, uuid, boolean, int, int, uuid), public.product_orders(uuid, int, int) to authenticated;

-- ------------------------------------------------------------------------------------------------ low-stock automations
-- A product is "low" when its stock is known, it has a threshold (the hand-set override, else the shop's notify_on) and
-- stock is at or below it. An alert fires once when a product BECOMES low and the product is then "alerted" until its
-- stock rises above the threshold again, which re-arms it. So a shop that keeps reporting "3 bikes" sends one alert.
--  * The first stock number ever reported for a product never alerts (it only arms), so connecting a shop whose
--    products are already low does not send a burst.
--  * Raising or setting a threshold by hand on a product that is already below it does alert: a person asked for it.
--  * The event is stored whether or not an automation exists; automations only decide who is told.
alter table public.products add column low_alerted boolean not null default false;

create table public.low_stock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  stock int not null,
  threshold int not null,
  occurred_at timestamptz not null default now()
);
create index low_stock_events_product_idx on public.low_stock_events (product_id, occurred_at desc);
alter table public.low_stock_events enable row level security;
revoke all on public.low_stock_events from anon, authenticated; -- internal: written by the trigger below only

-- AFTER triggers: the row exists, so the event can point at it. The update trigger is limited to the columns that change
-- "low", so this function's own write to low_alerted does not fire it again.
create function public.track_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare eff int := coalesce(new.notify_on_override, new.notify_on); is_low boolean;
begin
  is_low := new.stock is not null and eff is not null and new.stock <= eff;
  if is_low and not new.low_alerted then
    update products set low_alerted = true where id = new.id;
    if tg_op = 'UPDATE' and old.stock is not null then
      insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold)
      values (new.organization_id, new.id, new.integration_id, new.stock, eff);
    end if;
  elsif not is_low and new.low_alerted then
    update products set low_alerted = false where id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.track_low_stock() from public, anon, authenticated;
create trigger products_track_low_insert after insert on public.products
  for each row execute function public.track_low_stock();
create trigger products_track_low_update after update of stock, notify_on, notify_on_override on public.products
  for each row execute function public.track_low_stock();

create function public.enqueue_on_low_stock_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products; shop text; payload jsonb; queued int;
begin
  select * into p from products where id = new.product_id;
  select name into shop from integrations where id = new.integration_id;
  payload := jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'stock', new.stock, 'threshold', new.threshold,
                                  'unit', p.unit, 'category', p.category, 'shop', shop),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id, 'type', 'product.low_stock'));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, 'low_stock', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and v.definition->'trigger'->>'type' = 'low_stock'
    and (case when v.definition->'trigger'->'integration_ids' is not null
                then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
              else true end)
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
revoke execute on function public.enqueue_on_low_stock_event() from public, anon, authenticated;
create trigger low_stock_events_enqueue after insert on public.low_stock_events
  for each row execute function public.enqueue_on_low_stock_event();
