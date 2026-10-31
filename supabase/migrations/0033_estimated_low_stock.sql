-- Low-stock alerts on the estimated stock (opt-in per automation, only for shops that estimate stock).
--  * The alert on the shop's real numbers is unchanged (track_low_stock, 0015). This adds a second source of the same event,
--    marked kind = 'estimated': when the orders since the shop's last report take the estimate (0030) to or below the product's
--    alert level. It fires once per crossing, with its own flag (products.low_alerted_estimate).
--  * An automation receives estimated events only if it says so (trigger.include_estimates). Every existing automation keeps
--    getting real numbers only.
--  * A new report from the shop starts the estimate over, so it also clears the flag. A product that is already low by the shop's
--    own number does not alert a second time on its estimate. A cancellation that lifts the estimate back above the level re-arms it.
--  * The check runs when order items are added or changed and when an order's status changes. It never runs on a delete: an edited
--    order is rewritten as a delete and an insert, and re-arming in between would announce the same crossing twice.

alter table public.low_stock_events add column kind text not null default 'reported' check (kind in ('reported', 'estimated'));
alter table public.products add column low_alerted_estimate boolean not null default false;

-- Pieces ordered since a moment, for one product of one shop: the one place the estimate is calculated.
create function public.estimated_sold(p_integration uuid, p_sku text, p_since timestamptz) returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(oi.quantity), 0)::bigint
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.integration_id = p_integration and o.status <> 'cancelled'
    and nullif(btrim(oi.sku), '') = p_sku
    and coalesce(o.placed_at, o.created_at) > p_since
$$;

create or replace function public.stock_estimates(p_org uuid, p_ids uuid[] default null)
returns table (product_id uuid, estimated bigint, sold_since bigint, as_of timestamptz)
language sql stable security invoker set search_path = public as $$
  select p.id, p.stock - s.qty, s.qty, p.reported_at
  from products p
  join integrations i on i.id = p.integration_id and i.estimate_stock
  cross join lateral (select estimated_sold(p.integration_id, p.sku, p.reported_at) as qty) s
  where p.organization_id = p_org and p.stock is not null and p.reported_at is not null
    and (p_ids is null or p.id = any(p_ids))
$$;

-- A report from the shop starts the estimate over: its flag is cleared whenever the shop's numbers are written.
create or replace function public.track_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare eff int := coalesce(new.notify_on_override, new.notify_on); is_low boolean;
begin
  is_low := new.stock is not null and eff is not null and new.stock <= eff;
  if is_low and not new.low_alerted then
    update products set low_alerted = true where id = new.id;
    if tg_op = 'UPDATE' and old.stock is not null then
      insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold)
      values (new.organization_id, new.id, new.integration_id, new.stock, eff);
    end if;
  elsif not is_low and new.low_alerted then
    update products set low_alerted = false where id = new.id;
  end if;
  if new.low_alerted_estimate then
    update products set low_alerted_estimate = false where id = new.id;
  end if;
  return null;
end $$;

-- The check itself, for one product. Serialised on the product row, so two orders arriving together cannot both alert.
create function public.check_estimated_low(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p products; eff int; est bigint; sold bigint; is_low boolean;
begin
  select * into p from products where id = p_product for update;
  if not found or p.stock is null or p.reported_at is null then return; end if;
  if not exists (select 1 from integrations i where i.id = p.integration_id and i.estimate_stock) then return; end if;
  eff := coalesce(p.notify_on_override, p.notify_on);
  if eff is null then return; end if;
  sold := estimated_sold(p.integration_id, p.sku, p.reported_at);
  est := p.stock - sold;
  is_low := est <= eff;
  if is_low and not p.low_alerted_estimate then
    update products set low_alerted_estimate = true where id = p.id;
    -- already low by the shop's own number (already alerted), or nothing ordered since: not a crossing the orders caused
    if not p.low_alerted and sold > 0 then
      insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold, kind)
      values (p.organization_id, p.id, p.integration_id, est::int, eff, 'estimated');
    end if;
  elsif not is_low and p.low_alerted_estimate then
    update products set low_alerted_estimate = false where id = p.id;
  end if;
end $$;
revoke execute on function public.check_estimated_low(uuid) from public, anon, authenticated;

create function public.estimated_low_on_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  for pid in
    select p.id from orders o join products p on p.integration_id = o.integration_id and p.sku = nullif(btrim(new.sku), '')
    where o.id = new.order_id
  loop
    perform check_estimated_low(pid);
  end loop;
  return null;
end $$;
revoke execute on function public.estimated_low_on_items() from public, anon, authenticated;
create trigger order_items_estimated_low after insert or update of sku, quantity on public.order_items
  for each row execute function public.estimated_low_on_items();

create function public.estimated_low_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  for pid in
    select distinct p.id from order_items oi join products p on p.integration_id = new.integration_id and p.sku = nullif(btrim(oi.sku), '')
    where oi.order_id = new.id
  loop
    perform check_estimated_low(pid);
  end loop;
  return null;
end $$;
revoke execute on function public.estimated_low_on_status() from public, anon, authenticated;
create trigger orders_estimated_low after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function public.estimated_low_on_status();

-- The event reaches an automation only if it wants estimates when the event is one. The message says when a number is an estimate.
create or replace function public.enqueue_on_low_stock_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products; shop text; payload jsonb; queued int;
begin
  select * into p from products where id = new.product_id;
  select name into shop from integrations where id = new.integration_id;
  payload := jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'stock', new.stock, 'threshold', new.threshold,
                                  'unit', p.unit, 'category', p.category, 'shop', shop,
                                  'estimated', new.kind = 'estimated',
                                  'estimate_note', case when new.kind = 'estimated' then ' (estimated from the orders since the shop''s last report)' else '' end),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id, 'type', 'product.low_stock'));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, 'low_stock', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and v.definition->'trigger'->>'type' = 'low_stock'
    and (new.kind = 'reported' or coalesce(v.definition->'trigger'->>'include_estimates', 'false') = 'true')
    and (case when v.definition->'trigger'->'integration_ids' is not null
                then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
              else true end)
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;

-- Two automations that differ only in wanting estimates are not duplicates of each other.
create or replace function public.preset_fingerprint(p_preset text, p_cfg jsonb) returns text
language plpgsql stable set search_path = public, extensions as $$
declare ids jsonb; shops text; canon text; amount text;
begin
  if p_preset is null or p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return null; end if;
  ids := case
    when jsonb_typeof(p_cfg->'integration_ids') = 'array' and jsonb_array_length(p_cfg->'integration_ids') > 0 then p_cfg->'integration_ids'
    when nullif(p_cfg->>'integration_id', '') is not null then jsonb_build_array(p_cfg->>'integration_id')
    else null end;
  shops := case when ids is null then '*'
                else (select string_agg(distinct lower(v), ',' order by lower(v)) from jsonb_array_elements_text(ids) v) end;
  if p_preset = 'notify' then
    canon := 'notify|' || coalesce(p_cfg->>'event', '') || '|' || coalesce(p_cfg->>'channel', '') || '|'
             || regexp_replace(btrim(coalesce(p_cfg->>'url', '')), '/+$', '') || '|' || shops
             || case when p_cfg->>'event' = 'low_stock' and p_cfg->>'include_estimates' = 'true' then '|estimates' else '' end;
  elsif p_preset = 'review_large' then
    begin
      amount := trim_scale((p_cfg->>'threshold')::numeric)::text;
    exception when others then
      amount := coalesce(p_cfg->>'threshold', '');
    end;
    canon := 'review_large|' || amount || '|' || coalesce(p_cfg->>'reviewer_role', '') || '|' || shops;
  else
    return null;
  end if;
  return encode(digest(canon, 'sha256'), 'hex');
end $$;
