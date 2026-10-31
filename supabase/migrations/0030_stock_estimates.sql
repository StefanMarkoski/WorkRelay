-- Estimated stock between syncs, per shop (opt-in, off by default).
--  * The shop stays the authority. WorkRelay's estimate is only "the shop's last reported stock, minus the pieces ordered since",
--    shown next to the real number and labelled as an estimate. Any new report from the shop (a push, or a pull WorkRelay asks
--    for) moves the starting point forward, so it takes priority by construction.
--  * The estimate is calculated whenever it is read, never stored and changed in place. A repeated event, an edited order or a
--    cancellation therefore cannot drift it: the orders are simply counted again.
--  * An order counts only if it was placed after the shop's report (coalesce(placed_at, created_at) > reported_at). A report taken
--    after the order already includes it, and a late retry of an old order must not be subtracted a second time.
--  * Cancelled orders do not count. Nothing is written to products and no alert is raised from the estimate.

alter table public.integrations add column estimate_stock boolean not null default false;
grant select (estimate_stock) on public.integrations to authenticated; -- written only through the function below

create function public.set_integration_estimate_stock(p_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_id for update;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  update integrations set estimate_stock = p_enabled, updated_at = now() where id = p_id;
end $$;
revoke execute on function public.set_integration_estimate_stock(uuid, boolean) from public, anon;
grant execute on function public.set_integration_estimate_stock(uuid, boolean) to authenticated;

-- One row per product of a shop that has estimating on, whose stock the shop has reported. p_ids limits it to some products.
create function public.stock_estimates(p_org uuid, p_ids uuid[] default null)
returns table (product_id uuid, estimated bigint, sold_since bigint, as_of timestamptz)
language sql stable security invoker set search_path = public as $$
  select p.id, p.stock - coalesce(s.qty, 0), coalesce(s.qty, 0), p.reported_at
  from products p
  join integrations i on i.id = p.integration_id and i.estimate_stock
  left join lateral (
    select sum(oi.quantity)::bigint as qty
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.integration_id = p.integration_id and o.status <> 'cancelled'
      and nullif(btrim(oi.sku), '') = p.sku
      and coalesce(o.placed_at, o.created_at) > p.reported_at
  ) s on true
  where p.organization_id = p_org and p.stock is not null and p.reported_at is not null
    and (p_ids is null or p.id = any(p_ids))
$$;
