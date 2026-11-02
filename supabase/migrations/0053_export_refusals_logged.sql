-- Refusals before the signature check are written to the export history as well, so the owner sees every attempt that got past the
-- shop key and store id: a missing signature, a stale timestamp, a replay, a call while export is off. They are capped (100 an hour per
-- shop, so a noisy caller cannot fill the table) and do not use up the 120-call allowance of the real caller.

create or replace function public.export_begin(p_integration uuid, p_request_id text, p_resource text)
returns table (ok boolean, reason text, call_id uuid, secret text)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; used int; cid uuid; sec text;
begin
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then return query select false, 'not_connected', null::uuid, null::text; return; end if;
  if i.export_secret_id is null then return query select false, 'export_off', null::uuid, null::text; return; end if;

  delete from export_calls where integration_id = p_integration and created_at < now() - interval '30 days';

  select count(*) into used from export_calls
  where integration_id = p_integration and created_at > now() - interval '1 hour' and request_id not like 'refused-%';
  if used >= 120 then return query select false, 'rate_limited', null::uuid, null::text; return; end if;

  insert into export_calls (organization_id, integration_id, request_id, resource)
  values (i.organization_id, p_integration, p_request_id, p_resource)
  on conflict (integration_id, request_id) do nothing
  returning id into cid;
  if cid is null then return query select false, 'replayed', null::uuid, null::text; return; end if;

  select decrypted_secret into sec from vault.decrypted_secrets where id = i.export_secret_id;
  if sec is null then
    update export_calls set status = 'failed', reason = 'The signing secret is missing.' where id = cid;
    return query select false, 'export_off', null::uuid, null::text; return;
  end if;
  return query select true, null::text, cid, sec;
end $$;

create function public.export_note_refusal(p_integration uuid, p_resource text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  if p_resource not in ('orders', 'customers', 'products') then return; end if;
  select * into i from integrations where id = p_integration;
  if not found then return; end if;
  if (select count(*) from export_calls where integration_id = p_integration and request_id like 'refused-%'
        and created_at > now() - interval '1 hour') >= 100 then return; end if;
  insert into export_calls (organization_id, integration_id, request_id, resource, status, reason)
  values (i.organization_id, p_integration, 'refused-' || gen_random_uuid()::text, p_resource, 'refused', left(p_reason, 300));
end $$;

revoke execute on function public.export_note_refusal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.export_note_refusal(uuid, text, text) to service_role;
