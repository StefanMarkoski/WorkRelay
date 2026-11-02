-- Insights without a time zone lookup per row. insights_tz(p_tz) looks the name up in pg_timezone_names and costs about 15 ms; the
-- daily and hourly charts called it once per order, event or run, so a workspace with a few thousand orders in the window made the
-- Insights page hit the statement timeout (8,000 orders: more than 8 seconds; the customers chart took 1.5 s).
-- Now the rows are counted per 15-minute slot of UTC first (every time zone's offset is a whole number of 15 minutes, so a slot never
-- straddles two local days or hours) and only the few hundred slots are moved to the local zone. The answers are the same.

create or replace function public.insights_orders_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, integration_id uuid, currency char(3), orders bigint, cancelled bigint, revenue_minor bigint)
language sql stable security invoker set search_path = public as $$
  with z as materialized (select insights_tz(p_tz) as tz),
  slots as (
    select date_bin('15 minutes', coalesce(o.placed_at, o.created_at), timestamptz '2000-01-01 00:00+00') as slot, o.integration_id, o.currency,
           count(*) as n, count(*) filter (where o.status = 'cancelled') as c,
           coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled' and o.currency is not null), 0) as rev
    from orders o
    where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day'
      and (p_integration is null or o.integration_id = p_integration)
    group by 1, 2, 3
  )
  select (s.slot at time zone (select tz from z))::date, s.integration_id, s.currency, sum(s.n)::bigint, sum(s.c)::bigint, sum(s.rev)::bigint
  from slots s group by 1, 2, 3
$$;

create or replace function public.insights_customers_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, new_customers bigint, returning_orders bigint)
language sql stable security invoker set search_path = public as $$
  with z as materialized (select insights_tz(p_tz) as tz),
  ranked as (
    select coalesce(o.placed_at, o.created_at) as t,
           row_number() over (partition by lower(btrim(o.customer_email)) order by coalesce(o.placed_at, o.created_at), o.id) as rn
    from orders o
    where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
      and (p_integration is null or o.integration_id = p_integration)
  ),
  slots as (
    select date_bin('15 minutes', t, timestamptz '2000-01-01 00:00+00') as slot, count(*) filter (where rn = 1) as fresh, count(*) filter (where rn > 1) as again
    from ranked where t between p_since and now() + interval '1 day'
    group by 1
  )
  select (s.slot at time zone (select tz from z))::date, sum(s.fresh)::bigint, sum(s.again)::bigint
  from slots s group by 1
$$;

create or replace function public.insights_hourly(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (dow int, hour int, orders bigint)
language sql stable security invoker set search_path = public as $$
  with z as materialized (select insights_tz(p_tz) as tz),
  slots as (
    select date_bin('15 minutes', coalesce(o.placed_at, o.created_at), timestamptz '2000-01-01 00:00+00') as slot, count(*) as n
    from orders o
    where o.organization_id = p_org and coalesce(o.placed_at, o.created_at) between p_since and now() + interval '1 day'
      and (p_integration is null or o.integration_id = p_integration)
    group by 1
  )
  select extract(dow from l)::int, extract(hour from l)::int, sum(n)::bigint
  from (select s.slot at time zone (select tz from z) as l, s.n from slots s) x
  group by 1, 2
$$;

create or replace function public.insights_events_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, status text, events bigint)
language sql stable security invoker set search_path = public as $$
  with z as materialized (select insights_tz(p_tz) as tz),
  slots as (
    select date_bin('15 minutes', e.received_at, timestamptz '2000-01-01 00:00+00') as slot, e.status::text as status, count(*) as n
    from webhook_events e
    where e.organization_id = p_org and e.received_at >= p_since
      and (p_integration is null or e.integration_id = p_integration)
    group by 1, 2
  )
  select (s.slot at time zone (select tz from z))::date, s.status, sum(s.n)::bigint from slots s group by 1, 2
$$;

create or replace function public.insights_runs_daily(p_org uuid, p_since timestamptz, p_tz text default 'UTC', p_integration uuid default null)
returns table (day date, status text, runs bigint)
language sql stable security invoker set search_path = public as $$
  with z as materialized (select insights_tz(p_tz) as tz),
  slots as (
    select date_bin('15 minutes', r.created_at, timestamptz '2000-01-01 00:00+00') as slot, r.status::text as status, count(*) as n
    from workflow_runs r
    where r.organization_id = p_org and r.created_at >= p_since
      and (p_integration is null
           or r.context->'order'->>'integration_id' = p_integration::text
           or r.context->'event'->>'integration_id' = p_integration::text)
    group by 1, 2
  )
  select (s.slot at time zone (select tz from z))::date, s.status, sum(s.n)::bigint from slots s group by 1, 2
$$;
