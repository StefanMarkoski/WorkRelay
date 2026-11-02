-- The Inventory list worked out the price and "sold in 30 days" for every product of the workspace (a lookup into the order lines
-- each), then kept 25. With 14,000 products that took 200 ms and grew with every product added. Now the page is chosen first, from the
-- cheap columns (the order is low-stock first, then name), and only the rows on the page get the two lookups. Same columns, same answers.
create or replace function public.list_products(
  p_org uuid, p_search text default null, p_integration uuid default null, p_low_only boolean default false,
  p_limit int default 25, p_offset int default 0, p_id uuid default null
) returns table (
  id uuid, integration_id uuid, integration_name text, sku text, name text, stock int, notify_on int,
  notify_on_override int, effective_notify_on int, price_minor bigint, currency char(3), price_source text,
  unit text, category text, barcode text, reported_at timestamptz, sold_30d bigint, low boolean, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with p as (
    select pr.*, i.name as shop_name, coalesce(pr.notify_on_override, pr.notify_on) as eff
    from products pr
    join integrations i on i.id = pr.integration_id
    where pr.organization_id = p_org
      and (p_id is null or pr.id = p_id)
      and (p_integration is null or pr.integration_id = p_integration)
      and (coalesce(p_search, '') = '' or
           pr.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' or
           pr.sku ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  ), q as (
    select p.*, (p.stock is not null and p.eff is not null and p.stock <= p.eff) as is_low from p
  ), paged as (
    select q.*, count(*) over () as total
    from q
    where not p_low_only or q.is_low
    order by q.is_low desc, q.name, q.id
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select g.id, g.integration_id, g.shop_name, g.sku, g.name, g.stock, g.notify_on, g.notify_on_override, g.eff,
         coalesce(g.price_minor, lp.unit_price_minor), coalesce(g.currency, lp.currency),
         case when g.price_minor is not null then 'api' when lp.unit_price_minor is not null then 'orders' end,
         g.unit, g.category, g.barcode, g.reported_at, coalesce(sold.qty, 0)::bigint, g.is_low, g.total
  from paged g
  left join lateral (
    select oi.unit_price_minor, o.currency
    from order_items oi join orders o on o.id = oi.order_id
    where oi.organization_id = g.organization_id and oi.sku = g.sku and o.integration_id = g.integration_id
      and oi.unit_price_minor is not null and o.currency is not null
    order by coalesce(o.placed_at, o.created_at) desc, oi.position desc limit 1
  ) lp on g.price_minor is null
  left join lateral (
    select sum(oi.quantity) as qty
    from order_items oi join orders o on o.id = oi.order_id
    where oi.organization_id = g.organization_id and oi.sku = g.sku and o.integration_id = g.integration_id
      and o.status <> 'cancelled' and coalesce(o.placed_at, o.created_at) >= now() - interval '30 days'
  ) sold on true
  order by g.is_low desc, g.name, g.id
$$;
