-- 0051: a number the owner chose in a conflict is not lost when write-back goes off.
begin;
create schema ds_test;
grant usage on schema ds_test to authenticated;
create function ds_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function ds_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function ds_test.flush() returns void language plpgsql as $$
begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
grant execute on all functions in schema ds_test to authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'owner@ds.dev');
insert into organizations (id, name, created_by) values ('b0000000-0000-0000-0000-0000000000c1', 'Org', '00000000-0000-0000-0000-0000000000c1');
insert into memberships values ('b0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock,
                          stock_push_enabled, stock_push_verified_at, stock_push_url, stock_push_secret_id) values
  ('b1000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000c1', 'Shop', 'connected', 'wr_live_c001', extensions.digest('k1', 'sha256'),
   's1', '00000000-0000-0000-0000-0000000000c1', true, true, now(), 'https://shop.example.com/stock', vault.create_secret('test-secret', 'ds-secret'));
insert into integration_sync (integration_id, organization_id, source_url) values
  ('b1000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000c1', 'https://shop.example.com/feed');
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c1', 'P1', 'Pen', 30, '2026-10-30 10:00+00'),
  ('b2000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c1', 'P2', 'Cap', 5, '2026-10-30 10:00+00');
-- one number WorkRelay calculated, one the owner chose
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason) values
  ('b0000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c1', 'b2000000-0000-0000-0000-0000000000c1', 'P1', 29, 'order'),
  ('b0000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c1', 'b2000000-0000-0000-0000-0000000000c2', 'P2', 34, 'conflict');

select ds_test.as_user('00000000-0000-0000-0000-0000000000c1');
select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000c1', false);
reset role;
select ds_test.check('switching off drops the number WorkRelay calculated', (select status = 'cancelled' from stock_push_items where sku = 'P1'));
select ds_test.check('but keeps the one the owner chose, and says so', (select status = 'pending' and stock = 34 and note like 'Kept: you chose this number%' from stock_push_items where sku = 'P2'));

-- the same for the other ways write-back goes off
select cancel_stock_pushes('b1000000-0000-0000-0000-0000000000c1', 'Write-back was switched off after repeated failures.');
select ds_test.check('repeated failures keep it too', (select status = 'pending' and note like '%repeated failures%' from stock_push_items where sku = 'P2'));
select cancel_stock_pushes('b1000000-0000-0000-0000-0000000000c1', 'The stock address was changed.');
select ds_test.check('and a changed address', (select status = 'pending' and stock = 34 from stock_push_items where sku = 'P2'));
select ds_test.check('while write-back is off nothing is read or sent for it', (select count(*) = 0 from claim_pre_push_pulls()) and (select count(*) = 0 from claim_stock_pushes()));

-- switched on again: read the shop, then the chosen number goes out
update integrations set stock_push_enabled = true where id = 'b1000000-0000-0000-0000-0000000000c1';
create temp table ds_p as select * from claim_pre_push_pulls();
select ds_test.check('the shop is read for it first', (select count(*) = 1 and bool_and(skus = array['P2']) from ds_p));
select run_product_sync('b1000000-0000-0000-0000-0000000000c1', '[{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
create temp table ds_c as select * from claim_stock_pushes();
select ds_test.check('and the number the owner chose is sent as chosen', (select count(*) = 1 and bool_and((items->0->>'sku') = 'P2' and (items->0->>'stock')::int = 34) from ds_c));
select complete_stock_push((select request_id from ds_c), true, 200, null);

-- a decision lapses after 7 days
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason, created_at) values
  ('b0000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c1', 'b2000000-0000-0000-0000-0000000000c1', 'P1', 12, 'conflict', now() - interval '8 days');
select settle_stock_suspects();
select ds_test.check('a kept decision older than 7 days lapses, with the reason',
  (select status = 'cancelled' and note like 'The owner''s decision was more than 7 days old%' from stock_push_items where sku = 'P1' and stock = 12));

do $$ begin raise notice 'DECIDED SURVIVE CHECKS PASSED'; end $$;
rollback;
