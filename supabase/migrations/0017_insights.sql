-- Insights: read-only aggregates behind the charts. Every function runs as the caller (security invoker), so row security
-- decides what is counted, and none of them writes anything.
--  * Days are cut in the caller's own time zone (p_tz, an IANA name such as 'Europe/Skopje'); an unknown name falls back to
--    UTC. Days with no activity are simply absent: the app fills them in with zeros.
--  * "Orders" counts every order placed that day; revenue leaves out cancelled orders and orders with no total or currency,
--    and is returned per currency, because currencies are never added together.
--  * p_integration limits everything to one shop; null means all shops.

create function public.insights_tz(p_tz text) returns text
language sql stable set search_path = public, pg_catalog as $$
  select coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'UTC')
$$;

-- Orders and revenue per day, shop and currency.
create function public.insights_orders_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, integration_id uuid, currency char(3), orders bigint, cancelled bigint, revenue_minor bigint)
language sql stable security invoker set search_path = public as $$
  select (coalesce(o.placed_at, o.created_at) at time zone insights_tz(p_tz))::date, o.integration_id, o.currency,
         count(*), count(*) filter (where o.status = 'cancelled'),
         coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled' and o.currency is not null), 0)::bigint
  from orders o
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) >= p_since
    and (p_integration is null or o.integration_id = p_integration)
  group by 1, 2, 3
$$;

-- How the period's orders stand now: pending, processing, completed, cancelled or unknown.
create function public.insights_order_status(p_org uuid, p_since timestamptz, p_integration uuid default null)
returns table (status text, orders bigint)
language sql stable security invoker set search_path = public as $$
  select o.status::text, count(*)
  from orders o
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) >= p_since
    and (p_integration is null or o.integration_id = p_integration)
  group by 1
$$;

-- Automation runs per day and status.
create function public.insights_runs_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, status text, runs bigint)
language sql stable security invoker set search_path = public as $$
  select (r.created_at at time zone insights_tz(p_tz))::date, r.status::text, count(*)
  from workflow_runs r
  where r.organization_id = p_org and r.created_at >= p_since
    and (p_integration is null
         or r.context->'order'->>'integration_id' = p_integration::text
         or r.context->'event'->>'integration_id' = p_integration::text)
  group by 1, 2
$$;

-- Deliveries from the shops (orders, signups, product feeds) per day and status.
create function public.insights_events_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, status text, events bigint)
language sql stable security invoker set search_path = public as $$
  select (e.received_at at time zone insights_tz(p_tz))::date, e.status::text, count(*)
  from webhook_events e
  where e.organization_id = p_org and e.received_at >= p_since
    and (p_integration is null or e.integration_id = p_integration)
  group by 1, 2
$$;

-- New customers (their first order, anywhere or in the chosen shop) and orders from returning customers, per day.
-- Only orders with an email address can be matched to a customer.
create function public.insights_customers_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, new_customers bigint, returning_orders bigint)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select coalesce(o.placed_at, o.created_at) as t,
           row_number() over (partition by lower(btrim(o.customer_email)) order by coalesce(o.placed_at, o.created_at), o.id) as rn
    from orders o
    where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
      and (p_integration is null or o.integration_id = p_integration)
  )
  select (t at time zone insights_tz(p_tz))::date, count(*) filter (where rn = 1), count(*) filter (where rn > 1)
  from ranked where t >= p_since
  group by 1
$$;

-- The best-selling products by pieces, cancelled orders left out. Items without a SKU are grouped by name.
create function public.insights_top_products(p_org uuid, p_since timestamptz, p_integration uuid default null, p_limit int default 10)
returns table (product_id uuid, sku text, name text, integration_name text, quantity bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, k.key, coalesce(max(p.name), max(oi.name), k.key), i.name, sum(oi.quantity)::bigint
  from order_items oi
  join orders o on o.id = oi.order_id
  join integrations i on i.id = o.integration_id
  cross join lateral (select coalesce(nullif(btrim(oi.sku), ''), oi.name) as key) k
  left join products p on p.integration_id = o.integration_id and p.sku = nullif(btrim(oi.sku), '')
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) >= p_since and o.status <> 'cancelled'
    and k.key is not null and coalesce(oi.quantity, 0) > 0
    and (p_integration is null or o.integration_id = p_integration)
  group by p.id, k.key, i.name, o.integration_id
  order by 5 desc, 2
  limit least(greatest(p_limit, 1), 50)
$$;

-- When orders arrive: counts by weekday (0 = Sunday) and hour, in the caller's time zone.
create function public.insights_hourly(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (dow int, hour int, orders bigint)
language sql stable security invoker set search_path = public as $$
  select extract(dow from l)::int, extract(hour from l)::int, count(*)
  from (
    select coalesce(o.placed_at, o.created_at) at time zone insights_tz(p_tz) as l
    from orders o
    where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) >= p_since
      and (p_integration is null or o.integration_id = p_integration)
  ) x
  group by 1, 2
$$;

-- How the catalogue stands: low (at or below its Notify on), fine, no threshold set, stock never reported.
create function public.insights_inventory_health(p_org uuid, p_integration uuid default null)
returns table (low bigint, ok bigint, no_threshold bigint, not_reported bigint)
language sql stable security invoker set search_path = public as $$
  select count(*) filter (where stock is not null and eff is not null and stock <= eff),
         count(*) filter (where stock is not null and eff is not null and stock > eff),
         count(*) filter (where stock is not null and eff is null),
         count(*) filter (where stock is null)
  from (select p.stock, coalesce(p.notify_on_override, p.notify_on) as eff
        from products p where p.organization_id = p_org and (p_integration is null or p.integration_id = p_integration)) x
$$;

revoke execute on function
  public.insights_tz(text), public.insights_orders_daily(uuid, timestamptz, text, uuid), public.insights_runs_daily(uuid, timestamptz, text, uuid),
  public.insights_events_daily(uuid, timestamptz, text, uuid), public.insights_customers_daily(uuid, timestamptz, text, uuid),
  public.insights_top_products(uuid, timestamptz, uuid, int), public.insights_hourly(uuid, timestamptz, text, uuid),
  public.insights_inventory_health(uuid, uuid), public.insights_order_status(uuid, timestamptz, uuid)
  from public, anon;
grant execute on function
  public.insights_tz(text), public.insights_orders_daily(uuid, timestamptz, text, uuid), public.insights_runs_daily(uuid, timestamptz, text, uuid),
  public.insights_events_daily(uuid, timestamptz, text, uuid), public.insights_customers_daily(uuid, timestamptz, text, uuid),
  public.insights_top_products(uuid, timestamptz, uuid, int), public.insights_hourly(uuid, timestamptz, text, uuid),
  public.insights_inventory_health(uuid, uuid), public.insights_order_status(uuid, timestamptz, uuid)
  to authenticated;
