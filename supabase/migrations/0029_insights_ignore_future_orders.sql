-- Insights ignore orders dated in the future. The webhook now refuses such dates (more than a day ahead), so this only protects
-- orders stored earlier: without an upper bound a mis-dated order was counted in the period's totals but never drawn on the chart.
-- Orders and revenue per day, shop and currency.
create or replace function public.insights_orders_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, integration_id uuid, currency char(3), orders bigint, cancelled bigint, revenue_minor bigint)
language sql stable security invoker set search_path = public as $$
  select (coalesce(o.placed_at, o.created_at) at time zone insights_tz(p_tz))::date, o.integration_id, o.currency,
         count(*), count(*) filter (where o.status = 'cancelled'),
         coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled' and o.currency is not null), 0)::bigint
  from orders o
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day'
    and (p_integration is null or o.integration_id = p_integration)
  group by 1, 2, 3
$$;

-- How the period's orders stand now: pending, processing, completed, cancelled or unknown.
create or replace function public.insights_order_status(p_org uuid, p_since timestamptz, p_integration uuid default null)
returns table (status text, orders bigint)
language sql stable security invoker set search_path = public as $$
  select o.status::text, count(*)
  from orders o
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day'
    and (p_integration is null or o.integration_id = p_integration)
  group by 1
$$;

-- Only orders with an email address can be matched to a customer.
create or replace function public.insights_customers_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
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
  from ranked where t between p_since and now() + interval '1 day'
  group by 1
$$;

-- The best-selling products by pieces, cancelled orders left out. Items without a SKU are grouped by name.
create or replace function public.insights_top_products(p_org uuid, p_since timestamptz, p_integration uuid default null, p_limit int default 10)
returns table (product_id uuid, sku text, name text, integration_name text, quantity bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, k.key, coalesce(max(p.name), max(oi.name), k.key), i.name, sum(oi.quantity)::bigint
  from order_items oi
  join orders o on o.id = oi.order_id
  join integrations i on i.id = o.integration_id
  cross join lateral (select coalesce(nullif(btrim(oi.sku), ''), oi.name) as key) k
  left join products p on p.integration_id = o.integration_id and p.sku = nullif(btrim(oi.sku), '')
  where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day' and o.status <> 'cancelled'
    and k.key is not null and coalesce(oi.quantity, 0) > 0
    and (p_integration is null or o.integration_id = p_integration)
  group by p.id, k.key, i.name, o.integration_id
  order by 5 desc, 2
  limit least(greatest(p_limit, 1), 50)
$$;

-- When orders arrive: counts by weekday (0 = Sunday) and hour, in the caller's time zone.
create or replace function public.insights_hourly(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (dow int, hour int, orders bigint)
language sql stable security invoker set search_path = public as $$
  select extract(dow from l)::int, extract(hour from l)::int, count(*)
  from (
    select coalesce(o.placed_at, o.created_at) at time zone insights_tz(p_tz) as l
    from orders o
    where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day'
      and (p_integration is null or o.integration_id = p_integration)
  ) x
  group by 1, 2
$$;

