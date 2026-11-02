-- One signing secret per shop, for everything WorkRelay signs or checks (stock write-back and the export API).
-- It is created and replaced on the shop's General tab (rotate_stock_push_secret, as before) and lives in Vault. Export no longer has a
-- secret of its own: it has an owner switch instead, off by default, which only turns on once the shop has a signing secret.

-- the shops that already had an export secret keep export on if they have a signing secret to use; the separate secrets are removed
alter table public.integrations add column export_enabled boolean not null default false;
update public.integrations set export_enabled = true where export_secret_id is not null and stock_push_secret_id is not null;
delete from vault.secrets where id in (select export_secret_id from public.integrations where export_secret_id is not null);

drop function public.rotate_export_secret(uuid);
drop function public.clear_export_secret(uuid);
alter table public.integrations
  drop column export_has_secret,
  drop column export_secret_id,
  drop column export_secret_version;
grant select (export_enabled) on public.integrations to authenticated;

-- the owner's switch; on needs the shop's signing secret first
create function public.set_export_enabled(p_integration uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on and i.status <> 'connected' then raise exception 'this connection is not connected'; end if;
  if p_on and i.stock_push_secret_id is null then raise exception 'Create the shop''s signing secret first (on the General tab).'; end if;
  update integrations set export_enabled = p_on, updated_at = now() where id = p_integration;
end $$;
revoke execute on function public.set_export_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_export_enabled(uuid, boolean) to authenticated;

create or replace function public.export_begin(p_integration uuid, p_request_id text, p_resource text)
returns table (ok boolean, reason text, call_id uuid, secret text)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; used int; cid uuid; sec text;
begin
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then return query select false, 'not_connected', null::uuid, null::text; return; end if;
  if not i.export_enabled or i.stock_push_secret_id is null then return query select false, 'export_off', null::uuid, null::text; return; end if;

  delete from export_calls where integration_id = p_integration and created_at < now() - interval '30 days';

  select count(*) into used from export_calls
  where integration_id = p_integration and created_at > now() - interval '1 hour' and request_id not like 'refused-%';
  if used >= 120 then return query select false, 'rate_limited', null::uuid, null::text; return; end if;

  insert into export_calls (organization_id, integration_id, request_id, resource)
  values (i.organization_id, p_integration, p_request_id, p_resource)
  on conflict (integration_id, request_id) do nothing
  returning id into cid;
  if cid is null then return query select false, 'replayed', null::uuid, null::text; return; end if;

  select decrypted_secret into sec from vault.decrypted_secrets where id = i.stock_push_secret_id;
  if sec is null then
    update export_calls set status = 'failed', reason = 'The signing secret is missing.' where id = cid;
    return query select false, 'export_off', null::uuid, null::text; return;
  end if;
  return query select true, null::text, cid, sec;
end $$;
