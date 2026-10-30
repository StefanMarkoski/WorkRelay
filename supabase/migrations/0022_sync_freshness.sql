-- "Synced X minutes ago", per shop, however the sync happened.
--  * integration_sync already remembers WorkRelay's own scheduled/manual checks (last_sync_at). A shop that PUSHES its products
--    (the sync button in its admin) was invisible there. record_product_push remembers the last push, and who pressed the
--    button when the shop said so, so the app can show the latest of the two.
--  * Every applied push is remembered, however it was sent: the shop has no say in whether the team is told (that is the automation).
--  * The Live feed shows a push as it happens, so members can read the sync events (names, roles and counts only, nothing
--    secret) and the table is published to Realtime. integration_sync is NEVER published: it holds the Authorization value.

alter table public.integration_sync
  add column last_push_at timestamptz,
  add column last_push_by text;
grant select (last_push_at, last_push_by) on public.integration_sync to authenticated;

-- Called only by the inventory-webhook Edge Function (service role), after a push was applied.
create function public.record_product_push(p_integration uuid, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; n text := nullif(left(btrim(coalesce(p_name, '')), 120), ''); r text := nullif(left(btrim(coalesce(p_role, '')), 60), '');
begin
  select organization_id into org from integrations where id = p_integration;
  if org is null then return; end if;
  insert into integration_sync (integration_id, organization_id, last_push_at, last_push_by)
  values (p_integration, org, now(), case when n is not null and r is not null then n || ' (' || r || ')' else coalesce(n, r) end)
  on conflict (integration_id) do update set last_push_at = excluded.last_push_at, last_push_by = excluded.last_push_by;
end $$;
revoke execute on function public.record_product_push(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_product_push(uuid, text, text) to service_role;

-- Members can read their workspace's sync events (written only by announce_products_synced), and the Live feed hears about new ones.
create policy pse_select on public.product_sync_events for select using (is_org_member(organization_id));
grant select on public.product_sync_events to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_sync_events') then
    alter publication supabase_realtime add table public.product_sync_events;
  end if;
end $$;
