-- Two fixes to "a shop syncs its products", found when a friend's repeated clicks updated the app but never reached Discord.
--  1. What counts as ONE sync. 0021 merged requests from the same shop and person within 5 minutes of the FIRST request, so a
--     second click a few minutes later was swallowed into the first and notified nobody. A sync is now a burst: it continues while
--     requests keep arriving, and ends once 90 seconds pass with none. A big catalogue sent in chunks is still one sync (its chunks
--     follow each other within seconds), and a click after a pause is a new one.
--  2. Say what happened. Every sync now records how many automations it started, so the app can show "1 automation notified" or
--     "no automation was set up for this" instead of a silence that has to be investigated.

alter table public.product_sync_events add column notified int not null default 0;

create or replace function public.announce_products_synced(p_integration uuid, p_name text, p_role text, p_products int)
returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; n text := nullif(left(btrim(coalesce(p_name, '')), 120), ''); r text := nullif(left(btrim(coalesce(p_role, '')), 60), ''); recent uuid;
begin
  select organization_id into org from integrations where id = p_integration;
  if org is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(p_integration::text)); -- two chunks arriving together make one event, not two
  select id into recent from product_sync_events
  where integration_id = p_integration and by_name is not distinct from n and by_role is not distinct from r
    and updated_at > now() - interval '90 seconds' -- measured from the LAST request of the burst, not the first
  order by updated_at desc limit 1;
  if recent is not null then
    update product_sync_events set products = products + greatest(coalesce(p_products, 0), 0), updated_at = now() where id = recent;
  else
    insert into product_sync_events (organization_id, integration_id, by_name, by_role, products)
    values (org, p_integration, n, r, greatest(coalesce(p_products, 0), 0));
  end if;
end $$;

create or replace function public.enqueue_on_product_sync_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare shop text; who text; payload jsonb; queued int;
begin
  select name into shop from integrations where id = new.integration_id;
  who := case when new.by_name is not null and new.by_role is not null then new.by_name || ' (' || new.by_role || ')'
              else coalesce(new.by_name, new.by_role, shop) end;
  payload := jsonb_build_object(
    -- `where` is " (Game Store)" when a person is named, and empty when the subject already is the shop, so the shop is never said twice
    'sync', jsonb_build_object('by', who, 'name', new.by_name, 'role', new.by_role, 'shop', shop,
                               'where', case when who is distinct from shop then ' (' || shop || ')' else '' end),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id, 'type', 'products.synced'));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, 'products_synced', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.deleted_at is null and w.organization_id = new.organization_id
    and v.definition->'trigger'->>'type' = 'products_synced'
    and (case when v.definition->'trigger'->'integration_ids' is not null
                then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
              else true end)
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  update product_sync_events set notified = queued where id = new.id; -- so the app can say how many automations this started
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
