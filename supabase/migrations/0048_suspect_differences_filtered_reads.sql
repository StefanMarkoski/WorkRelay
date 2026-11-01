-- 0048: the two open points of the pull-first flow, and the read budget.
--
--  * A difference between the shop's number and WorkRelay's is first only a SUSPECT. The product's waiting number is held, and after 90
--    seconds the difference is judged again with the orders WorkRelay knows by then (an order that was placed before the shop answered
--    but reached WorkRelay late now counts). If it is gone, nothing happens and the number is queued again; if it is still there, it
--    becomes a conflict for the owner, exactly as before.
--  * A read asks only for the SKUs that matter (?skus=A,B,C) when the shop supports it. WorkRelay finds that out by itself (does the answer
--    hold only what was asked?), remembers it, and tries again after 7 days if the shop did not. Every other shop is read in full as before.
--  * Because a read may now be partial, a waiting number is sent only if its own SKU was in a fresh answer (stock_push_items.read_at).
--  * Reads around pushes have their own limit per shop and hour, which only a platform admin can change (default 60). When it is reached the
--    numbers wait for the next hour, and stock_push_status says so.

alter table public.stock_push_items add column read_at timestamptz, add column read_tries int not null default 0;
alter table public.integration_sync add column feed_filter boolean, add column feed_filter_checked_at timestamptz;
alter table public.integrations
  add column stock_push_reads_limit int not null default 60 check (stock_push_reads_limit between 1 and 600),
  add column stock_push_reads_window_start timestamptz,
  add column stock_push_reads_used int not null default 0;
grant select (stock_push_reads_limit) on public.integrations to authenticated;

create table public.stock_suspects (
  product_id uuid primary key references public.products (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  sku text not null,
  base_stock bigint not null,           -- where WorkRelay's belief started: the shop's last report, or a push the shop acknowledged
  base_since timestamptz not null,      -- orders placed after this count against it
  read_at timestamptz not null,         -- when the shop was asked
  shop_value int not null,
  run_id uuid references public.product_sync_runs (id) on delete set null,
  first_seen timestamptz not null default now()
);
create index stock_suspects_seen_idx on public.stock_suspects (first_seen);
alter table public.stock_suspects enable row level security;
revoke all on public.stock_suspects from anon, authenticated;

create or replace function public.enqueue_stock_pushes(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid; r record; queued int := 0;
begin
  if not exists (select 1 from products p join integrations i on i.id = p.integration_id
                 where p.id = any(p_ids) and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected') then
    return;
  end if;
  for o in select distinct organization_id from products where id = any(p_ids) loop
    for r in
      select p.organization_id, p.integration_id, p.id as product_id, p.sku, e.estimated
      from stock_estimates(o, p_ids) e
      join products p on p.id = e.product_id
      join integrations i on i.id = p.integration_id and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected'
      where not exists (select 1 from stock_conflicts c where c.product_id = p.id and c.status = 'open')
        and not exists (select 1 from stock_suspects z where z.product_id = p.id)
    loop
      if r.estimated < 0 or r.estimated > 2147483647 then
        update stock_push_items set status = 'cancelled', note = 'replaced by a newer value', updated_at = now()
        where product_id = r.product_id and status = 'pending';
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason, status, note)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, null, 'order', 'skipped',
                'The estimate is ' || r.estimated || ', outside what can be sent (0 and up): not sent.');
      else
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, r.estimated, 'order')
        on conflict (product_id) where status = 'pending' do update set stock = excluded.stock, updated_at = now(), due_at = now(), reason = 'order';
        queued := queued + 1;
      end if;
    end loop;
  end loop;
  if queued > 0 then perform kick_engine(); end if;
end $$;



-- ------------------------------------------------------------------------------------------------ judging a difference
-- No bare DELETE or UPDATE anywhere (0044).
drop function if exists public.record_stock_conflicts(uuid, uuid, jsonb);
create function public.record_stock_conflicts(p_run uuid, p_integration uuid, p_snapshot jsonb, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _stock_cmp;
  create temporary table _stock_cmp (product_id uuid, org uuid, sku text, wr bigint, shop int, base bigint, since timestamptz) on commit drop;
  insert into _stock_cmp
  select p.id, p.organization_id, p.sku, (s.value->>'wr')::bigint, p.stock, (s.value->>'base')::bigint, (s.value->>'since')::timestamptz
  from jsonb_each(p_snapshot) s
  join products p on p.id = s.key::uuid
  where p.integration_id = p_integration and p.stock is not null and p.reported_at > (s.value->>'rep')::timestamptz;
  -- the numbers agree: any suspicion or open conflict about the product is over
  delete from stock_suspects z using _stock_cmp m where z.product_id = m.product_id and m.shop = m.wr;
  update stock_conflicts c set status = 'agreed', decided_at = now()
  from _stock_cmp m where c.product_id = m.product_id and c.status = 'open' and m.shop = m.wr;
  -- they differ and the owner already has a conflict open: it is refreshed with the newest numbers
  update stock_conflicts c set workrelay_value = m.wr, shop_value = m.shop, detected_at = now(), run_id = p_run
  from _stock_cmp m where c.product_id = m.product_id and c.status = 'open' and m.shop <> m.wr;
  -- they differ and nothing is open: a suspect first, so a late order has time to arrive
  insert into stock_suspects (product_id, organization_id, integration_id, sku, base_stock, base_since, read_at, shop_value, run_id)
  select m.product_id, m.org, p_integration, m.sku, m.base, m.since, p_at, m.shop, p_run
  from _stock_cmp m
  where m.shop <> m.wr and not exists (select 1 from stock_conflicts c where c.product_id = m.product_id and c.status = 'open')
  on conflict (product_id) do update set base_stock = excluded.base_stock, base_since = excluded.base_since, read_at = excluded.read_at,
    shop_value = excluded.shop_value, run_id = excluded.run_id;
  update stock_push_items x set status = 'cancelled', updated_at = now(),
    note = 'Held: the shop reports ' || m.shop || ' but WorkRelay had ' || m.wr || '. Checking whether an order is still on its way.'
  from _stock_cmp m where x.product_id = m.product_id and x.status = 'pending' and m.shop <> m.wr;
  update products p set last_pushed_stock = null, last_pushed_at = null from _stock_cmp m where p.id = m.product_id;
  drop table _stock_cmp;
end $$;
revoke execute on function public.record_stock_conflicts(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;

-- Judges the suspects older than 90 seconds again, with the orders WorkRelay knows by now, on the same time axis as the read.
create function public.settle_stock_suspects() returns void
language plpgsql security definer set search_path = public as $$
declare s record; wr bigint; fixed uuid[] := '{}'; runs uuid[] := '{}';
begin
  for s in select * from stock_suspects where first_seen < now() - interval '90 seconds' order by product_id limit 200 for update skip locked loop
    wr := s.base_stock - (estimated_sold(s.integration_id, s.sku, s.base_since) - estimated_sold(s.integration_id, s.sku, s.read_at));
    if wr = s.shop_value then
      fixed := fixed || s.product_id;
      if s.run_id is not null then runs := runs || s.run_id; end if;
    else
      insert into stock_conflicts (organization_id, integration_id, product_id, sku, workrelay_value, shop_value, run_id)
      values (s.organization_id, s.integration_id, s.product_id, s.sku, wr, s.shop_value, s.run_id)
      on conflict (product_id) where status = 'open' do update set workrelay_value = excluded.workrelay_value, shop_value = excluded.shop_value,
        detected_at = now(), run_id = excluded.run_id;
    end if;
    delete from stock_suspects z where z.product_id = s.product_id;
  end loop;
  if cardinality(runs) > 0 then
    -- a quiet read that turned out to be nothing leaves no row
    delete from product_sync_runs r where r.id = any(runs) and r.trigger in ('before_push', 'after_push') and r.changed = 0
      and not exists (select 1 from stock_conflicts c where c.run_id = r.id) and not exists (select 1 from stock_suspects z where z.run_id = r.id);
  end if;
  if cardinality(fixed) > 0 then
    begin
      perform enqueue_stock_pushes(fixed);
    exception when others then
      raise warning 'stock write-back queueing after a settled difference failed: %', sqlerrm;
    end;
  end if;
end $$;
revoke execute on function public.settle_stock_suspects() from public, anon, authenticated;
grant execute on function public.settle_stock_suspects() to service_role;

-- ------------------------------------------------------------------------------------------------ the reads
drop function if exists public.claim_pre_push_pulls(int);
create function public.claim_pre_push_pulls(p_max_shops int default 5)
returns table (integration_id uuid, source_url text, auth_header text, phase text, skus text[], use_filter boolean, filter_state boolean)
language plpgsql security definer set search_path = public as $$
declare x record; sy integration_sync; lastfin timestamptz; sk text[]; ph text;
begin
  perform settle_stock_suspects();
  -- a number whose SKU the shop's answers never contain cannot be compared first: it is dropped after three asks, with the reason
  update stock_push_items set status = 'cancelled', updated_at = now(),
    note = 'Not sent: the shop''s feed does not list this SKU, so WorkRelay cannot compare it with the shop''s own number first.'
  where status = 'pending' and read_tries >= 3 and read_at is null;

  for x in
    select i.id, i.stock_push_verify, i.stock_push_reads_limit as lim, i.stock_push_reads_used as used, i.stock_push_reads_window_start as win
    from integrations i
    join integration_sync sync on sync.integration_id = i.id
    where i.stock_push_enabled and not i.stock_push_locked and i.stock_push_verified_at is not null and i.status = 'connected'
      and sync.source_url is not null and not sync.paused
      and (i.stock_push_pull_claimed_at is null or i.stock_push_pull_claimed_at < now() - interval '30 seconds')
    order by i.id
    limit least(greatest(p_max_shops, 1), 20)
    for update of i skip locked
  loop
    lastfin := coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = x.id and r.kind = 'stock' and r.status = 'ok'), '-infinity');
    -- what needs reading: waiting numbers without a fresh read of their own SKU (at most 100, and a short address)
    select array_agg(q.sku order by q.seq) into sk from (
      select it.sku, it.seq, sum(length(it.sku) + 3) over (order by it.seq) as len
      from stock_push_items it
      where it.integration_id = x.id and it.status = 'pending' and it.due_at <= now()
        and (it.read_at is null or it.read_at < now() - interval '90 seconds' or it.read_at <= lastfin)
      order by it.seq limit 100
    ) q where q.len <= 2500;
    ph := 'before_push';
    if sk is null then
      -- nothing waits: after a push, the numbers it carried are read once more to see that the shop took them
      if not x.stock_push_verify then continue; end if;
      ph := 'after_push';
      select array_agg(q.sku) into sk from (
        select p.sku, sum(length(p.sku) + 3) over (order by p.last_pushed_at, p.id) as len
        from products p where p.integration_id = x.id and p.last_pushed_at is not null
        order by p.last_pushed_at, p.id limit 100
      ) q where q.len <= 2500;
      if sk is null then
        update integrations set stock_push_verify = false where id = x.id;
        continue;
      end if;
    end if;
    -- the hourly limit for these reads (set by a platform admin)
    if x.win is null or now() >= x.win + interval '1 hour' then
      update integrations set stock_push_reads_window_start = now(), stock_push_reads_used = 1, stock_push_pull_claimed_at = now() where id = x.id;
    elsif x.used < x.lim then
      update integrations set stock_push_reads_used = stock_push_reads_used + 1, stock_push_pull_claimed_at = now() where id = x.id;
    else
      continue;
    end if;
    if ph = 'before_push' then
      update stock_push_items it set read_tries = it.read_tries + 1 where it.integration_id = x.id and it.status = 'pending' and it.sku = any(sk);
    end if;
    select * into sy from integration_sync where integration_sync.integration_id = x.id;
    integration_id := x.id; source_url := sy.source_url; auth_header := sy.auth_header; phase := ph; skus := sk; filter_state := sy.feed_filter;
    use_filter := not exists (select 1 from unnest(sk) k where k like '%,%')
                  and (sy.feed_filter is distinct from false or coalesce(sy.feed_filter_checked_at, '-infinity') < now() - interval '7 days');
    return next;
  end loop;
end $$;
revoke execute on function public.claim_pre_push_pulls(int) from public, anon, authenticated;
grant execute on function public.claim_pre_push_pulls(int) to service_role;

-- What a read of the shop showed about ?skus=: true when the answer held only what was asked.
create function public.set_feed_filter(p_integration uuid, p_supported boolean) returns void
language sql security definer set search_path = public as $$
  update integration_sync set feed_filter = p_supported, feed_filter_checked_at = now() where integration_id = p_integration
$$;
revoke execute on function public.set_feed_filter(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_feed_filter(uuid, boolean) to service_role;

-- The platform admin's limit for these reads, per shop and hour.
create function public.admin_set_stock_push_read_limit(p_integration uuid, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 600 then raise exception 'The limit is between 1 and 600 reads an hour.'; end if;
  update integrations set stock_push_reads_limit = p_limit, updated_at = now() where id = p_integration;
end $$;
revoke execute on function public.admin_set_stock_push_read_limit(uuid, int) from public, anon;
grant execute on function public.admin_set_stock_push_read_limit(uuid, int) to authenticated;

-- ------------------------------------------------------------------------------------------------ what is waiting, and why
create function public.stock_push_status(p_org uuid)
returns table (integration_id uuid, integration_name text, enabled boolean, waiting int, checking int, reads_used int, reads_limit int, resets_at timestamptz, oldest timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_org_member(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select i.id, i.name, i.stock_push_enabled,
         (select count(*) from stock_push_items s where s.integration_id = i.id and s.status = 'pending')::int,
         (select count(*) from stock_suspects z where z.integration_id = i.id)::int,
         case when i.stock_push_reads_window_start is null or now() >= i.stock_push_reads_window_start + interval '1 hour' then 0 else i.stock_push_reads_used end,
         i.stock_push_reads_limit,
         case when i.stock_push_reads_window_start is null or now() >= i.stock_push_reads_window_start + interval '1 hour' then null
              else i.stock_push_reads_window_start + interval '1 hour' end,
         (select min(s.created_at) from stock_push_items s where s.integration_id = i.id and s.status = 'pending')
  from integrations i
  where i.organization_id = p_org and i.stock_push_has_url
  order by i.name, i.id;
end $$;
revoke execute on function public.stock_push_status(uuid) from public, anon;
grant execute on function public.stock_push_status(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------ sending and reading
create or replace function public.claim_stock_pushes(p_max_shops int default 10)
returns table (request_id uuid, integration_id uuid, store_id text, url text, secret text, items jsonb)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; rid uuid; sec text; its jsonb; n int; stuck record; ids uuid[]; only_solo boolean; lim int; lastfin timestamptz;
begin
  perform settle_stock_suspects();
  if pg_try_advisory_xact_lock(hashtext('stock_push_housekeeping'))
     and coalesce((select last_run from maintenance_state where key = 'stock_push_housekeeping'), '-infinity') < now() - interval '10 minutes' then
    delete from stock_push_items where created_at < now() - interval '30 days' and status in ('sent', 'failed', 'skipped', 'cancelled');
    delete from stock_push_requests where created_at < now() - interval '30 days';
    insert into maintenance_state (key, last_run) values ('stock_push_housekeeping', now())
    on conflict (key) do update set last_run = excluded.last_run;
  end if;
  for stuck in select id from stock_push_requests where status = 'sending' and created_at < now() - interval '2 minutes' order by id for update skip locked loop
    perform complete_stock_push(stuck.id, false, null, 'No answer was recorded.');
  end loop;
  -- a shop whose feed address was removed can no longer be read first: it is switched off, not left waiting for ever
  for stuck in
    with gone as (
      update integrations x set stock_push_enabled = false,
        stock_push_paused_reason = 'Switched off: the shop''s product feed address was removed, so WorkRelay cannot read the shop''s numbers before it sends its own.'
      where x.stock_push_enabled and not exists (select 1 from integration_sync s where s.integration_id = x.id and s.source_url is not null)
      returning x.id
    ) select id from gone
  loop
    perform cancel_stock_pushes(stuck.id, 'The product feed address was removed.');
  end loop;

  for i in
    select x.* from integrations x
    where x.stock_push_enabled and not x.stock_push_locked and x.stock_push_verified_at is not null and x.status = 'connected'
      -- some waiting number has been read in the shop's own answer: after the last push went out, and not long ago
      and exists (select 1 from stock_push_items s where s.integration_id = x.id and s.status = 'pending' and s.due_at <= now()
                  and s.read_at is not null and s.read_at > now() - interval '2 minutes'
                  and s.read_at > coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = x.id and r.kind = 'stock' and r.status = 'ok'), '-infinity'))
      and not exists (select 1 from stock_push_requests r where r.integration_id = x.id and r.status = 'sending')
      and (select count(*) from stock_push_requests r where r.integration_id = x.id and r.created_at > now() - interval '1 minute') < 20
    order by x.id limit p_max_shops for update of x skip locked
  loop
    select decrypted_secret into sec from vault.decrypted_secrets where id = i.stock_push_secret_id;
    if sec is null then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off: the signing secret is missing.' where id = i.id;
      perform cancel_stock_pushes(i.id, 'The signing secret is missing.');
      continue;
    end if;

    -- every waiting number is recalculated from the numbers just read; a number the owner chose in a conflict is left as chosen
    lastfin := coalesce((select max(r.finished_at) from stock_push_requests r where r.integration_id = i.id and r.kind = 'stock' and r.status = 'ok'), '-infinity');
    select array_agg(s.product_id) into ids from stock_push_items s
    where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.reason = 'order'
      and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin;
    if ids is not null then
      update stock_push_items s set stock = e.estimated, updated_at = now()
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and s.stock is distinct from e.estimated
        and e.estimated between 0 and 2147483647;
      update stock_push_items s set status = 'skipped', stock = null, updated_at = now(),
        note = 'The estimate is ' || e.estimated || ', outside what can be sent (0 and up): not sent.'
      from stock_estimates(i.organization_id, ids) e
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and (e.estimated < 0 or e.estimated > 2147483647);
      -- the shop already holds this number (it took the order off its own stock): nothing to say
      update stock_push_items s set status = 'cancelled', note = 'The shop already has this number.', updated_at = now()
      from stock_estimates(i.organization_id, ids) e join products p on p.id = e.product_id
      where s.product_id = e.product_id and s.status = 'pending' and s.reason = 'order' and e.sold_since = 0 and e.estimated = p.stock;
    end if;

    if not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now()
                   and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin) then continue; end if;

    -- numbers the shop refused as part of a batch are sent one at a time, after the normal ones
    only_solo := not exists (select 1 from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and not s.solo
                             and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin);
    lim := case when only_solo then 1 else 100 end;
    insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version)
    values (i.organization_id, i.id, 'stock', i.stock_push_url, i.stock_push_secret_version) returning id into rid;
    with picked as (
      select s.id from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now() and s.solo = only_solo
        and s.read_at is not null and s.read_at > now() - interval '2 minutes' and s.read_at > lastfin
      order by s.seq limit lim for update skip locked
    ), upd as (
      update stock_push_items s set status = 'sending', request_id = rid, attempts = s.attempts + 1, updated_at = now()
      from picked where s.id = picked.id returning s.sku, s.stock, s.seq, s.product_id
    )
    -- with each number: what WorkRelay last read from the shop, so the shop can tell if its own number has moved since
    select coalesce(jsonb_agg(jsonb_build_object('sku', u.sku, 'stock', u.stock, 'seq', u.seq, 'as_of', now(),
                                                  'reported_stock', p.stock, 'reported_at', p.reported_at) order by u.seq), '[]'::jsonb), count(*)
    into its, n from upd u join products p on p.id = u.product_id;
    update stock_push_requests set item_count = n where id = rid;
    request_id := rid; integration_id := i.id; store_id := i.external_store_id; url := i.stock_push_url; secret := sec; items := its;
    return next;
  end loop;
end $$;

create or replace function public.run_product_sync(
  p_integration uuid, p_items jsonb, p_source text, p_at timestamptz, p_trigger text, p_by_name text default null, p_by_role text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid; push_on boolean; run uuid := gen_random_uuid(); n int; ids uuid[]; snap jsonb := '{}'::jsonb;
begin
  select organization_id, stock_push_enabled into org, push_on from integrations where id = p_integration;
  if org is null then raise exception 'shop is not connected'; end if;
  delete from product_sync_runs where integration_id = p_integration and created_at < now() - interval '30 days';
  insert into product_sync_runs (id, organization_id, integration_id, source, trigger, by_name, by_role, received, status)
  values (run, org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''),
          case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end, 'ok');
  if push_on then
    select array_agg(q.pid) into ids from (
      select id as pid from products where integration_id = p_integration and last_pushed_at is not null
      union
      select product_id from stock_push_items where integration_id = p_integration and status in ('pending', 'sending')
    ) q;
    if ids is not null then
      -- What WorkRelay believed the shop held AT THE MOMENT THE SHOP WAS ASKED (p_at): an order placed after that cannot be in the shop's
      -- answer, so it is left out of the comparison, the same way the new baseline leaves it out of the estimate. Without this, an order
      -- that reached WorkRelay while the answer was on its way would look like a disagreement.
      -- 'base' and 'since' say where WorkRelay's belief started (the shop's last report, or a push the shop acknowledged); the belief at the
      -- moment of asking is base less the orders placed between 'since' and p_at. They are kept with a suspected difference, so it can be
      -- judged again later with the orders that arrived in between.
      select coalesce(jsonb_object_agg(e.product_id, jsonb_build_object(
               'base', b.base, 'since', b.since,
               'wr', b.base - (estimated_sold(p.integration_id, p.sku, b.since) - estimated_sold(p.integration_id, p.sku, p_at)),
               'rep', e.as_of)), '{}'::jsonb)
      into snap
      from stock_estimates(org, ids) e
      join products p on p.id = e.product_id
      cross join lateral (select case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of then p.last_pushed_stock else p.stock end as base,
                                 case when p.last_pushed_at is not null and p.last_pushed_at > e.as_of then p.last_pushed_at else e.as_of end as since) b;
    end if;
  end if;
  perform set_config('workrelay.sync_run', run::text, true);
  n := apply_product_sync(p_integration, p_items, p_source, p_at);
  perform flush_first_reports(run, p_integration); -- 0035
  perform set_config('workrelay.sync_run', '', true);
  if snap <> '{}'::jsonb then perform record_stock_conflicts(run, p_integration, snap, p_at); end if;
  if push_on and jsonb_typeof(p_items) = 'array' then
    -- every waiting number whose SKU was in this answer has now been read: the shop's own number was compared with WorkRelay's
    update stock_push_items s set read_at = greatest(coalesce(s.read_at, '-infinity'), p_at)
    from (select distinct nullif(btrim(e->>'sku'), '') as sku from jsonb_array_elements(p_items) e) k
    where s.integration_id = p_integration and s.status = 'pending' and s.sku = k.sku;
  end if;
  if p_source = 'pull' then
    update integrations set stock_push_pulled_at = greatest(coalesce(stock_push_pulled_at, '-infinity'), p_at),
      stock_push_verify = stock_push_verify and p_at <= coalesce((select max(r.finished_at) from stock_push_requests r
                                                                  where r.integration_id = p_integration and r.kind = 'stock' and r.status = 'ok'), '-infinity')
    where id = p_integration;
  end if;
  update product_sync_runs set changed = (
    select count(*) from (select product_id from stock_events where run_id = run union select product_id from price_events where run_id = run) c
  ) where id = run;
  -- the quiet reads around a push write a row only when they found something: a change, or a disagreement. Otherwise a busy shop would
  -- fill its history with "0 changed".
  if p_trigger in ('before_push', 'after_push') then
    delete from product_sync_runs r where r.id = run and r.changed = 0 and not exists (select 1 from stock_conflicts c where c.run_id = r.id)
      and not exists (select 1 from stock_suspects z where z.run_id = r.id);
  end if;
  return n;
end $$;

revoke execute on function public.enqueue_stock_pushes(uuid[]), public.claim_stock_pushes(int) from public, anon, authenticated;
grant execute on function public.claim_stock_pushes(int) to service_role;
revoke execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.run_product_sync(uuid, jsonb, text, timestamptz, text, text, text) to service_role;

-- The platform admin's list of a tenant's shops also shows the hourly limit for the reads around pushes.
drop function public.admin_list_tenant_shops(uuid);
create function public.admin_list_tenant_shops(p_org uuid)
returns table (
  id uuid, name text, status public.integration_status, currency char(3), push_enabled boolean,
  calls int, days int, last_sync_at timestamptz, last_error text, reads_limit int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select i.id, i.name, i.status, i.currency, coalesce(s.push_enabled, false), s.calls, s.days, s.last_sync_at, s.last_error, i.stock_push_reads_limit
    from integrations i left join integration_sync s on s.integration_id = i.id
    where i.organization_id = p_org order by i.created_at;
end $$;
revoke execute on function public.admin_list_tenant_shops(uuid) from public, anon;
grant execute on function public.admin_list_tenant_shops(uuid) to authenticated;
