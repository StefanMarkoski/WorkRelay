-- Sync history (0031): one row per sync from either side, what it changed, failures, sorting, who can read it.
begin;

create schema sh_test;
grant usage on schema sh_test to authenticated;
create function sh_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function sh_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema sh_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner@sh.dev'), ('00000000-0000-0000-0000-0000000000f2', 'other@sh.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000f1', 'Org A', '00000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-0000000000f2', 'Org B', '00000000-0000-0000-0000-0000000000f2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'Alpha', 'connected', 'wr_live_f001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000f1'),
  ('a1000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1', 'Beta', 'connected', 'wr_live_f002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000f1'),
  ('a1000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f2', 'Gamma', 'connected', 'wr_live_f003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000f2');

-- 1. a push of two new products, from a named person
select run_product_sync('a1000000-0000-0000-0000-0000000000f1',
  '[{"sku":"A","name":"Alpha pen","stock":10},{"sku":"B","name":"Beta cap","stock":4}]', 'push', now() - interval '3 hours', 'shop', 'Marko', 'Admin');
-- 2. a pull: A moves 10 -> 7, B is unchanged, C is new
select run_product_sync('a1000000-0000-0000-0000-0000000000f1',
  '[{"sku":"A","stock":7},{"sku":"B","stock":4},{"sku":"C","name":"Gamma mug","stock":50}]', 'pull', now() - interval '2 hours', 'manual');
-- 3. a push in another shop, a refused push, a failed scheduled pull
select run_product_sync('a1000000-0000-0000-0000-0000000000f2', '[{"sku":"Z","name":"Zed","stock":1}]', 'push', now() - interval '1 hour', 'shop');
select record_failed_sync_run('a1000000-0000-0000-0000-0000000000f1', 'push', 'shop', 'products.0.stock: expected number', 'Marko', 'Admin');
select record_failed_sync_run('a1000000-0000-0000-0000-0000000000f1', 'pull', 'scheduled', 'The shop answered with HTTP 500');

-- Everything here runs in one transaction, so every row got the same created_at: spread them out as real syncs would be.
update product_sync_runs set created_at = now() - interval '5 hours' where status = 'ok' and received = 2 and integration_id = 'a1000000-0000-0000-0000-0000000000f1';
update product_sync_runs set created_at = now() - interval '4 hours' where status = 'ok' and received = 3;
update product_sync_runs set created_at = now() - interval '3 hours' where integration_id = 'a1000000-0000-0000-0000-0000000000f2';
update product_sync_runs set created_at = now() - interval '2 hours' where status = 'failed' and source = 'push';
update product_sync_runs set created_at = now() - interval '1 hour' where status = 'failed' and source = 'pull';

select sh_test.as_user('00000000-0000-0000-0000-0000000000f1');

select sh_test.check('every sync is a row: 3 good ones and 2 failures',
  (select count(*) = 5 and count(*) filter (where status = 'failed') = 2 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1')));
select sh_test.check('newest first by default',
  (select (array_agg(created_at order by created_at desc)) = (array_agg(created_at order by ordinality)) from list_sync_runs('a0000000-0000-0000-0000-0000000000f1') with ordinality));
select sh_test.check('a push keeps who pressed the button, a manual pull is marked manual',
  (select by_name = 'Marko' and by_role = 'Admin' and source = 'push' and trigger = 'shop' and received = 2 and changed = 2
     from list_sync_runs('a0000000-0000-0000-0000-0000000000f1') where received = 2 and status = 'ok')
  and (select source = 'pull' and trigger = 'manual' and received = 3 and changed = 2
     from list_sync_runs('a0000000-0000-0000-0000-0000000000f1') where received = 3));
select sh_test.check('what changed: the pull moved A 10 -> 7 and added C; the unchanged B is not listed',
  (select count(*) = 2 and bool_or(sku = 'A' and stock_before = 10 and stock_after = 7) and bool_or(sku = 'C' and stock_before is null and stock_after = 50)
     from sync_run_changes((select id from list_sync_runs('a0000000-0000-0000-0000-0000000000f1') where received = 3))));
select sh_test.check('failures carry their reason',
  (select count(*) = 1 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1') where status = 'failed' and trigger = 'scheduled' and error like '%HTTP 500%'));
select sh_test.check('one shop can be asked for on its own',
  (select count(*) = 1 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f2')));
select sh_test.check('sorting: oldest first, most products first, shop name',
  (select received = 2 and status = 'ok' from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'time', false, 1))
  and (select received = 3 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'products', true, 1))
  and (select integration_name = 'Alpha' from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'shop', false, 1))
  and (select integration_name = 'Beta' from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'shop', true, 1)));
select sh_test.check('paging: 2 per page, 5 in total',
  (select count(*) = 2 and max(total_count) = 5 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'time', true, 2, 0))
  and (select count(*) = 1 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'time', true, 2, 4)));
select sh_test.check('an unknown sort falls back to newest first instead of failing',
  (select count(*) = 5 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1', null, 'nonsense')));

select sh_test.as_user('00000000-0000-0000-0000-0000000000f2');
select sh_test.check('another workspace sees none of it',
  (select count(*) = 0 from list_sync_runs('a0000000-0000-0000-0000-0000000000f1'))
  and (select count(*) = 0 from sync_run_changes((select id from product_sync_runs limit 1))));
select sh_test.check('and the table cannot be written by a user',
  (select not has_table_privilege('authenticated', 'public.product_sync_runs', 'insert')));

reset role;
-- old rows of a shop are removed when that shop syncs again; the stock history stays
update product_sync_runs set created_at = now() - interval '31 days' where integration_id = 'a1000000-0000-0000-0000-0000000000f2';
select run_product_sync('a1000000-0000-0000-0000-0000000000f2', '[{"sku":"Z","stock":2}]', 'push', now(), 'shop');
select sh_test.check('rows older than 30 days are pruned for that shop, and its stock events remain',
  (select count(*) = 1 from product_sync_runs where integration_id = 'a1000000-0000-0000-0000-0000000000f2')
  and (select count(*) = 2 from stock_events e join products p on p.id = e.product_id where p.integration_id = 'a1000000-0000-0000-0000-0000000000f2'));
select apply_product_sync('a1000000-0000-0000-0000-0000000000f2', '[{"sku":"Z","stock":9}]', 'push');
select sh_test.check('the transaction setting is cleared, so a later direct apply is not attributed to a sync',
  (select run_id is null from stock_events e join products p on p.id = e.product_id
     where p.integration_id = 'a1000000-0000-0000-0000-0000000000f2' and e.stock_after = 9));

rollback;
select 'SYNC HISTORY CHECKS PASSED';
