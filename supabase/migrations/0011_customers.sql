-- Customers: everyone who has placed an order, identified by email within a workspace.
-- The table holds identity and profile only. Order counts, order value and last order are computed from orders when read,
-- so a late event or a manual status edit can never leave a stale counter behind.
-- It is kept in sync by a trigger on orders, in the same transaction as the order write; the webhook code is unchanged.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email_key text not null,        -- lower(btrim(email)): how orders are matched to this customer
  email text not null,            -- as the shop wrote it
  name text,
  phone text,
  profile_at timestamptz not null, -- when email/name/phone were last set; an older order never overwrites a newer one
  first_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, email_key)
);

create index orders_customer_idx on public.orders (organization_id, (lower(btrim(customer_email))))
  where customer_email is not null;

alter table public.customers enable row level security;
create policy cust_select on public.customers for select using (is_org_member(organization_id));
revoke all on public.customers from anon, authenticated;
grant select on public.customers to authenticated;

create function public.sync_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := nullif(lower(btrim(new.customer_email)), ''); at timestamptz;
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
    first_seen_at = least(customers.first_seen_at, excluded.first_seen_at);
  return new;
end $$;
revoke execute on function public.sync_customer() from public, anon, authenticated;

create trigger orders_sync_customer_insert after insert on public.orders
  for each row execute function public.sync_customer();
-- apply_order_plan rewrites every column on each event, so only react when a customer field really changed.
create trigger orders_sync_customer_update after update on public.orders
  for each row
  when (old.customer_email is distinct from new.customer_email
     or old.customer_name is distinct from new.customer_name
     or old.customer_phone is distinct from new.customer_phone)
  execute function public.sync_customer();

-- Existing orders become customers: latest email/name/phone, earliest order.
insert into public.customers (organization_id, email_key, email, name, phone, profile_at, first_seen_at)
select organization_id, k,
       (array_agg(email order by at desc))[1],
       (array_agg(name order by at desc) filter (where name is not null))[1],
       (array_agg(phone order by at desc) filter (where phone is not null))[1],
       max(at), min(seen)
from (
  select organization_id, lower(btrim(customer_email)) as k, btrim(customer_email) as email,
         nullif(btrim(customer_name), '') as name, nullif(btrim(customer_phone), '') as phone,
         coalesce((applied_at->>'customer')::timestamptz, last_event_at) as at, coalesce(placed_at, created_at) as seen
  from public.orders where nullif(lower(btrim(customer_email)), '') is not null
) o group by organization_id, k;

-- The Customers list (and, with p_id, one customer's summary). Runs as the caller, so row security on orders and
-- customers decides what is seen. Order value is per currency and leaves out cancelled orders.
create function public.list_customers(
  p_org uuid, p_search text default null, p_limit int default 25, p_offset int default 0, p_id uuid default null
) returns table (
  id uuid, name text, email text, phone text, first_seen_at timestamptz, last_order_at timestamptz,
  order_count bigint, spent jsonb, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with agg as (
    select lower(btrim(o.customer_email)) as k, count(*) as n, max(coalesce(o.placed_at, o.created_at)) as last_at
    from orders o
    where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
    group by 1
  ), spend as (
    select k, jsonb_object_agg(cur, s) as spent from (
      select lower(btrim(o.customer_email)) as k, o.currency as cur, sum(o.total_minor) as s
      from orders o
      where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
        and o.currency is not null and o.total_minor is not null and o.status <> 'cancelled'
      group by 1, 2
    ) x group by k
  )
  select c.id, c.name, c.email, c.phone, c.first_seen_at, agg.last_at, agg.n, coalesce(spend.spent, '{}'::jsonb),
         count(*) over ()
  from customers c
  join agg on agg.k = c.email_key
  left join spend on spend.k = c.email_key
  where c.organization_id = p_org
    and (p_id is null or c.id = p_id)
    and (coalesce(p_search, '') = '' or
         c.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' or
         c.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  order by agg.last_at desc, c.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- One customer's orders, newest first.
create function public.customer_orders(p_customer uuid, p_limit int default 25, p_offset int default 0)
returns table (
  id uuid, order_number text, external_id text, placed_at timestamptz, status public.order_status,
  payment_status public.payment_status, fulfillment_status public.fulfillment_status, currency char(3),
  total_minor bigint, integration_name text, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  select o.id, o.order_number, o.external_id, coalesce(o.placed_at, o.created_at), o.status, o.payment_status,
         o.fulfillment_status, o.currency, o.total_minor, i.name, count(*) over ()
  from customers c
  join orders o on o.organization_id = c.organization_id and lower(btrim(o.customer_email)) = c.email_key
  left join integrations i on i.id = o.integration_id
  where c.id = p_customer
  order by coalesce(o.placed_at, o.created_at) desc, o.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

revoke execute on function public.list_customers(uuid, text, int, int, uuid), public.customer_orders(uuid, int, int) from public, anon;
grant execute on function public.list_customers(uuid, text, int, int, uuid), public.customer_orders(uuid, int, int) to authenticated;
