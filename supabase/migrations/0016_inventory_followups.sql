-- Inventory follow-ups (0015 is already live, so these are separate changes):
--  * product_siblings: the same SKU in the workspace's other shops, so the stock across stores can be read side by side.
--  * Inventory feeds show up in Event history: each scheduled pull is recorded as an "inventory.pull" event (summary only,
--    never the catalogue). Pushes are recorded by the Edge Function in the same way ("inventory.push").
--  * Those events are pruned after 30 days, so a busy feed cannot grow the table without bound.

-- ------------------------------------------------------------------------------------------------ same SKU elsewhere
-- Matched by exact SKU within the workspace. Runs as the caller, so row security decides what is seen.
create function public.product_siblings(p_product uuid)
returns table (id uuid, integration_id uuid, integration_name text, stock int, unit text, reported_at timestamptz, low boolean)
language sql stable security invoker set search_path = public as $$
  select s.id, s.integration_id, i.name, s.stock, s.unit, s.reported_at,
         (s.stock is not null and coalesce(s.notify_on_override, s.notify_on) is not null
          and s.stock <= coalesce(s.notify_on_override, s.notify_on))
  from products p
  join products s on s.organization_id = p.organization_id and s.sku = p.sku and s.id <> p.id
  join integrations i on i.id = s.integration_id
  where p.id = p_product
  order by i.name, s.id
$$;
revoke execute on function public.product_siblings(uuid) from public, anon;
grant execute on function public.product_siblings(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------ pulls in Event history
-- Same as 0015 plus a count, and it records the pull as an event. The old two-argument form is replaced.
drop function public.record_product_sync(uuid, text);
create function public.record_product_sync(p_integration uuid, p_error text, p_count int default null) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  update integration_sync set
    last_error = left(p_error, 500),
    last_sync_at = case when p_error is null then now() else last_sync_at end,
    updated_at = now()
  where integration_id = p_integration
  returning organization_id into org;
  if org is not null then
    insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, error, processed_at)
    values (org, p_integration, 'inventory:pull:' || gen_random_uuid(), 'inventory.pull',
            (case when p_error is null then 'processed' else 'failed' end)::webhook_event_status,
            jsonb_build_object('products', p_count), left(p_error, 500), now());
  end if;
end $$;
revoke execute on function public.record_product_sync(uuid, text, int) from public, anon, authenticated;
grant execute on function public.record_product_sync(uuid, text, int) to service_role;

-- ------------------------------------------------------------------------------------------------ retention
-- On about one insert in fifty, the shop's inventory events older than 30 days are removed. Other events are never touched.
create function public.prune_inventory_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.02 then
    delete from webhook_events
    where integration_id = new.integration_id and event_type like 'inventory.%' and received_at < now() - interval '30 days';
  end if;
  return null;
end $$;
revoke execute on function public.prune_inventory_events() from public, anon, authenticated;
create trigger webhook_events_prune_inventory after insert on public.webhook_events
  for each row when (new.event_type like 'inventory.%') execute function public.prune_inventory_events();
