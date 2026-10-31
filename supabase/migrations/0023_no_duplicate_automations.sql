-- The exact same automation cannot exist twice in a workspace. Two identical ones both fire, so one Discord message arrives twice.
--  * "The same" means the same kind of automation with the same settings: for a notification, the event, the channel, the
--    destination URL and the shops it covers; for a large-order review, the amount, who decides and the shops. The name does not
--    matter, nor does whether it is switched on: a switched-off twin still counts, and can be switched on later to fire twice.
--  * It is checked in the database on create AND on edit, so it holds for every way of saving and for two saves at once.
--  * The fingerprint is a hash, never the URL itself: a Discord webhook acts like a password and must not be copied anywhere new.
--  * Automations that merely overlap (all shops and one shop, into the same channel) are different automations and stay allowed.
--  * Duplicates that already exist are left alone (nothing is deleted or changed), and share a key so the app can point them out.

alter table public.workflows add column preset_key text;
create index workflows_preset_key_idx on public.workflows (organization_id, preset_key) where preset_key is not null;

create function public.preset_fingerprint(p_preset text, p_cfg jsonb) returns text
language plpgsql stable set search_path = public, extensions as $$
declare ids jsonb; shops text; canon text; amount text;
begin
  if p_preset is null or p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return null; end if;
  -- which shops: the list if there is one, else the older single id, else all shops; order and case do not matter
  ids := case
    when jsonb_typeof(p_cfg->'integration_ids') = 'array' and jsonb_array_length(p_cfg->'integration_ids') > 0 then p_cfg->'integration_ids'
    when nullif(p_cfg->>'integration_id', '') is not null then jsonb_build_array(p_cfg->>'integration_id')
    else null end;
  shops := case when ids is null then '*'
                else (select string_agg(distinct lower(v), ',' order by lower(v)) from jsonb_array_elements_text(ids) v) end;
  if p_preset = 'notify' then
    -- trailing slashes and surrounding spaces make no difference to where a message goes; nothing else is touched (tokens are case-sensitive)
    canon := 'notify|' || coalesce(p_cfg->>'event', '') || '|' || coalesce(p_cfg->>'channel', '') || '|'
             || regexp_replace(btrim(coalesce(p_cfg->>'url', '')), '/+$', '') || '|' || shops;
  elsif p_preset = 'review_large' then
    begin
      amount := trim_scale((p_cfg->>'threshold')::numeric)::text; -- 100, 100.0 and "100.00" are the same amount
    exception when others then
      amount := coalesce(p_cfg->>'threshold', '');
    end;
    canon := 'review_large|' || amount || '|' || coalesce(p_cfg->>'reviewer_role', '') || '|' || shops;
  else
    return null;
  end if;
  return encode(digest(canon, 'sha256'), 'hex');
end $$;

create function public.workflows_preset_key() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare other record;
begin
  new.preset_key := preset_fingerprint(new.preset, new.preset_config);
  if new.preset_key is null then return new; end if; -- a custom workflow has no fingerprint
  perform pg_advisory_xact_lock(hashtext(new.organization_id::text || new.preset_key)); -- two saves at once: the second one waits and then sees the first
  select id, name, enabled into other from workflows
  where organization_id = new.organization_id and preset_key = new.preset_key and id <> new.id
  order by created_at limit 1;
  if found then
    raise exception 'This exact automation already exists: "%" (%). Edit that one instead.', left(other.name, 80),
      case when other.enabled then 'it is turned on' else 'it is turned off' end using errcode = '23505';
  end if;
  return new;
end $$;
revoke execute on function public.preset_fingerprint(text, jsonb), public.workflows_preset_key() from public, anon, authenticated;

-- Only when the settings are written: switching an automation on or off never re-checks it, so an old duplicate can still be switched off.
create trigger workflows_preset_key_check before insert or update of preset, preset_config on public.workflows
  for each row execute function public.workflows_preset_key();

-- Existing automations get their key. This does not fire the trigger (it only listens to preset and preset_config), so existing duplicates are kept as they are.
update public.workflows set preset_key = public.preset_fingerprint(preset, preset_config) where preset is not null;
