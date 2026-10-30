-- One currency per shop. Every shop is bound to a single currency so that dollars and denars are never mixed, and nothing in
-- the app converts between them.
--  * An order that arrives with no currency takes the shop's currency.
--  * An order that carries a DIFFERENT currency is never converted, relabelled or dropped: it keeps what it says and is
--    flagged "currency_mismatch", so a misconfigured shop shows up instead of quietly corrupting revenue.
--  * Changing a shop's currency converts nothing: it fills in orders that had none and re-checks the mismatch flags.
--  * Owners and admins set it in the shop's details; platform admins can set it from the Tenants page.
--  * Shops that already have orders get their currency from them (the most common one); a shop with no orders yet stays
--    empty until someone sets it, and the app asks.

alter table public.integrations
  add column currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$');
grant select (currency) on public.integrations to authenticated; -- written only through the functions below

-- ------------------------------------------------------------------------------------------------ the rule on orders
create function public.apply_shop_currency() returns trigger
language plpgsql security definer set search_path = public as $$
declare shop char(3);
begin
  select i.currency into shop from integrations i where i.id = new.integration_id;
  if shop is null then return new; end if; -- the shop has no currency yet: leave the order exactly as the shop sent it
  if new.currency is null then
    new.currency := shop;
    new.data_quality := array_remove(new.data_quality, 'missing_currency');
  end if;
  if new.currency is distinct from shop then
    if not ('currency_mismatch' = any (new.data_quality)) then new.data_quality := array_append(new.data_quality, 'currency_mismatch'); end if;
  else
    new.data_quality := array_remove(new.data_quality, 'currency_mismatch');
  end if;
  return new;
end $$;
revoke execute on function public.apply_shop_currency() from public, anon, authenticated;
create trigger orders_apply_shop_currency before insert or update on public.orders
  for each row execute function public.apply_shop_currency();

-- ------------------------------------------------------------------------------------------------ changing it
-- The one place a shop's currency is written. It never touches an amount.
create function public.change_shop_currency(p_integration uuid, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
declare c text := upper(btrim(coalesce(p_currency, '')));
begin
  if c !~ '^[A-Z]{3}$' then raise exception 'currency must be a three-letter code, such as MKD or USD'; end if;
  update integrations set currency = c, updated_at = now() where id = p_integration;
  -- Re-run the rule on this shop's orders: blanks get the currency, mismatch flags are recomputed. Amounts are untouched.
  update orders set currency = currency where integration_id = p_integration;
end $$;
revoke execute on function public.change_shop_currency(uuid, text) from public, anon, authenticated;

-- Workspace owners and admins: from the shop's details.
create function public.set_integration_currency(p_id uuid, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_id;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  perform change_shop_currency(p_id, p_currency);
end $$;
revoke execute on function public.set_integration_currency(uuid, text) from public, anon;
grant execute on function public.set_integration_currency(uuid, text) to authenticated;

-- Platform admins: from the Tenants page, for any tenant's shop.
create function public.admin_set_shop_currency(p_integration uuid, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from integrations where id = p_integration) then raise exception 'unknown shop'; end if;
  perform change_shop_currency(p_integration, p_currency);
end $$;
revoke execute on function public.admin_set_shop_currency(uuid, text) from public, anon;
grant execute on function public.admin_set_shop_currency(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------------------ new shops need one
drop function public.create_integration(uuid, text);
create function public.create_integration(org uuid, integration_name text, p_currency text)
returns table (integration_id uuid, secret_key text)
language plpgsql security definer set search_path = public, extensions as $$
declare raw text; new_id uuid; c text := upper(btrim(coalesce(p_currency, '')));
begin
  if not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if c !~ '^[A-Z]{3}$' then raise exception 'choose the currency this shop sells in'; end if;
  raw := 'wr_live_' || encode(gen_random_bytes(32), 'hex');
  insert into integrations (organization_id, name, key_prefix, key_hash, created_by, currency)
  values (org, integration_name, left(raw, 12), digest(raw, 'sha256'), auth.uid(), c)
  returning id into new_id;
  return query select new_id, raw;
end $$;
revoke execute on function public.create_integration(uuid, text, text) from anon, public;
grant execute on function public.create_integration(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------------------------------------ existing shops and orders
-- Idempotent, and kept as a function so it can be tested. A shop takes the currency most of its orders use (the most recent
-- wins a tie); shops with no priced orders stay empty. Then the rule is applied to the orders already stored.
create function public.backfill_shop_currencies() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with ranked as (
    select integration_id, currency,
           row_number() over (partition by integration_id order by count(*) desc, max(coalesce(placed_at, created_at)) desc) as rn
    from orders where currency is not null group by integration_id, currency
  )
  update integrations i set currency = r.currency from ranked r where r.integration_id = i.id and r.rn = 1 and i.currency is null;
  get diagnostics n = row_count;
  update orders o set currency = o.currency from integrations i where i.id = o.integration_id and i.currency is not null;
  return n;
end $$;
revoke execute on function public.backfill_shop_currencies() from public, anon, authenticated;
select public.backfill_shop_currencies();

-- ------------------------------------------------------------------------------------------------ the Tenants page
-- Both listings gain the currency. (Return types changed, so they are replaced.)
drop function public.admin_list_tenants();
create function public.admin_list_tenants()
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
      (select count(*) from workflows w where w.organization_id = o.id),
      (select count(*) from orders r where r.organization_id = o.id),
      coalesce((select array_agg(distinct i.currency::text order by i.currency::text) from integrations i
                where i.organization_id = o.id and i.currency is not null and i.status <> 'revoked'), '{}'),
      (select count(*) from integrations i where i.organization_id = o.id and i.currency is null and i.status <> 'revoked')
    from organizations o order by o.created_at desc;
end $$;
revoke execute on function public.admin_list_tenants() from public, anon;
grant execute on function public.admin_list_tenants() to authenticated;

drop function public.admin_list_tenant_shops(uuid);
create function public.admin_list_tenant_shops(p_org uuid)
returns table (id uuid, name text, status public.integration_status, currency char(3), calls int, days int, last_sync_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select i.id, i.name, i.status, i.currency, s.calls, s.days, s.last_sync_at, s.last_error
    from integrations i left join integration_sync s on s.integration_id = i.id
    where i.organization_id = p_org order by i.created_at;
end $$;
revoke execute on function public.admin_list_tenant_shops(uuid) from public, anon;
grant execute on function public.admin_list_tenant_shops(uuid) to authenticated;
