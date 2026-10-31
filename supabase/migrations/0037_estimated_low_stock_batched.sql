-- Estimated low-stock alerts, checked once per order at the end of the transaction instead of once per order line (0033 did it per line).
-- Found by the hardening pass (live, against production-like data):
--  * An order whose 1000 lines all crossed their alert level created 1000 alert events, with no cap. Real alerts from a shop's report
--    are capped at 3 (+ one summary); estimated ones now are as well: 3 single alerts per shop per 90 seconds, the rest as one summary
--    ("estimated_summary"). Every crossing is still marked, so none alerts a second time.
--  * An order edited from product A to product B left A's "already alerted" flag on although A was no longer low, so A's next real
--    crossing was silently missed. The end-of-transaction check also looks at the products an order lost (a delete queues them too),
--    and by then the edit is complete, so an edited order is never announced twice either.
--  * Each lookup of "pieces sold since" took about 7 ms with 10 000 order lines (no fitting index); 1000 lines meant seconds. It has one now.
--  * The row triggers only queue the products (a cheap insert, and only for shops that estimate); a deferred constraint trigger does the
--    work once, when the transaction commits.

create index if not exists order_items_sku_norm_idx on public.order_items (organization_id, (nullif(btrim(sku), ''))) where sku is not null;

create or replace function public.estimated_sold(p_integration uuid, p_sku text, p_since timestamptz) returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(oi.quantity), 0)::bigint
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.organization_id = (select i.organization_id from integrations i where i.id = p_integration)
    and nullif(btrim(oi.sku), '') = p_sku
    and o.integration_id = p_integration and o.status <> 'cancelled'
    and coalesce(o.placed_at, o.created_at) > p_since
$$;

alter table public.low_stock_events drop constraint low_stock_events_kind_check;
alter table public.low_stock_events add constraint low_stock_events_kind_check check (kind in ('reported', 'estimated', 'summary', 'estimated_summary'));
alter table public.low_stock_events drop constraint low_stock_events_summary_check;
alter table public.low_stock_events add constraint low_stock_events_summary_check check ((kind in ('summary', 'estimated_summary')) = (product_id is null));

-- The products to look at when the transaction ends. A row exists only inside its own transaction.
create table public.estimate_checks (
  txid bigint not null default txid_current(),
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (txid, product_id)
);
alter table public.estimate_checks enable row level security;
revoke all on public.estimate_checks from anon, authenticated; -- internal

drop trigger if exists order_items_estimated_low on public.order_items;
drop trigger if exists orders_estimated_low on public.orders;
drop function if exists public.estimated_low_on_items();
drop function if exists public.estimated_low_on_status();
drop function if exists public.check_estimated_low(uuid);

-- Queue the products of an order line (the new SKU, and the old one when it changed or the line was deleted), only for shops that estimate.
create function public.queue_estimate_checks_from_items() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into estimate_checks (product_id)
  select distinct p.id
  from orders o
  join integrations i on i.id = o.integration_id and i.estimate_stock
  join products p on p.integration_id = o.integration_id
  where o.id = coalesce(new.order_id, old.order_id)
    and p.sku in (select nullif(btrim(s), '') from unnest(array[
          case when tg_op <> 'DELETE' then new.sku end,
          case when tg_op <> 'INSERT' then old.sku end]) s where s is not null)
  on conflict do nothing;
  return null;
end $$;
revoke execute on function public.queue_estimate_checks_from_items() from public, anon, authenticated;
create trigger order_items_queue_estimate after insert or update of sku, quantity or delete on public.order_items
  for each row execute function public.queue_estimate_checks_from_items();

-- A cancellation (or a cancellation undone) changes every product on the order.
create function public.queue_estimate_checks_from_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into estimate_checks (product_id)
  select distinct p.id
  from integrations i
  join order_items oi on oi.order_id = new.id
  join products p on p.integration_id = new.integration_id and p.sku = nullif(btrim(oi.sku), '')
  where i.id = new.integration_id and i.estimate_stock
  on conflict do nothing;
  return null;
end $$;
revoke execute on function public.queue_estimate_checks_from_status() from public, anon, authenticated;
create trigger orders_queue_estimate after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function public.queue_estimate_checks_from_status();

-- The check, for a batch of products. The rows are locked in id order, so two transactions cannot deadlock on each other.
create function public.check_estimated_lows(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare p products; eff int; sold bigint; est bigint; is_low boolean; crossings jsonb := '[]'::jsonb;
        g record; budget int; individual int; overflow int; sample text; org uuid;
begin
  for p in select pr.* from products pr where pr.id = any(p_ids) order by pr.id for update loop
    if p.stock is null or p.reported_at is null then continue; end if;
    if not exists (select 1 from integrations i where i.id = p.integration_id and i.estimate_stock) then continue; end if;
    eff := coalesce(p.notify_on_override, p.notify_on);
    if eff is null then continue; end if;
    sold := estimated_sold(p.integration_id, p.sku, p.reported_at);
    est := p.stock - sold;
    is_low := est <= eff;
    if is_low and not p.low_alerted_estimate then
      update products set low_alerted_estimate = true where id = p.id;
      -- already low by the shop's own number (already alerted), or nothing ordered since: not a crossing the orders caused
      if not p.low_alerted and sold > 0 then
        crossings := crossings || jsonb_build_object('product_id', p.id, 'integration_id', p.integration_id, 'org', p.organization_id, 'name', p.name, 'est', est, 'eff', eff);
      end if;
    elsif not is_low and p.low_alerted_estimate then
      update products set low_alerted_estimate = false where id = p.id;
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
revoke execute on function public.check_estimated_lows(uuid[]) from public, anon, authenticated;

-- Runs at COMMIT (deferred), once per transaction: the first queued row takes the whole batch, the others find nothing.
-- A failure here must never fail the order that was just saved, so it is reported and swallowed.
create function public.process_estimate_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  with taken as (delete from estimate_checks where txid = txid_current() returning product_id)
  select array_agg(product_id) into ids from taken;
  if ids is not null then
    begin
      perform check_estimated_lows(ids);
    exception when others then
      raise warning 'estimated low-stock check failed: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke execute on function public.process_estimate_checks() from public, anon, authenticated;
create constraint trigger estimate_checks_process after insert on public.estimate_checks
  deferrable initially deferred for each row execute function public.process_estimate_checks();

-- The event reaches the automations with its message written; an estimated summary names WorkRelay as its source like a single estimate.
create or replace function public.enqueue_on_low_stock_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products; shop text; payload jsonb; queued int; line text; est boolean := new.kind in ('estimated', 'estimated_summary');
begin
  select * into p from products where id = new.product_id;
  select name into shop from integrations where id = new.integration_id;
  if new.kind in ('summary', 'estimated_summary') then
    line := 'Low stock: ' || new.count || case when new.count = 1 then ' more product in ' else ' more products in ' end || shop
         || case when new.kind = 'estimated_summary'
                 then case when new.count = 1 then ' is now estimated to be at or below its alert level' else ' are now estimated to be at or below their alert levels' end
                 else case when new.count = 1 then ' is already at or below its alert level' else ' are already at or below their alert levels' end end
         || case when new.sample is not null then ' (' || new.sample || case when new.count > 3 then ', …' else '' end || ')' else '' end
         || '. See Inventory → Low stock.';
  else
    line := 'Low stock: ' || p.name || ' (SKU ' || p.sku || ') has ' || new.stock || ' left, at or below its alert level of ' || new.threshold || '.';
  end if;
  payload := jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'sku', p.sku, 'name', case when new.kind in ('summary', 'estimated_summary') then new.count || ' products' else p.name end,
                                  'stock', new.stock, 'threshold', new.threshold, 'unit', p.unit, 'category', p.category, 'shop', shop,
                                  'kind', new.kind, 'estimated', est, 'count', new.count, 'sample', new.sample,
                                  'source', case when est then 'WorkRelay (estimated for ' || shop || ')' else shop end,
                                  'estimate_note', '', 'line', line),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id, 'type', 'product.low_stock', 'kind', new.kind));

  insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, event_id, context)
  select w.organization_id, w.id, v.id, 'low_stock', new.id::text, payload
  from workflows w join workflow_versions v on v.id = w.current_version_id
  where w.enabled and w.organization_id = new.organization_id
    and v.definition->'trigger'->>'type' = 'low_stock'
    and (case when v.definition->'trigger'->'integration_ids' is not null
                then v.definition->'trigger'->'integration_ids' ? new.integration_id::text
              else true end)
  on conflict (workflow_id, event_id) where event_id is not null do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then perform kick_engine(); end if;
  return new;
end $$;

-- The first-report alerts break ties by product name too (0035 broke them by an arbitrary id), so the same sync always reads the same.
create or replace function public.flush_first_reports(p_run uuid, p_integration uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; budget int; org uuid; individual int; overflow int; sample text;
begin
  select count(*) into n from low_stock_first_reports where run_id = p_run;
  if n = 0 then return; end if;
  select organization_id into org from integrations where id = p_integration;
  budget := greatest(0, 3 - (select count(*) from low_stock_events
                              where integration_id = p_integration and first_report and kind <> 'summary' and occurred_at > now() - interval '90 seconds'));
  individual := least(n, budget);
  insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold, first_report)
  select f.organization_id, f.product_id, f.integration_id, f.stock, f.threshold, true
  from low_stock_first_reports f join products p on p.id = f.product_id
  where f.run_id = p_run order by f.stock, p.name, f.product_id limit individual;
  overflow := n - individual;
  if overflow > 0 then
    select string_agg(s.name, ', ' order by s.stock, s.name, s.pid) into sample
    from (select p.name, f.stock, f.product_id as pid from low_stock_first_reports f join products p on p.id = f.product_id
          where f.run_id = p_run order by f.stock, p.name, f.product_id offset individual limit 3) s;
    insert into low_stock_events (organization_id, integration_id, kind, count, sample, first_report)
    values (org, p_integration, 'summary', overflow, sample, true);
  end if;
  delete from low_stock_first_reports where run_id = p_run;
end $$;
