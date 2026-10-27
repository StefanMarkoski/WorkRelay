-- Durable webhook inbox and normalized orders. Writes come from Edge Functions (service role) only.

create type public.webhook_event_status as enum ('received', 'processed', 'ignored', 'failed');
create type public.order_status as enum ('pending', 'processing', 'completed', 'cancelled', 'unknown');
create type public.payment_status as enum ('unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'unknown');
create type public.fulfillment_status as enum ('unfulfilled', 'partial', 'fulfilled', 'returned', 'unknown');

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  event_id text not null,
  event_type text,
  status public.webhook_event_status not null default 'received',
  raw_payload jsonb not null,
  error text,
  attempt_count int not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  -- Duplicate-delivery protection: one row per (integration, event id).
  unique (integration_id, event_id)
);
create index webhook_events_org_received_idx on public.webhook_events (organization_id, received_at desc);
create index webhook_events_status_idx on public.webhook_events (status) where status in ('received', 'failed');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  external_id text not null,
  order_number text,
  customer_name text,
  customer_email text,
  customer_phone text,
  placed_at timestamptz,
  currency char(3),
  subtotal_minor bigint,
  discount_minor bigint,
  shipping_minor bigint,
  tax_minor bigint,
  total_minor bigint,
  status public.order_status not null default 'unknown',
  payment_status public.payment_status not null default 'unknown',
  fulfillment_status public.fulfillment_status not null default 'unknown',
  external_status text,
  external_payment_status text,
  external_fulfillment_status text,
  billing_address jsonb,
  shipping_address jsonb,
  notes text,
  data_quality text[] not null default '{}',
  -- Per field group: occurred_at of the last event applied (out-of-order protection).
  applied_at jsonb not null default '{}',
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id)
);
create index orders_org_placed_idx on public.orders (organization_id, placed_at desc);
create index orders_org_status_idx on public.orders (organization_id, status, payment_status, fulfillment_status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  position int not null,
  external_id text,
  sku text,
  name text,
  quantity int check (quantity is null or quantity >= 0),
  unit_price_minor bigint
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  -- 'external' = reported by the commerce app; 'workrelay' = action taken by WorkRelay.
  source text not null check (source in ('external', 'workrelay')),
  type text not null,
  occurred_at timestamptz not null,
  webhook_event_id uuid references public.webhook_events (id) on delete set null,
  actor_user_id uuid references auth.users (id),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, occurred_at);

alter table public.webhook_events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

-- Members read their own org's rows. No client write policies: ingestion uses the service role.
create policy we_select on public.webhook_events for select using (is_org_member(organization_id));
create policy ord_select on public.orders for select using (is_org_member(organization_id));
create policy oi_select on public.order_items for select using (is_org_member(organization_id));
create policy oe_select on public.order_events for select using (is_org_member(organization_id));

revoke all on public.webhook_events, public.orders, public.order_items, public.order_events from anon, authenticated;
grant select on public.orders, public.order_items, public.order_events to authenticated;
-- raw_payload may hold customer PII and is admin-visible only via the app's server layer; expose metadata columns.
grant select (id, organization_id, integration_id, event_id, event_type, status, error, attempt_count, received_at, processed_at)
  on public.webhook_events to authenticated;
