-- Tenancy, memberships, and key-bound integrations.
create extension if not exists pgcrypto;

create type public.org_role as enum ('owner', 'admin', 'member');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Authorization helpers. SECURITY DEFINER so policies on memberships don't recurse.
create function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where organization_id = org and user_id = auth.uid());
$$;

create function public.has_org_role(org uuid, roles public.org_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where organization_id = org and user_id = auth.uid() and role = any (roles)
  );
$$;

-- Atomic workspace creation: org + owner membership in one transaction.
create function public.create_organization(org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into organizations (name, created_by) values (org_name, auth.uid()) returning id into new_id;
  insert into memberships (organization_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

-- Integrations: one row per connected store. The binding key is stored only as a hash.
create type public.integration_status as enum ('awaiting_bind', 'connected', 'revoked');

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'commerce' check (kind in ('commerce')),
  name text not null check (char_length(name) between 1 and 120),
  status public.integration_status not null default 'awaiting_bind',
  key_prefix text not null,
  key_hash bytea not null unique,
  -- Set during the bind handshake; once set, the key only works for this store.
  external_store_id text,
  external_base_url text,
  bound_at timestamptz,
  last_seen_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'connected' or external_store_id is not null)
);
create index integrations_org_idx on public.integrations (organization_id);
-- A store may be bound to only one integration at a time.
create unique index integrations_active_store_uniq
  on public.integrations (kind, external_store_id) where status = 'connected';

-- Create a connection and return the plaintext key exactly once. Hash never leaves the DB via normal reads.
create function public.create_integration(org uuid, integration_name text)
returns table (integration_id uuid, secret_key text)
language plpgsql security definer set search_path = public, extensions as $$
declare raw text; new_id uuid;
begin
  if not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  raw := 'wr_live_' || encode(gen_random_bytes(32), 'hex');
  insert into integrations (organization_id, name, key_prefix, key_hash, created_by)
  values (org, integration_name, left(raw, 12), digest(raw, 'sha256'), auth.uid())
  returning id into new_id;
  return query select new_id, raw;
end $$;

-- Row Level Security
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.integrations enable row level security;

create policy org_select on public.organizations for select using (is_org_member(id));
create policy org_update on public.organizations for update
  using (has_org_role(id, array['owner','admin']::org_role[]))
  with check (has_org_role(id, array['owner','admin']::org_role[]));

create policy mem_select on public.memberships for select using (is_org_member(organization_id));
create policy mem_insert on public.memberships for insert
  with check (has_org_role(organization_id, array['owner','admin']::org_role[]) and role <> 'owner');
create policy mem_update on public.memberships for update
  using (has_org_role(organization_id, array['owner']::org_role[]))
  with check (has_org_role(organization_id, array['owner']::org_role[]));
create policy mem_delete on public.memberships for delete
  using (has_org_role(organization_id, array['owner','admin']::org_role[]) and role <> 'owner');

create policy int_select on public.integrations for select using (is_org_member(organization_id));
create policy int_update on public.integrations for update
  using (has_org_role(organization_id, array['owner','admin']::org_role[]))
  with check (has_org_role(organization_id, array['owner','admin']::org_role[]));

-- Least privilege: anonymous visitors get no table access; signed-in users get only what the UI needs.
-- Future tables in public must opt in to grants explicitly.
alter default privileges in schema public revoke all on tables from anon;
revoke all on public.organizations, public.memberships from anon, authenticated;
grant select on public.organizations, public.memberships to authenticated;
grant update (name) on public.organizations to authenticated;
grant insert on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

-- Never expose the key hash to client roles, even to members who can read the row.
revoke all on public.integrations from anon, authenticated;
grant select (id, organization_id, kind, name, status, key_prefix, external_store_id,
              external_base_url, bound_at, last_seen_at, created_at, updated_at)
  on public.integrations to authenticated;
grant update (name) on public.integrations to authenticated;
revoke execute on function public.create_integration(uuid, text) from anon, public;
grant execute on function public.create_integration(uuid, text) to authenticated;
revoke execute on function public.create_organization(text) from anon, public;
grant execute on function public.create_organization(text) to authenticated;
