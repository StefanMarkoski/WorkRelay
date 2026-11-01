-- 0045: opening a request on the Stock pushes page said "Could not load the numbers". stock_push_request_items ordered by the
-- sequence column, which the signed-in role is not granted (it is not secret, but nothing in the app needs it), so the read was
-- refused. Order by the creation time instead, and say more about each number: why it was sent, and for a conflict decision the
-- two numbers that disagreed. The owner then sees which side was kept.
drop function if exists public.stock_push_request_items(uuid, int);
create function public.stock_push_request_items(p_request uuid, p_limit int default 200)
returns table (sku text, name text, stock bigint, status text, note text, reason text, conflict_shop int, conflict_workrelay bigint, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select x.sku, p.name, x.stock, x.status, x.note, x.reason, c.shop_value, c.workrelay_value, count(*) over ()
  from stock_push_items x
  join products p on p.id = x.product_id
  left join lateral (
    select s.shop_value, s.workrelay_value from stock_conflicts s
    where x.reason = 'conflict' and s.product_id = x.product_id and s.status = 'sent_workrelay' and s.decided_at <= x.created_at
    order by s.decided_at desc limit 1
  ) c on true
  where x.request_id = p_request
  order by x.created_at, x.id
  limit least(greatest(p_limit, 1), 500)
$$;
revoke execute on function public.stock_push_request_items(uuid, int) from public, anon;
grant execute on function public.stock_push_request_items(uuid, int) to authenticated;
