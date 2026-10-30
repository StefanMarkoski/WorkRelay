-- "A shop syncs its products": an automation that fires when a shop PUSHES its products to WorkRelay (its sync button in the
-- shop's own admin). The message names who did it, if the shop says so: "Marko (Admin) has synced their products (Game Store)".
--  * Only pushes announce. WorkRelay's own scheduled checks and the Sync now button are people inside WorkRelay already looking
--    at the result, so they do not.
--  * A button press can arrive as several requests (500 products at a time). Requests from the same shop and the same person
--    within 5 minutes are one sync: one event, one notification.
--  * The shop can mark an automatic background push as quiet, and then nothing is announced (handled before this is called).

create table public.product_sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  by_name text,
  by_role text,
  products int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_sync_events_shop_idx on public.product_sync_events (integration_id, created_at desc);
alter table public.product_sync_events enable row level security;
revoke all on public.product_sync_events from anon, authenticated; -- internal: written by announce_products_synced only

-- Called only by the inventory-webhook Edge Function (service role), after a push was applied.
create function public.announce_products_synced(p_integration uuid, p_name text, p_role text, p_products int)
returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; n text := nullif(left(btrim(coalesce(p_name, '')), 120), ''); r text := nullif(left(btrim(coalesce(p_role, '')), 60), ''); recent uuid;
begin
  select organization_id into org from integrations where id = p_integration;
  if org is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(p_integration::text)); -- two chunks of one sync arriving together make one event, not two
  select id into recent from product_sync_events
  where integration_id = p_integration and by_name is not distinct from n and by_role is not distinct from r
    and created_at > now() - interval '5 minutes'
  order by created_at desc limit 1;
  if recent is not null then
    update product_sync_events set products = products + greatest(coalesce(p_products, 0), 0), updated_at = now() where id = recent;
  else
    insert into product_sync_events (organization_id, integration_id, by_name, by_role, products)
    values (org, p_integration, n, r, greatest(coalesce(p_products, 0), 0));
  end if;
end $$;
revoke execute on function public.announce_products_synced(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.announce_products_synced(uuid, text, text, int) to service_role;

-- A new event starts the enabled "a shop syncs its products" automations that cover the shop. Later chunks of the same sync
-- only update the event, so they never notify again.
create function public.enqueue_on_product_sync_event() returns trigger
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
  where w.enabled and w.organization_id = new.organization_id
    and v.definition->'trigger'->>'type' = 'products_synced'
    and (case when v.definition->'trigger'->'integration_ids' is not null
                then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
              else true end)
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;
revoke execute on function public.enqueue_on_product_sync_event() from public, anon, authenticated;
create trigger product_sync_events_enqueue after insert on public.product_sync_events
  for each row execute function public.enqueue_on_product_sync_event();
