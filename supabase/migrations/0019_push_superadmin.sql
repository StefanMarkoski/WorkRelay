-- Accepting pushed inventory from a shop is a decision for the platform, not for the shop's workspace: it decides how a
-- shop's data reaches WorkRelay, like the schedule rate does. So:
--  * only a platform admin can switch a shop's push on or off (admin_set_push_enabled);
--  * set_sync_source (the workspace's own call) no longer touches it. It keeps its old signature, and the p_push argument is
--    accepted and ignored, so a page that was open before this change still saves its other fields instead of failing;
--  * the Tenants listing shows it.
-- Shops that already had push on keep it.

create or replace function public.set_sync_source(
  p_integration uuid, p_url text, p_auth_header text, p_push boolean default null, p_paused boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  -- p_push is deliberately unused: see admin_set_push_enabled.
  insert into integration_sync (integration_id, organization_id, source_url, auth_header, paused)
  values (p_integration, i.organization_id, nullif(btrim(p_url), ''), nullif(btrim(p_auth_header), ''), coalesce(p_paused, false))
  on conflict (integration_id) do update set
    source_url = excluded.source_url,
    auth_header = case when p_auth_header is null then integration_sync.auth_header else excluded.auth_header end,
    paused = excluded.paused, updated_at = now();
end $$;

create function public.admin_set_push_enabled(p_integration uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from integrations where id = p_integration;
  if not found then raise exception 'unknown shop'; end if;
  insert into integration_sync (integration_id, organization_id, push_enabled)
  values (p_integration, i.organization_id, coalesce(p_enabled, false))
  on conflict (integration_id) do update set push_enabled = excluded.push_enabled, updated_at = now();
end $$;
revoke execute on function public.admin_set_push_enabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_push_enabled(uuid, boolean) to authenticated;

drop function public.admin_list_tenant_shops(uuid);
create function public.admin_list_tenant_shops(p_org uuid)
returns table (
  id uuid, name text, status public.integration_status, currency char(3), push_enabled boolean,
  calls int, days int, last_sync_at timestamptz, last_error text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select i.id, i.name, i.status, i.currency, coalesce(s.push_enabled, false), s.calls, s.days, s.last_sync_at, s.last_error
    from integrations i left join integration_sync s on s.integration_id = i.id
    where i.organization_id = p_org order by i.created_at;
end $$;
revoke execute on function public.admin_list_tenant_shops(uuid) from public, anon;
grant execute on function public.admin_list_tenant_shops(uuid) to authenticated;
