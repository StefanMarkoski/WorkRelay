-- Deleting an automation. Its runs, step logs and versions are ON DELETE CASCADE from the workflow, so removing the row would erase
-- the whole Executions history that came from it. Instead a deleted automation is kept (invisible, switched off for good) so:
--  * it disappears from the Automations list and the counts, and never fires again (every trigger already ignores a switched-off one);
--  * its past runs stay under Executions, still showing its name, and a request that is waiting for approval can still be decided;
--  * its settings are free again: a new, identical automation can be created (the duplicate rule ignores deleted ones).
-- Only owners and admins of the workspace can delete, and only through delete_automation: nobody writes deleted_at directly.

alter table public.workflows add column deleted_at timestamptz;

create function public.delete_automation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from workflows where id = p_id;
  if org is null or not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- repeating a delete changes nothing (the first time stays)
  update workflows set deleted_at = coalesce(deleted_at, now()), enabled = false, preset_key = null, updated_at = now() where id = p_id;
end $$;
revoke execute on function public.delete_automation(uuid) from public, anon;
grant execute on function public.delete_automation(uuid) to authenticated;

-- The duplicate rule only looks at automations that still exist.
create or replace function public.workflows_preset_key() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare other record;
begin
  new.preset_key := preset_fingerprint(new.preset, new.preset_config);
  if new.preset_key is null then return new; end if; -- a custom workflow has no fingerprint
  perform pg_advisory_xact_lock(hashtext(new.organization_id::text || new.preset_key)); -- two saves at once: the second one waits and then sees the first
  select id, name, enabled into other from workflows
  where organization_id = new.organization_id and preset_key = new.preset_key and id <> new.id and deleted_at is null
  order by created_at limit 1;
  if found then
    raise exception 'This exact automation already exists: "%" (%). Edit that one instead.', left(other.name, 80),
      case when other.enabled then 'it is turned on' else 'it is turned off' end using errcode = '23505';
  end if;
  return new;
end $$;

-- The Tenants list counts the automations a tenant has, not the ones it deleted.
create or replace function public.admin_list_tenants()
returns table (
  id uuid, name text, created_at timestamptz, owner_emails text[],
  members bigint, integrations bigint, workflows bigint, orders bigint,
  currencies text[], shops_without_currency bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select o.id, o.name, o.created_at,
      coalesce((select array_agg(u.email::text order by u.email) from memberships m
                join auth.users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'owner'), '{}'),
      (select count(*) from memberships m where m.organization_id = o.id),
      (select count(*) from integrations i where i.organization_id = o.id),
      (select count(*) from workflows w where w.organization_id = o.id and w.deleted_at is null),
      (select count(*) from orders r where r.organization_id = o.id),
      coalesce((select array_agg(distinct i.currency::text order by i.currency::text) from integrations i
                where i.organization_id = o.id and i.currency is not null and i.status <> 'revoked'), '{}'),
      (select count(*) from integrations i where i.organization_id = o.id and i.currency is null and i.status <> 'revoked')
    from organizations o order by o.created_at desc;
end $$;
