-- A read the shop never answered is not a read that missed the SKU.
--  * A waiting number is dropped after three asks that got an answer without its SKU ("the feed does not list it"). A failed ask (the shop
--    was down, HTTP 502, a broken answer) used to count as one of the three too, so a shop that was briefly down made WorkRelay cancel
--    waiting numbers with a reason that was not true. Now an ask is counted when it is made, and given back if it failed.
alter table public.stock_push_items add column asked_at timestamptz; -- when this number's SKU was last asked for (the time of that claim)

create or replace function public.claim_pre_push_pulls(p_max_shops int default 5)
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
      update stock_push_items it set read_tries = it.read_tries + 1, asked_at = now() where it.integration_id = x.id and it.status = 'pending' and it.sku = any(sk);
    end if;
    select * into sy from integration_sync where integration_sync.integration_id = x.id;
    integration_id := x.id; source_url := sy.source_url; auth_header := sy.auth_header; phase := ph; skus := sk; filter_state := sy.feed_filter;
    use_filter := not exists (select 1 from unnest(sk) k where k like '%,%')
                  and (sy.feed_filter is distinct from false or coalesce(sy.feed_filter_checked_at, '-infinity') < now() - interval '7 days');
    return next;
  end loop;
end $$;

create or replace function public.fail_pre_push_pull(p_integration uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations; fails int; msg text := left(coalesce(nullif(btrim(p_error), ''), 'failed'), 200);
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not i.stock_push_enabled then return; end if;
  -- the shop never answered, so nobody learned whether it lists these SKUs: the ask does not count towards the three tries
  update stock_push_items set read_tries = greatest(read_tries - 1, 0), asked_at = null
  where integration_id = p_integration and status = 'pending' and asked_at is not null and asked_at = i.stock_push_pull_claimed_at;
  update stock_push_items set due_at = now() + interval '1 minute', updated_at = now(),
    note = 'Waiting: WorkRelay could not read the shop''s own numbers first. ' || msg
  where integration_id = p_integration and status = 'pending';
  update integrations set stock_push_failures = stock_push_failures + 1, stock_push_pull_claimed_at = now() + interval '1 minute'
  where id = p_integration returning stock_push_failures into fails;
  if fails >= 5 then
    update integrations set stock_push_enabled = false,
      stock_push_paused_reason = 'Switched off after 5 failed requests in a row. Last error: ' || msg where id = p_integration;
    perform cancel_stock_pushes(p_integration, 'Write-back was switched off after repeated failures.');
  end if;
end $$;

revoke execute on function public.claim_pre_push_pulls(int), public.fail_pre_push_pull(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pre_push_pulls(int), public.fail_pre_push_pull(uuid, text) to service_role;
