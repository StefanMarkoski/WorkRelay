-- 0044: the conflict check began with a bare "delete from _stock_cmp;". The API role (the one every shop request runs as) has the
-- safeupdate extension, which refuses a DELETE or UPDATE with no WHERE clause, even inside a function. Every sync for a shop that
-- had been pushed to therefore failed with an internal error. The database owner does not have safeupdate, which is why the SQL
-- tests and an owner-run replay passed. No bare DELETE or UPDATE here: the scratch table is dropped and made fresh each time.
create or replace function public.record_stock_conflicts(p_run uuid, p_integration uuid, p_snapshot jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  drop table if exists _stock_cmp;
  create temporary table _stock_cmp (product_id uuid, org uuid, sku text, wr bigint, shop int) on commit drop;
  insert into _stock_cmp
  select p.id, p.organization_id, p.sku, (s.value->>'wr')::bigint, p.stock
  from jsonb_each(p_snapshot) s
  join products p on p.id = s.key::uuid
  where p.integration_id = p_integration and p.stock is not null and p.reported_at > (s.value->>'rep')::timestamptz;
  insert into stock_conflicts (organization_id, integration_id, product_id, sku, workrelay_value, shop_value, run_id)
  select org, p_integration, product_id, sku, wr, shop, p_run from _stock_cmp where shop <> wr
  on conflict (product_id) where status = 'open' do update set workrelay_value = excluded.workrelay_value, shop_value = excluded.shop_value,
    detected_at = now(), run_id = excluded.run_id;
  update stock_conflicts c set status = 'agreed', decided_at = now()
  from _stock_cmp m where c.product_id = m.product_id and c.status = 'open' and m.shop = m.wr;
  update products p set last_pushed_stock = null, last_pushed_at = null from _stock_cmp m where p.id = m.product_id;
  drop table _stock_cmp;
end $$;
revoke execute on function public.record_stock_conflicts(uuid, uuid, jsonb) from public, anon, authenticated;
