-- A decision the owner made is not lost when write-back goes off.
--  * Switching write-back off cancelled every waiting number, including one the owner had just chosen in a conflict ("send WorkRelay's"). The same
--    happened when the shop was unreachable for long enough to switch it off by itself, when the address or the secret changed, and when the feed
--    address was removed. The conflict then said "sent" while nothing was. Now a number chosen in a conflict is kept, with a note, and goes out once
--    write-back is on again and the shop has been read like any other. Numbers WorkRelay calculated itself are still cancelled: by then they are old.
--  * A kept decision lapses after 7 days.
create or replace function public.cancel_stock_pushes(p_integration uuid, p_note text) returns void
language sql security definer set search_path = public as $$
  update stock_push_items set status = 'cancelled', note = left(p_note, 300), updated_at = now()
  where integration_id = p_integration and (status = 'sending' or (status = 'pending' and reason <> 'conflict'));
  update stock_push_items set note = 'Kept: you chose this number. It goes out when write-back is on and the shop has been read. (' || left(p_note, 150) || ')', updated_at = now()
  where integration_id = p_integration and status = 'pending' and reason = 'conflict';
$$;
revoke execute on function public.cancel_stock_pushes(uuid, text) from public, anon, authenticated;

create or replace function public.settle_stock_suspects() returns void
language plpgsql security definer set search_path = public as $$
declare s record; wr bigint; fixed uuid[] := '{}'; runs uuid[] := '{}';
begin
  -- a number the owner chose is kept while write-back is off, but a decision is about a moment: after 7 days it is no longer the owner's word
  update stock_push_items set status = 'cancelled', updated_at = now(),
    note = 'The owner''s decision was more than 7 days old when write-back was next ready, so it was not sent. Decide again if it still stands.'
  where status = 'pending' and reason = 'conflict' and created_at < now() - interval '7 days';
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
