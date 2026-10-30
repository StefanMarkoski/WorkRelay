-- Customers per shop. A customer is one person across the workspace (matched by email), but the Customers page can also
-- show a single shop: the people who ordered from it or signed up through it, with that shop's own order counts and value.
-- customers.signup_integration_id only remembers the FIRST shop a person signed up in, so every (customer, shop) signup is
-- recorded here as well.

create table public.customer_signups (
  customer_id uuid not null references public.customers (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  registered_at timestamptz not null,
  primary key (customer_id, integration_id)
);
alter table public.customer_signups enable row level security;
create policy csu_select on public.customer_signups for select using (is_org_member(organization_id));
revoke all on public.customer_signups from anon, authenticated;
grant select on public.customer_signups to authenticated;

-- Signups already recorded by 0012 know their first shop; keep that.
insert into public.customer_signups (customer_id, integration_id, organization_id, registered_at)
select id, signup_integration_id, organization_id, registered_at
from public.customers where signup_integration_id is not null and registered_at is not null
on conflict do nothing;

-- Same as 0012, plus: remember this shop in customer_signups (every created/updated event proves the account exists there).
create or replace function public.apply_customer_signup(
  p_event_row uuid, p_org uuid, p_integration uuid, p_event_type text, p_occurred_at timestamptz,
  p_email text, p_name text, p_phone text, p_external_id text, p_registered_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  i integrations; k text := nullif(lower(btrim(p_email)), ''); reg timestamptz := coalesce(p_registered_at, p_occurred_at); cid uuid;
begin
  select * into i from integrations where id = p_integration and organization_id = p_org;
  if not found or not i.track_signups then
    update webhook_events set status = 'ignored', processed_at = now(), error = 'signups_off: signup tracking is off for this shop'
      where id = p_event_row;
    return 'disabled';
  end if;
  if k is null then raise exception 'email is required'; end if;

  insert into customers (organization_id, email_key, email, name, phone, external_id, profile_at, first_seen_at)
  values (p_org, k, btrim(p_email), nullif(btrim(p_name), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_external_id), ''), p_occurred_at, reg)
  on conflict (organization_id, email_key) do update set
    email = case when excluded.profile_at >= customers.profile_at then excluded.email else customers.email end,
    name = case when excluded.profile_at >= customers.profile_at then coalesce(excluded.name, customers.name)
                else coalesce(customers.name, excluded.name) end,
    phone = case when excluded.profile_at >= customers.profile_at then coalesce(excluded.phone, customers.phone)
                 else coalesce(customers.phone, excluded.phone) end,
    external_id = case when excluded.profile_at >= customers.profile_at then coalesce(excluded.external_id, customers.external_id)
                       else coalesce(customers.external_id, excluded.external_id) end,
    profile_at = greatest(customers.profile_at, excluded.profile_at),
    first_seen_at = least(customers.first_seen_at, excluded.first_seen_at)
  returning id into cid;

  update customers set registered_at = least(coalesce(registered_at, reg), reg),
                       signup_integration_id = coalesce(signup_integration_id, p_integration)
  where id = cid;

  insert into customer_signups (customer_id, integration_id, organization_id, registered_at)
  values (cid, p_integration, p_org, reg)
  on conflict (customer_id, integration_id) do update set registered_at = least(customer_signups.registered_at, excluded.registered_at);

  if p_event_type = 'customer.created' and (i.signups_enabled_at is null or reg >= i.signups_enabled_at) then
    insert into customer_events (organization_id, customer_id, type, integration_id)
    values (p_org, cid, 'signed_up', p_integration)
    on conflict do nothing;
  end if;

  update webhook_events set status = 'processed', processed_at = now(), error = null where id = p_event_row;
  return 'ok';
end $$;

-- ------------------------------------------------------------------------------------------------ the list, per shop
-- p_integration: only that shop. Order counts, last order and order value then count that shop's orders alone, and
-- "registered" means signed up through that shop. Without it, everything is workspace-wide as before.
drop function public.list_customers(uuid, text, int, int, uuid, text);
create function public.list_customers(
  p_org uuid, p_search text default null, p_limit int default 25, p_offset int default 0, p_id uuid default null,
  p_scope text default 'ordered', p_integration uuid default null
) returns table (
  id uuid, name text, email text, phone text, first_seen_at timestamptz, last_order_at timestamptz,
  order_count bigint, spent jsonb, registered_at timestamptz, external_id text, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with agg as (
    select lower(btrim(o.customer_email)) as k, count(*) as n, max(coalesce(o.placed_at, o.created_at)) as last_at
    from orders o
    where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
      and (p_integration is null or o.integration_id = p_integration)
    group by 1
  ), spend as (
    select k, jsonb_object_agg(cur, s) as spent from (
      select lower(btrim(o.customer_email)) as k, o.currency as cur, sum(o.total_minor) as s
      from orders o
      where o.organization_id = p_org and nullif(btrim(o.customer_email), '') is not null
        and o.currency is not null and o.total_minor is not null and o.status <> 'cancelled'
        and (p_integration is null or o.integration_id = p_integration)
      group by 1, 2
    ) x group by k
  )
  select c.id, c.name, c.email, c.phone, c.first_seen_at, agg.last_at, coalesce(agg.n, 0), coalesce(spend.spent, '{}'::jsonb),
         c.registered_at, c.external_id, count(*) over ()
  from customers c
  left join agg on agg.k = c.email_key
  left join spend on spend.k = c.email_key
  cross join lateral (
    select case when p_integration is null then c.registered_at is not null
                else exists (select 1 from customer_signups s where s.customer_id = c.id and s.integration_id = p_integration) end as reg
  ) r
  where c.organization_id = p_org
    and (p_id is null or c.id = p_id)
    and case when p_id is not null or p_scope = 'all' then (agg.n is not null or r.reg)
             when p_scope = 'registered' then (agg.n is null and r.reg)
             else agg.n is not null end
    and (coalesce(p_search, '') = '' or
         c.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' or
         c.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  order by coalesce(agg.last_at, c.registered_at) desc, c.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.list_customers(uuid, text, int, int, uuid, text, uuid) from public, anon;
grant execute on function public.list_customers(uuid, text, int, int, uuid, text, uuid) to authenticated;
