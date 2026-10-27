-- Platform (super) admins: can list all tenants and create new ones. They do NOT get read access to tenant data;
-- that stays behind normal RLS. Membership of this table is managed only with SQL by the project owner.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create function public.admin_list_tenants()
returns table (
  id uuid, name text, created_at timestamptz, owner_emails text[],
  members bigint, integrations bigint, workflows bigint, orders bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select o.id, o.name, o.created_at,
      coalesce((select array_agg(u.email::text order by u.email) from memberships m
                join auth.users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'owner'), '{}'),
      (select count(*) from memberships m where m.organization_id = o.id),
      (select count(*) from integrations i where i.organization_id = o.id),
      (select count(*) from workflows w where w.organization_id = o.id),
      (select count(*) from orders r where r.organization_id = o.id)
    from organizations o order by o.created_at desc;
end $$;

-- Called only by the admin-create-tenant Edge Function (service role) after it created the auth user.
create function public.admin_create_tenant(p_caller uuid, p_owner uuid, p_org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not exists (select 1 from platform_admins where user_id = p_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_org_name, ''))) not between 1 and 120 then raise exception 'invalid name'; end if;
  insert into organizations (name, created_by) values (trim(p_org_name), p_owner) returning id into new_id;
  insert into memberships (organization_id, user_id, role) values (new_id, p_owner, 'owner');
  return new_id;
end $$;

revoke execute on function public.is_platform_admin(), public.admin_list_tenants() from public, anon;
grant execute on function public.is_platform_admin(), public.admin_list_tenants() to authenticated;
revoke execute on function public.admin_create_tenant(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_tenant(uuid, uuid, text) to service_role;
