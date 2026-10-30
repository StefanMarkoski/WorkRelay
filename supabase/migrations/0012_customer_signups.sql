-- Optional customer signups and the two customer automation triggers.
--  * Each shop can switch on "receive customer signups" (off by default). The /customer-webhook function only accepts
--    events for shops that did, and apply_customer_signup re-checks inside the transaction.
--  * "Customer signed up" and "New customer (first order)" are real rows in customer_events. Unique keys make each fire
--    once, and the existing automation queue is reused: a trigger on customer_events enqueues matching workflows.
--  * Email stays the only identity (see 0011). external_id is stored and shown, never used for matching.

alter table public.integrations
  add column track_signups boolean not null default false,
  add column signups_enabled_at timestamptz; -- signups that happened before this moment are saved but never notified

grant select (track_signups, signups_enabled_at) on public.integrations to authenticated;

alter table public.customers
  add column registered_at timestamptz,                       -- earliest signup the shop reported; null if never reported
  add column signup_integration_id uuid references public.integrations (id) on delete set null,
  add column external_id text;                                 -- the shop's own customer id; informational only

create table public.customer_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  type text not null check (type in ('signed_up', 'first_order')),
  integration_id uuid references public.integrations (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  occurred_at timestamptz not null default now()
);
-- A customer has one first order ever, and signs up once per shop.
create unique index customer_events_first_order_uniq on public.customer_events (customer_id) where type = 'first_order';
create unique index customer_events_signup_uniq on public.customer_events (customer_id, integration_id) where type = 'signed_up';
alter table public.customer_events enable row level security;
revoke all on public.customer_events from anon, authenticated; -- internal: written by triggers and the signup function only

-- ------------------------------------------------------------------------------------------------ the setting
create function public.set_integration_signups(p_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_id for update;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  update integrations set
    track_signups = p_enabled,
    -- switching on (again) starts a fresh window: signups from while it was off never arrive as a burst later
    signups_enabled_at = case when p_enabled and not i.track_signups then now() else i.signups_enabled_at end,
    updated_at = now()
  where id = p_id;
end $$;
revoke execute on function public.set_integration_signups(uuid, boolean) from public, anon;
grant execute on function public.set_integration_signups(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------------------------------------ first order
-- Same as 0011, plus: when an order gives a customer their first order, record a "first_order" event (once per customer).
create or replace function public.sync_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := nullif(lower(btrim(new.customer_email)), ''); at timestamptz; cid uuid; candidate boolean := true;
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
    first_seen_at = least(customers.first_seen_at, excluded.first_seen_at)
  returning id into cid;

  -- On an update, only an order that moved to this email can be a first order (a renamed customer is not).
  if tg_op = 'UPDATE' then candidate := lower(btrim(old.customer_email)) is distinct from k; end if;
  if candidate and not exists (
    select 1 from orders o
    where o.organization_id = new.organization_id and lower(btrim(o.customer_email)) = k and o.id <> new.id
  ) then
    insert into customer_events (organization_id, customer_id, type, integration_id, order_id)
    values (new.organization_id, cid, 'first_order', new.integration_id, new.id)
    on conflict do nothing; -- a racing second order, or an email moved back and forth, never fires twice
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------------------------------------ signup
-- Applies one customer.created / customer.updated event in a single transaction. Called by the Edge Function (service role).
create function public.apply_customer_signup(
  p_event_row uuid, p_org uuid, p_integration uuid, p_event_type text, p_occurred_at timestamptz,
  p_email text, p_name text, p_phone text, p_external_id text, p_registered_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  i integrations; k text := nullif(lower(btrim(p_email)), ''); reg timestamptz := coalesce(p_registered_at, p_occurred_at); cid uuid;
begin
  select * into i from integrations where id = p_integration and organization_id = p_org;
  if not found or not i.track_signups then
    -- Switched off between the function's check and now, or by the setting: keep the event, visibly ignored. A resend
    -- after switching on is processed (the store treats this reason as retryable).
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

  -- Either event proves the account exists. Only customer.created can be a "signed up" notification.
  update customers set registered_at = least(coalesce(registered_at, reg), reg),
                       signup_integration_id = coalesce(signup_integration_id, p_integration)
  where id = cid;

  -- Signups from before tracking was switched on are history (a shop importing its old accounts): saved, never notified.
  if p_event_type = 'customer.created' and (i.signups_enabled_at is null or reg >= i.signups_enabled_at) then
    insert into customer_events (organization_id, customer_id, type, integration_id)
    values (p_org, cid, 'signed_up', p_integration)
    on conflict do nothing;
  end if;

  update webhook_events set status = 'processed', processed_at = now(), error = null where id = p_event_row;
  return 'ok';
end $$;
revoke execute on function public.apply_customer_signup(uuid, uuid, uuid, text, timestamptz, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_customer_signup(uuid, uuid, uuid, text, timestamptz, text, text, text, text, timestamptz) to service_role;

-- ------------------------------------------------------------------------------------------------ automations
create function public.enqueue_on_customer_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare c customers; o orders; payload jsonb; queued int;
begin
  select * into c from customers where id = new.customer_id;
  payload := jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
                                   'registered_at', c.registered_at, 'external_id', c.external_id),
    'event', jsonb_build_object('id', new.id, 'type', case new.type when 'signed_up' then 'customer.signed_up' else 'customer.first_order' end));
  if new.order_id is not null then
    select * into o from orders where id = new.order_id;
    if found then payload := payload || jsonb_build_object('order', to_jsonb(o) - 'applied_at' - 'data_quality' - 'version'); end if;
  end if;

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, v.definition->'trigger'->>'type', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and (
      (new.type = 'signed_up' and v.definition->'trigger'->>'type' = 'customer_signup'
        and (v.definition->'trigger'->>'integration_id' is null or v.definition->'trigger'->>'integration_id' = new.integration_id::text))
      or (new.type = 'first_order' and v.definition->'trigger'->>'type' = 'customer_first_order')
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
revoke execute on function public.enqueue_on_customer_event() from public, anon, authenticated;

create trigger customer_events_enqueue after insert on public.customer_events
  for each row execute function public.enqueue_on_customer_event();

-- ------------------------------------------------------------------------------------------------ the list
-- p_scope: 'ordered' (default: people with at least one order), 'registered' (signed up, no orders yet), 'all'.
-- Asking for one customer by id always finds them, whichever group they are in.
drop function public.list_customers(uuid, text, int, int, uuid);
create function public.list_customers(
  p_org uuid, p_search text default null, p_limit int default 25, p_offset int default 0, p_id uuid default null,
  p_scope text default 'ordered'
) returns table (
  id uuid, name text, email text, phone text, first_seen_at timestamptz, last_order_at timestamptz,
  order_count bigint, spent jsonb, registered_at timestamptz, external_id text, total_count bigint
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
  select c.id, c.name, c.email, c.phone, c.first_seen_at, agg.last_at, coalesce(agg.n, 0), coalesce(spend.spent, '{}'::jsonb),
         c.registered_at, c.external_id, count(*) over ()
  from customers c
  left join agg on agg.k = c.email_key
  left join spend on spend.k = c.email_key
  where c.organization_id = p_org
    and (p_id is null or c.id = p_id)
    and case when p_id is not null or p_scope = 'all' then (agg.n is not null or c.registered_at is not null)
             when p_scope = 'registered' then (agg.n is null and c.registered_at is not null)
             else agg.n is not null end
    and (coalesce(p_search, '') = '' or
         c.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' or
         c.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  order by coalesce(agg.last_at, c.registered_at) desc, c.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.list_customers(uuid, text, int, int, uuid, text) from public, anon;
grant execute on function public.list_customers(uuid, text, int, int, uuid, text) to authenticated;
