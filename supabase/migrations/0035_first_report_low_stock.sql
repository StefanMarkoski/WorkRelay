-- A product that is already low the first time a shop reports it now alerts, with a cap so connecting a big shop cannot flood a channel.
--  * Before: the first stock number ever reported for a product only started tracking and never alerted. Now, when a sync (a push or
--    a pull, both go through run_product_sync) reports products that are already at or below their alert level for the first time,
--    up to 3 of them alert one by one (lowest stock first) and the rest arrive as ONE summary message ("N more products are already low").
--  * The cap is 3 per shop per 90 seconds, so a catalogue sent in several chunks does not get 3 messages per chunk.
--  * The row trigger only stages the first reports (it cannot know how many there will be); run_product_sync decides when the sync ends.
--    Outside a sync (a direct write) nothing is staged, so nothing changes there.
--  * The message text is now built here ("line"), so an automation shows a single product or a summary with the same template.
--    Saved low-stock automations are upgraded to it as a new version.

alter table public.low_stock_events
  alter column product_id drop not null, alter column stock drop not null, alter column threshold drop not null,
  add column first_report boolean not null default false,
  add column count int,      -- summary only: how many products
  add column sample text;    -- summary only: a few of their names
alter table public.low_stock_events drop constraint low_stock_events_kind_check;
alter table public.low_stock_events add constraint low_stock_events_kind_check check (kind in ('reported', 'estimated', 'summary'));
alter table public.low_stock_events add constraint low_stock_events_summary_check check ((kind = 'summary') = (product_id is null));

create table public.low_stock_first_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.product_sync_runs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  stock int not null,
  threshold int not null
);
create index low_stock_first_reports_run_idx on public.low_stock_first_reports (run_id);
alter table public.low_stock_first_reports enable row level security;
revoke all on public.low_stock_first_reports from anon, authenticated; -- internal

create or replace function public.track_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare eff int := coalesce(new.notify_on_override, new.notify_on); is_low boolean;
        run uuid := nullif(current_setting('workrelay.sync_run', true), '')::uuid;
begin
  is_low := new.stock is not null and eff is not null and new.stock <= eff;
  if is_low and not new.low_alerted then
    update products set low_alerted = true where id = new.id;
    if tg_op = 'UPDATE' and old.stock is not null then
      insert into low_stock_events (organization_id, product_id, integration_id, stock, threshold)
      values (new.organization_id, new.id, new.integration_id, new.stock, eff);
    elsif run is not null then
      -- the first report of a product that is already low: staged, and settled when the sync ends
      insert into low_stock_first_reports (run_id, organization_id, integration_id, product_id, stock, threshold)
      values (run, new.organization_id, new.integration_id, new.id, new.stock, eff);
    end if;
  elsif not is_low and new.low_alerted then
    update products set low_alerted = false where id = new.id;
  end if;
  if new.low_alerted_estimate then
    update products set low_alerted_estimate = false where id = new.id;
  end if;
  return null;
end $$;

-- Settles the first reports of one sync: up to 3 alerts per shop per 90 seconds, the rest as one summary.
create function public.flush_first_reports(p_run uuid, p_integration uuid) returns void
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
  select organization_id, product_id, integration_id, stock, threshold, true
  from low_stock_first_reports where run_id = p_run order by stock, product_id limit individual;
  overflow := n - individual;
  if overflow > 0 then
    select string_agg(name, ', ' order by stock, pid) into sample
    from (select p.name, f.stock, f.product_id as pid from low_stock_first_reports f join products p on p.id = f.product_id
          where f.run_id = p_run order by f.stock, f.product_id offset individual limit 3) s;
    insert into low_stock_events (organization_id, integration_id, kind, count, sample, first_report)
    values (org, p_integration, 'summary', overflow, sample, true);
  end if;
  delete from low_stock_first_reports where run_id = p_run;
end $$;
revoke execute on function public.flush_first_reports(uuid, uuid) from public, anon, authenticated;

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
  perform flush_first_reports(run, p_integration);
  perform set_config('workrelay.sync_run', '', true);
  update product_sync_runs set changed = (select count(*) from stock_events where run_id = run) where id = run;
  return n;
end $$;

-- The event reaches the automations with its message already written: one product, or a summary.
create or replace function public.enqueue_on_low_stock_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products; shop text; payload jsonb; queued int; line text;
begin
  select * into p from products where id = new.product_id;
  select name into shop from integrations where id = new.integration_id;
  if new.kind = 'summary' then
    line := 'Low stock: ' || new.count || case when new.count = 1 then ' more product in ' else ' more products in ' end || shop
         || case when new.count = 1 then ' is already at or below its alert level' else ' are already at or below their alert levels' end
         || case when new.sample is not null then ' (' || new.sample || case when new.count > 3 then ', …' else '' end || ')' else '' end
         || '. See Inventory → Low stock.';
  else
    line := 'Low stock: ' || p.name || ' (SKU ' || p.sku || ') has ' || new.stock || ' left, at or below its alert level of ' || new.threshold || '.';
  end if;
  payload := jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'sku', p.sku, 'name', case when new.kind = 'summary' then new.count || ' products' else p.name end,
                                  'stock', new.stock, 'threshold', new.threshold, 'unit', p.unit, 'category', p.category, 'shop', shop,
                                  'kind', new.kind, 'estimated', new.kind = 'estimated', 'count', new.count, 'sample', new.sample,
                                  'source', case when new.kind = 'estimated' then 'WorkRelay (estimated for ' || shop || ')' else shop end,
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

-- Saved low-stock automations: the message becomes the prepared line, as a new version (the old one stays in the history).
create function public.upgrade_low_stock_line() returns int
language plpgsql security definer set search_path = public as $$
declare w record; txt text; newdef jsonb; vid uuid; n int := 0;
  old_msg constant text := 'Low stock: {{product.name}} (SKU {{product.sku}}) has {{product.stock}} left, at or below its alert level of {{product.threshold}}. Source: {{product.source}}';
begin
  for w in
    select wf.id as workflow_id, wf.organization_id, v.definition
    from workflows wf join workflow_versions v on v.id = wf.current_version_id
    where v.definition->'trigger'->>'type' = 'low_stock' and v.definition::text like '%' || old_msg || '%'
    for update of wf
  loop
    txt := replace(w.definition::text, old_msg, '{{product.line}} Source: {{product.source}}');
    if strpos(txt, '\"kind\":\"{{product.kind}}\"') = 0 then
      txt := replace(txt, '\"source\":\"{{product.source}}\",', '\"source\":\"{{product.source}}\",\"kind\":\"{{product.kind}}\",\"count\":\"{{product.count}}\",');
    end if;
    newdef := txt::jsonb;
    insert into workflow_versions (workflow_id, organization_id, version, definition)
    values (w.workflow_id, w.organization_id, (select max(version) + 1 from workflow_versions where workflow_id = w.workflow_id), newdef)
    returning id into vid;
    update workflows set current_version_id = vid, draft_definition = newdef, updated_at = now() where id = w.workflow_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.upgrade_low_stock_line() from public, anon, authenticated;

select public.upgrade_low_stock_line();
