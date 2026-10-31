-- The price of the latest sync wins, and the price changes show in Sync history.
--  * A price a sync carries is always taken, whoever sent it and however the feed dates the item: a push typed by hand, a scheduled pull and
--    Sync now are all the same. (Before, a price was ignored when the item's own updated_at was older than the last report, like stock still is.)
--    A sync that carries no price leaves the price alone. Stock, name and the rest keep the "newer report wins" rule.
--  * apply_product_sync is 0026's with those two lines changed. Every price that actually changes (or first appears) is written to
--    price_events by a trigger on products, named for the sync run exactly like the stock changes are, so nothing else has to know about it.
--  * sync_run_changes lists a product when it is new, its stock moved or its price changed, and shows both; "changed" counts the same.

create table public.price_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  price_before bigint,
  currency_before char(3),
  price_after bigint not null,
  currency_after char(3) not null,
  occurred_at timestamptz not null default now(),
  run_id uuid references public.product_sync_runs (id) on delete set null
    default nullif(current_setting('workrelay.sync_run', true), '')::uuid
);
create index price_events_product_idx on public.price_events (product_id, occurred_at desc);
create index price_events_run_idx on public.price_events (run_id) where run_id is not null;
alter table public.price_events enable row level security;
create policy price_events_select on public.price_events for select using (is_org_member(organization_id));
revoke all on public.price_events from anon, authenticated;
grant select on public.price_events to authenticated;

create function public.log_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into price_events (organization_id, product_id, price_before, currency_before, price_after, currency_after)
  values (new.organization_id, new.id,
          case when tg_op = 'UPDATE' then old.price_minor end, case when tg_op = 'UPDATE' then old.currency end,
          new.price_minor, new.currency);
  return null;
end $$;
revoke execute on function public.log_price_change() from public, anon, authenticated;
create trigger products_price_insert after insert on public.products
  for each row when (new.price_minor is not null) execute function public.log_price_change();
create trigger products_price_update after update of price_minor, currency on public.products
  for each row when (new.price_minor is not null and (new.price_minor is distinct from old.price_minor or new.currency is distinct from old.currency))
  execute function public.log_price_change();

create or replace function public.apply_product_sync(p_integration uuid, p_items jsonb, p_source text, p_at timestamptz default now())
returns int
language plpgsql security definer set search_path = public as $$
declare
  i integrations; it jsonb; cur products; n int := 0;
  k text; nm text; at timestamptz; newer boolean;
  stock_in int; notify_in int; price_in bigint; cur_in text; new_stock int;
begin
  if p_source not in ('push', 'pull') then raise exception 'invalid source'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array'; end if;
  select * into i from integrations where id = p_integration;
  if not found or i.status <> 'connected' then raise exception 'shop is not connected'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    k := nullif(btrim(it->>'sku'), '');
    if k is null then raise exception 'every item needs a sku'; end if;
    nm := left(nullif(btrim(it->>'name'), ''), 300);
    stock_in := (it->>'stock')::int;
    notify_in := (it->>'notify_on')::int;
    price_in := (it->>'price_minor')::bigint;
    cur_in := upper(nullif(btrim(it->>'currency'), ''));
    if price_in is not null and cur_in is null then raise exception 'price_minor needs a currency'; end if;
    if price_in is null then cur_in := null; end if;
    at := least(coalesce((it->>'updated_at')::timestamptz, p_at), now());

    -- Insert first and let a concurrent report for the same new SKU lose quietly (it then takes the update path below),
    -- so a push and a pull racing on a brand-new product can never fail on the unique key.
    insert into products (organization_id, integration_id, sku, name, stock, notify_on, price_minor, currency, unit,
                          category, barcode, reported_at)
    values (i.organization_id, p_integration, left(k, 200), coalesce(nm, left(k, 300)), stock_in, notify_in, price_in,
            cur_in, nullif(btrim(it->>'unit'), ''), nullif(btrim(it->>'category'), ''),
            nullif(btrim(it->>'barcode'), ''), at)
    on conflict (integration_id, sku) do nothing
    returning * into cur;
    if found then
      if stock_in is not null then
        insert into stock_events (organization_id, product_id, stock_before, stock_after, source, occurred_at)
        values (i.organization_id, cur.id, null, stock_in, p_source, at);
      end if;
    else
      select * into cur from products where integration_id = p_integration and sku = left(k, 200) for update;
      newer := cur.reported_at is null or at >= cur.reported_at;
      new_stock := case when newer and stock_in is not null then stock_in else coalesce(cur.stock, stock_in) end;
      update products set
        name = case when newer and nm is not null then nm else name end,
        stock = new_stock,
        notify_on = case when newer and notify_in is not null then notify_in else coalesce(notify_on, notify_in) end,
        price_minor = coalesce(price_in, price_minor),
        currency = case when price_in is not null then cur_in else currency end,
        unit = case when newer and nullif(btrim(it->>'unit'), '') is not null then btrim(it->>'unit') else coalesce(unit, nullif(btrim(it->>'unit'), '')) end,
        category = case when newer and nullif(btrim(it->>'category'), '') is not null then btrim(it->>'category') else coalesce(category, nullif(btrim(it->>'category'), '')) end,
        barcode = case when newer and nullif(btrim(it->>'barcode'), '') is not null then btrim(it->>'barcode') else coalesce(barcode, nullif(btrim(it->>'barcode'), '')) end,
        reported_at = greatest(reported_at, at),
        updated_at = now()
      where id = cur.id;
      if new_stock is distinct from cur.stock and new_stock is not null then
        insert into stock_events (organization_id, product_id, stock_before, stock_after, source, occurred_at)
        values (cur.organization_id, cur.id, cur.stock, new_stock, p_source, at);
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_product_sync(uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_product_sync(uuid, jsonb, text, timestamptz) to service_role;

create or replace function public.run_product_sync(
  p_integration uuid, p_items jsonb, p_source text, p_at timestamptz, p_trigger text, p_by_name text default null, p_by_role text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid; run uuid := gen_random_uuid(); n int;
begin
  select organization_id into org from integrations where id = p_integration;
  if org is null then raise exception 'shop is not connected'; end if;
  delete from product_sync_runs where integration_id = p_integration and created_at < now() - interval '30 days';
  insert into product_sync_runs (id, organization_id, integration_id, source, trigger, by_name, by_role, received, status)
  values (run, org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''),
          case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end, 'ok');
  perform set_config('workrelay.sync_run', run::text, true);
  n := apply_product_sync(p_integration, p_items, p_source, p_at);
  perform flush_first_reports(run, p_integration); -- 0035
  perform set_config('workrelay.sync_run', '', true);
  update product_sync_runs set changed = (
    select count(*) from (select product_id from stock_events where run_id = run union select product_id from price_events where run_id = run) c
  ) where id = run;
  return n;
end $$;

drop function public.sync_run_changes(uuid, int);
create function public.sync_run_changes(p_run uuid, p_limit int default 100)
returns table (sku text, name text, stock_before int, stock_after int, price_before bigint, price_after bigint,
               currency_before char(3), currency_after char(3), total_count bigint)
language sql stable security invoker set search_path = public as $$
  select p.sku, p.name, se.stock_before, se.stock_after, pe.price_before, pe.price_after, pe.currency_before, pe.currency_after, count(*) over ()
  from (select product_id from stock_events where run_id = p_run union select product_id from price_events where run_id = p_run) c
  join products p on p.id = c.product_id
  left join lateral (select e.stock_before, e.stock_after from stock_events e where e.run_id = p_run and e.product_id = c.product_id
                     order by e.occurred_at desc limit 1) se on true
  left join lateral (select e.price_before, e.price_after, e.currency_before, e.currency_after from price_events e
                     where e.run_id = p_run and e.product_id = c.product_id order by e.occurred_at desc limit 1) pe on true
  order by abs(coalesce(se.stock_after, 0) - coalesce(se.stock_before, 0)) desc, p.sku
  limit least(greatest(p_limit, 1), 500)
$$;
revoke execute on function public.sync_run_changes(uuid, int) from public, anon;
grant execute on function public.sync_run_changes(uuid, int) to authenticated;
