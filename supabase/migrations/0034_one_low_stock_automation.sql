-- One low-stock automation for both kinds of alert (replaces the per-automation "include estimates" switch of 0033).
--  * Whether a shop's estimate can alert is the shop's own setting (Estimate stock between syncs). Every low-stock automation that
--    covers the shop receives its real-number alerts and, if the shop estimates, its estimated alerts. Nothing to switch on twice.
--  * The message ends with "Source:". A real number says the shop's name; an estimate says "WorkRelay (estimated for <shop>)".
--  * Automations already saved get the new message as a new version (the old version stays in the history), so nobody has to re-save.

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
                                  'source', case when new.kind = 'estimated' then 'WorkRelay (estimated for ' || shop || ')' else shop end,
                                  'estimate_note', ''),
    'event', jsonb_build_object('id', new.id, 'integration_id', new.integration_id, 'type', 'product.low_stock'));

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

-- The fingerprint is 0023's again: wanting estimates no longer makes an automation different.
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
             || regexp_replace(btrim(coalesce(p_cfg->>'url', '')), '/+$', '') || '|' || shops;
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

-- Gives every saved low-stock automation the new message, as a new version. Safe to run twice: an automation that already has it is skipped.
create function public.upgrade_low_stock_messages() returns int
language plpgsql security definer set search_path = public as $$
declare w record; txt text; newdef jsonb; vid uuid; n int := 0;
begin
  for w in
    select wf.id as workflow_id, wf.organization_id, v.definition, v.version
    from workflows wf join workflow_versions v on v.id = wf.current_version_id
    where v.definition->'trigger'->>'type' = 'low_stock'
      and v.definition::text like '%{{product.shop}}%' and v.definition::text not like '%{{product.source}}%'
    for update of wf
  loop
    txt := w.definition::text;
    txt := replace(txt, 'Shop: {{product.shop}}', 'Source: {{product.source}}');
    txt := replace(txt, '{{product.estimate_note}}', '');
    -- a generic webhook gets the source as its own field as well (the body is JSON inside a string, so its quotes are escaped)
    txt := replace(txt, '\"shop\":\"{{product.shop}}\",', '\"shop\":\"{{product.shop}}\",\"source\":\"{{product.source}}\",');
    newdef := txt::jsonb #- '{trigger,include_estimates}';
    insert into workflow_versions (workflow_id, organization_id, version, definition)
    values (w.workflow_id, w.organization_id, (select max(version) + 1 from workflow_versions where workflow_id = w.workflow_id), newdef)
    returning id into vid;
    update workflows set current_version_id = vid, draft_definition = newdef, updated_at = now() where id = w.workflow_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.upgrade_low_stock_messages() from public, anon, authenticated;

select public.upgrade_low_stock_messages();
