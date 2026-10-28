-- 1) Realtime: the dashboard learns about changes instead of polling.
-- Only tables whose every column is readable by the client are published. webhook_events (raw_payload holds
-- customer data) and integrations (key_hash) must NEVER be added: Realtime does not apply column-level grants.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'order_events', 'workflow_runs', 'step_runs', 'approvals'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- 2) Instant automations: wake the engine as soon as work is queued, instead of waiting for the next cron tick.
-- pg_net queues the request and sends it after the transaction commits. The cron job stays as the safety net
-- (retries, approvals that resume later, crash recovery). Needs the Vault secrets from the setup guide; if they or
-- pg_net are missing this silently does nothing, and it can never fail the write that triggered it.
create function public.kick_engine() returns void
language plpgsql security definer set search_path = public, extensions, vault, net as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'engine_secret';
  if base is null or secret is null then return; end if;
  perform net.http_post(
    url := base || '/functions/v1/run-engine',
    headers := jsonb_build_object('content-type', 'application/json', 'x-engine-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
exception when others then
  null;
end $$;
revoke execute on function public.kick_engine() from public, anon, authenticated;

create or replace function public.enqueue_on_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ord orders; payload jsonb; to_status text; applied jsonb; queued int;
begin
  if new.source <> 'external' or new.type not in ('order.created', 'order.updated', 'order.status_changed') then
    return new;
  end if;
  select * into ord from orders where id = new.order_id;
  applied := coalesce(new.data->'applied', '[]');
  to_status := new.data->>'status_to';
  payload := jsonb_build_object(
    'order', to_jsonb(ord) - 'applied_at' - 'data_quality' - 'version',
    'event', jsonb_build_object('id', new.data->>'event_id', 'type', new.type));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id,
         v.definition->'trigger'->>'type',
         coalesce(new.data->>'event_id', new.id::text),
         payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and (
      (v.definition->'trigger'->>'type' = 'webhook' and v.definition->'trigger'->>'integration_id' = ord.integration_id::text)
      or (v.definition->'trigger'->>'type' = 'order_created' and new.type = 'order.created')
      or (v.definition->'trigger'->>'type' = 'order_status_changed' and applied ? 'status'
          and (v.definition->'trigger'->>'to_status' is null or v.definition->'trigger'->>'to_status' = to_status))
    )
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;

create or replace function public.decide_approval(p_id uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a approvals; allowed org_role[];
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;
  select * into a from approvals where id = p_id for update;
  if not found or not is_org_member(a.organization_id) then raise exception 'not found'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if a.reviewer_user_id is not null then
    if a.reviewer_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    allowed := case a.reviewer_role
      when 'member' then array['owner','admin','member']::org_role[]
      when 'owner' then array['owner']::org_role[]
      else array['owner','admin']::org_role[] end;
    if not has_org_role(a.organization_id, allowed) then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  update approvals set status = p_decision::approval_status, decided_by = auth.uid(),
    decided_at = now(), comment = nullif(trim(p_comment), '') where id = p_id;
  -- Resume the paused run right away.
  perform kick_engine();
end $$;
