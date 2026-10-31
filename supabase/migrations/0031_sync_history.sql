-- Sync history: one row per sync, from either side, with what it changed.
--  * "push": the shop sent its products to WorkRelay ("Synced by the Shop"). "pull": WorkRelay asked the shop's endpoint, on its
--    schedule or from Sync now ("Synced from WorkRelay"). A rejected push or a failed pull is a row too, with the reason.
--  * apply_product_sync is not touched. run_product_sync wraps it: it opens the row, names it for the rest of the transaction, and
--    the stock changes apply_product_sync writes pick the row up (stock_events.run_id), so "what changed" is read from the history
--    that already exists and nothing is copied. A product counts as changed when it is new or its stock moved.
--  * Rows older than 30 days of the same shop are removed whenever that shop syncs; the stock history itself is kept.

create table public.product_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  source text not null check (source in ('push', 'pull')),
  trigger text not null check (trigger in ('shop', 'scheduled', 'manual')),
  by_name text,                    -- push only: who pressed the button in the shop (optional, shop-supplied)
  by_role text,
  received int not null default 0, -- products in the feed
  changed int not null default 0,  -- products that are new or whose stock moved
  status text not null check (status in ('ok', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  check ((status = 'failed') = (error is not null))
);
create index product_sync_runs_shop_idx on public.product_sync_runs (integration_id, created_at desc);
create index product_sync_runs_org_idx on public.product_sync_runs (organization_id, created_at desc);
alter table public.product_sync_runs enable row level security;
create policy sync_runs_select on public.product_sync_runs for select using (is_org_member(organization_id));
revoke all on public.product_sync_runs from anon, authenticated;
grant select on public.product_sync_runs to authenticated;

-- The stock changes a sync made. A transaction-local setting names the run, so apply_product_sync needs no change.
alter table public.stock_events
  add column run_id uuid references public.product_sync_runs (id) on delete set null
    default nullif(current_setting('workrelay.sync_run', true), '')::uuid;
create index stock_events_run_idx on public.stock_events (run_id) where run_id is not null;

-- Called by the Edge Functions (service role) in place of apply_product_sync.
create function public.run_product_sync(
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
  perform set_config('workrelay.sync_run', '', true);
  update product_sync_runs set changed = (select count(*) from stock_events where run_id = run) where id = run;
  return n;
end $$;

-- A push that was refused or a pull that failed. Never raises, so it cannot hide the original problem.
create function public.record_failed_sync_run(
  p_integration uuid, p_source text, p_trigger text, p_error text, p_by_name text default null, p_by_role text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from integrations where id = p_integration;
  if org is null then return; end if;
  insert into product_sync_runs (organization_id, integration_id, source, trigger, by_name, by_role, status, error)
  values (org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''), 'failed', coalesce(nullif(left(btrim(coalesce(p_error, '')), 500), ''), 'failed'));
exception when others then null;
end $$;

revoke execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke execute on function public.record_failed_sync_run(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) to service_role;
grant execute on function public.record_failed_sync_run(uuid, text, text, text, text, text) to service_role;

-- ------------------------------------------------------------------------------------------------ reading
-- The history, newest first unless sorted otherwise; row security decides what the caller sees.
create function public.list_sync_runs(
  p_org uuid, p_integration uuid default null, p_sort text default 'time', p_desc boolean default true,
  p_limit int default 25, p_offset int default 0
) returns table (
  id uuid, integration_id uuid, integration_name text, source text, trigger text, by_name text, by_role text,
  received int, changed int, status text, error text, created_at timestamptz, total_count bigint
)
language sql stable security invoker set search_path = public as $$
  select r.id, r.integration_id, i.name, r.source, r.trigger, r.by_name, r.by_role, r.received, r.changed, r.status, r.error,
         r.created_at, count(*) over ()
  from product_sync_runs r
  join integrations i on i.id = r.integration_id
  where r.organization_id = p_org and (p_integration is null or r.integration_id = p_integration)
  order by
    case when p_sort = 'time' and p_desc then r.created_at end desc,
    case when p_sort = 'time' and not p_desc then r.created_at end asc,
    case when p_sort = 'source' and p_desc then r.source end desc,
    case when p_sort = 'source' and not p_desc then r.source end asc,
    case when p_sort = 'shop' and p_desc then lower(i.name) end desc,
    case when p_sort = 'shop' and not p_desc then lower(i.name) end asc,
    case when p_sort = 'by' and p_desc then lower(coalesce(r.by_name, '')) end desc,
    case when p_sort = 'by' and not p_desc then lower(coalesce(r.by_name, '')) end asc,
    case when p_sort = 'products' and p_desc then r.received end desc,
    case when p_sort = 'products' and not p_desc then r.received end asc,
    case when p_sort = 'changes' and p_desc then r.changed end desc,
    case when p_sort = 'changes' and not p_desc then r.changed end asc,
    case when p_sort = 'result' and p_desc then r.status end desc,
    case when p_sort = 'result' and not p_desc then r.status end asc,
    r.created_at desc, r.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- What one sync changed: the products that are new or whose stock moved, biggest moves first.
create function public.sync_run_changes(p_run uuid, p_limit int default 100)
returns table (sku text, name text, stock_before int, stock_after int, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select p.sku, p.name, e.stock_before, e.stock_after, count(*) over ()
  from stock_events e
  join products p on p.id = e.product_id
  where e.run_id = p_run
  order by abs(e.stock_after - coalesce(e.stock_before, 0)) desc, p.sku
  limit least(greatest(p_limit, 1), 500)
$$;
