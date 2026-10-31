-- A returned order gives its stock back to the estimate, the same way a cancelled order does.
--  * "Returned" is the order's fulfillment status. Estimated stock = last reported stock - pieces on orders placed since, leaving out cancelled
--    orders and returned orders. (A partial return is not a status the shop can express, so it is not counted.)
--  * Marking an order returned (or undoing it) re-checks the estimated low-stock alert of every product on it, like a cancellation does:
--    stock coming back re-arms the alert, and the next crossing announces again.
--  * Only the estimate changes: WorkRelay still never edits the number the shop reported.

create or replace function public.estimated_sold(p_integration uuid, p_sku text, p_since timestamptz) returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(oi.quantity), 0)::bigint
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.organization_id = (select i.organization_id from integrations i where i.id = p_integration)
    and nullif(btrim(oi.sku), '') = p_sku
    and o.integration_id = p_integration and o.status <> 'cancelled' and o.fulfillment_status <> 'returned'
    and coalesce(o.placed_at, o.created_at) > p_since
$$;

create or replace function public.stock_estimates(p_org uuid, p_ids uuid[] default null)
returns table (product_id uuid, estimated bigint, sold_since bigint, as_of timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_ids is null then
    return query
    select p.id, p.stock - coalesce(sum(oi.quantity) filter (where o.id is not null), 0)::bigint,
           coalesce(sum(oi.quantity) filter (where o.id is not null), 0)::bigint, p.reported_at
    from products p
    join integrations i on i.id = p.integration_id and i.estimate_stock
    left join order_items oi on oi.organization_id = p.organization_id and oi.sku is not null and nullif(btrim(oi.sku), '') = p.sku
    left join orders o on o.id = oi.order_id and o.integration_id = p.integration_id and o.status <> 'cancelled' and o.fulfillment_status <> 'returned'
                      and coalesce(o.placed_at, o.created_at) > p.reported_at
    where p.organization_id = p_org and p.stock is not null and p.reported_at is not null
    group by p.id, p.stock, p.reported_at;
  else
    return query
    select p.id, p.stock - coalesce(sum(oi.quantity) filter (where o.id is not null), 0)::bigint,
           coalesce(sum(oi.quantity) filter (where o.id is not null), 0)::bigint, p.reported_at
    from products p
    join integrations i on i.id = p.integration_id and i.estimate_stock
    left join order_items oi on oi.organization_id = p.organization_id and oi.sku is not null and nullif(btrim(oi.sku), '') = p.sku
    left join orders o on o.id = oi.order_id and o.integration_id = p.integration_id and o.status <> 'cancelled' and o.fulfillment_status <> 'returned'
                      and coalesce(o.placed_at, o.created_at) > p.reported_at
    where p.id = any(p_ids) and p.organization_id = p_org and p.stock is not null and p.reported_at is not null
    group by p.id, p.stock, p.reported_at;
  end if;
end $$;

create or replace function public.check_estimated_lows(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare r record; eff int; est bigint; is_low boolean; crossings jsonb := '[]'::jsonb;
        g record; budget int; individual int; overflow int; sample text;
begin
  -- lock the rows first, in id order (two transactions cannot deadlock on each other), then read everything in one query
  perform 1 from products where id = any(p_ids) order by id for update;
  for r in
    select p.id, p.organization_id, p.integration_id, p.name, p.stock, p.low_alerted, p.low_alerted_estimate,
           coalesce(p.notify_on_override, p.notify_on) as eff,
           coalesce(sum(oi.quantity) filter (where o.id is not null), 0)::bigint as sold
    from products p
    join integrations i on i.id = p.integration_id and i.estimate_stock
    left join order_items oi on oi.organization_id = p.organization_id and oi.sku is not null and nullif(btrim(oi.sku), '') = p.sku
    left join orders o on o.id = oi.order_id and o.integration_id = p.integration_id and o.status <> 'cancelled' and o.fulfillment_status <> 'returned'
                      and coalesce(o.placed_at, o.created_at) > p.reported_at
    where p.id = any(p_ids) and p.stock is not null and p.reported_at is not null and coalesce(p.notify_on_override, p.notify_on) is not null
    group by p.id, p.organization_id, p.integration_id, p.name, p.stock, p.low_alerted, p.low_alerted_estimate, p.notify_on_override, p.notify_on
    order by p.id
  loop
    est := r.stock - r.sold;
    is_low := est <= r.eff;
    if is_low and not r.low_alerted_estimate then
      update products set low_alerted_estimate = true where id = r.id;
      -- already low by the shop's own number (already alerted), or nothing ordered since: not a crossing the orders caused
      if not r.low_alerted and r.sold > 0 then
        crossings := crossings || jsonb_build_object('product_id', r.id, 'integration_id', r.integration_id, 'org', r.organization_id,
                                                      'name', r.name, 'est', est, 'eff', r.eff);
      end if;
    elsif not is_low and r.low_alerted_estimate then
      update products set low_alerted_estimate = false where id = r.id;
    end if;
  end loop;

  -- up to 3 single alerts per shop per 90 seconds, lowest estimate first; the rest of this batch is one summary
  for g in select (c->>'integration_id')::uuid as integration_id, (c->>'org')::uuid as org, count(*)::int as n
           from jsonb_array_elements(crossings) c group by 1, 2 loop
    budget := greatest(0, 3 - (select count(*) from low_stock_events
                                where integration_id = g.integration_id and kind = 'estimated' and occurred_at > now() - interval '90 seconds'));
    individual := least(g.n, budget);
    insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold, kind)
    select (c->>'org')::uuid, (c->>'product_id')::uuid, g.integration_id, (c->>'est')::int, (c->>'eff')::int, 'estimated'
    from jsonb_array_elements(crossings) c where (c->>'integration_id')::uuid = g.integration_id
    order by (c->>'est')::bigint, c->>'name', c->>'product_id' limit individual;
    overflow := g.n - individual;
    if overflow > 0 then
      select string_agg(s.name, ', ' order by s.est, s.name, s.pid) into sample from (
        select c->>'name' as name, (c->>'est')::bigint as est, c->>'product_id' as pid from jsonb_array_elements(crossings) c
        where (c->>'integration_id')::uuid = g.integration_id order by 2, 1, 3 offset individual limit 3) s;
      insert into low_stock_events (organization_id, integration_id, kind, count, sample)
      values (g.org, g.integration_id, 'estimated_summary', overflow, sample);
    end if;
  end loop;
end $$;

drop trigger if exists orders_queue_estimate on public.orders;
create trigger orders_queue_estimate after update of status, fulfillment_status on public.orders
  for each row when (old.status is distinct from new.status or old.fulfillment_status is distinct from new.fulfillment_status)
  execute function public.queue_estimate_checks_from_status();
