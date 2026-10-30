-- One currency per shop (0018): the rule on orders, who may change it, what changing it does (never converts), new shops
-- needing one, the backfill for existing shops, and the Tenants listings.
begin;

create schema sc_test;
grant usage on schema sc_test to authenticated;
create function sc_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function sc_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function sc_test.fails(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', label, sqlstate, sqlerrm; end if;
    raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema sc_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@sc.dev'), ('00000000-0000-0000-0000-0000000000a2', 'member@sc.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'super@sc.dev'), ('00000000-0000-0000-0000-0000000000a4', 'other@sc.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Org A', '00000000-0000-0000-0000-0000000000a1'),
  ('a0000000-0000-0000-0000-0000000000a2', 'Org B', '00000000-0000-0000-0000-0000000000a4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'member'),
  ('a0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a3');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'Denar shop', 'connected', 'wr_live_a001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'Dollar shop', 'connected', 'wr_live_a002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1', 'Brand new shop', 'connected', 'wr_live_a003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000a1'),
  ('a1000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a2', 'Other tenant shop', 'connected', 'wr_live_a004', extensions.digest('k4', 'sha256'), 's4', '00000000-0000-0000-0000-0000000000a4');

-- ------------------------------------------------------------------------------------------------ the backfill
-- Denar shop: MKD x2, USD x1 -> MKD. Dollar shop: one USD order, one with no currency -> USD. Brand new shop: no orders -> empty.
insert into orders (id, organization_id, integration_id, external_id, currency, total_minor, placed_at, data_quality, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', '1', 'MKD', 100000, now() - interval '3 days', '{}', now()),
  ('a3000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', '2', 'MKD', 200000, now() - interval '2 days', '{}', now()),
  ('a3000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', '3', 'USD', 5000, now() - interval '1 day', '{}', now()),
  ('a3000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '4', 'USD', 5000, now() - interval '1 day', '{}', now()),
  ('a3000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2', '5', null, 7000, now(), '{missing_currency}', now());
select sc_test.check('with no shop currency set, an order is left exactly as the shop sent it',
  (select currency is null and data_quality = '{missing_currency}' from orders where id = 'a3000000-0000-0000-0000-0000000000a5'));
select backfill_shop_currencies();
select sc_test.check('a shop takes the currency most of its orders use, and a shop with no orders stays empty',
  (select currency = 'MKD' from integrations where id = 'a1000000-0000-0000-0000-0000000000a1')
  and (select currency = 'USD' from integrations where id = 'a1000000-0000-0000-0000-0000000000a2')
  and (select currency is null from integrations where id = 'a1000000-0000-0000-0000-0000000000a3'));
select sc_test.check('an order with no currency takes its shop''s, and loses the "missing currency" flag',
  (select currency = 'USD' and not ('missing_currency' = any(data_quality)) from orders where id = 'a3000000-0000-0000-0000-0000000000a5'));
select sc_test.check('an order in another currency is NOT converted or relabelled: same amount, own currency, flagged',
  (select currency = 'USD' and total_minor = 5000 and 'currency_mismatch' = any(data_quality) from orders where id = 'a3000000-0000-0000-0000-0000000000a3'));
select sc_test.check('orders in the shop''s own currency carry no flag',
  (select count(*) = 0 from orders where integration_id = 'a1000000-0000-0000-0000-0000000000a1' and currency = 'MKD' and 'currency_mismatch' = any(data_quality)));
select sc_test.check('running the backfill again changes nothing', backfill_shop_currencies() = 0);

-- ------------------------------------------------------------------------------------------------ the rule on new orders
insert into orders (id, organization_id, integration_id, external_id, currency, total_minor, data_quality, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', 'n1', null, 12345, '{missing_currency, no_items}', now()),
  ('a3000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1', 'n2', 'EUR', 999, '{}', now()),
  ('a3000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a3', 'n3', 'EUR', 999, '{}', now());
select sc_test.check('a new order without a currency gets the shop''s; its other quality flags stay',
  (select currency = 'MKD' and data_quality = '{no_items}' from orders where id = 'a3000000-0000-0000-0000-0000000000b1'));
select sc_test.check('a new order in a different currency keeps it and is flagged, amount untouched',
  (select currency = 'EUR' and total_minor = 999 and data_quality = '{currency_mismatch}' from orders where id = 'a3000000-0000-0000-0000-0000000000b2'));
select sc_test.check('a shop with no currency yet leaves its orders alone',
  (select currency = 'EUR' and data_quality = '{}' from orders where id = 'a3000000-0000-0000-0000-0000000000b3'));
update orders set currency = 'MKD' where id = 'a3000000-0000-0000-0000-0000000000b2';
select sc_test.check('fixing an order''s currency clears its flag', (select data_quality = '{}' from orders where id = 'a3000000-0000-0000-0000-0000000000b2'));
update orders set data_quality = '{no_items}' where id = 'a3000000-0000-0000-0000-0000000000b2';
select sc_test.check('an update that does not touch the currency keeps it consistent too',
  (select currency = 'MKD' and data_quality = '{no_items}' from orders where id = 'a3000000-0000-0000-0000-0000000000b2'));

-- ------------------------------------------------------------------------------------------------ who can change it
select sc_test.as_user('00000000-0000-0000-0000-0000000000a2');
select sc_test.fails('a member cannot set a shop''s currency', $$select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', 'MKD')$$, '42501');
select sc_test.fails('nobody can write the column directly', $$update integrations set currency = 'XXX' where id = 'a1000000-0000-0000-0000-0000000000a3'$$, '42501');
reset role;
select sc_test.as_user('00000000-0000-0000-0000-0000000000a4');
select sc_test.fails('another workspace''s owner cannot set it', $$select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', 'MKD')$$, '42501');
reset role;
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select sc_test.fails('a currency must be three letters', $$select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', 'DENAR')$$);
select sc_test.fails('empty is not a currency', $$select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', '  ')$$);
select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', ' eur ');
select sc_test.check('the owner sets it (trimmed, upper-cased) and the shop''s existing EUR order now matches',
  (select currency = 'EUR' from integrations where id = 'a1000000-0000-0000-0000-0000000000a3')
  and (select data_quality = '{}' from orders where id = 'a3000000-0000-0000-0000-0000000000b3'));
select sc_test.check('members of the workspace can read every shop''s currency', (select count(*) = 3 and bool_and(currency is not null) from integrations));
reset role;

-- changing it converts nothing: amounts stay, flags are recomputed
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select set_integration_currency('a1000000-0000-0000-0000-0000000000a1', 'USD');
reset role;
select sc_test.check('switching the denar shop to USD changes no amount',
  (select sum(total_minor) = 100000 + 200000 + 5000 + 12345 + 999 from orders where integration_id = 'a1000000-0000-0000-0000-0000000000a1'));
select sc_test.check('...and the flags follow: the former USD order now matches, the MKD ones are mismatched',
  (select not ('currency_mismatch' = any(data_quality)) from orders where id = 'a3000000-0000-0000-0000-0000000000a3')
  and (select 'currency_mismatch' = any(data_quality) from orders where id = 'a3000000-0000-0000-0000-0000000000a1'));
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select set_integration_currency('a1000000-0000-0000-0000-0000000000a1', 'MKD');
reset role;
select sc_test.check('switching back restores the flags', (select count(*) = 1 from orders where integration_id = 'a1000000-0000-0000-0000-0000000000a1' and 'currency_mismatch' = any(data_quality)));
update integrations set status = 'revoked' where id = 'a1000000-0000-0000-0000-0000000000a3';
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select sc_test.fails('a revoked shop cannot be changed', $$select set_integration_currency('a1000000-0000-0000-0000-0000000000a3', 'USD')$$);
reset role;
update integrations set status = 'connected' where id = 'a1000000-0000-0000-0000-0000000000a3';

-- ------------------------------------------------------------------------------------------------ platform admins
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select sc_test.fails('a tenant owner cannot use the platform-admin function', $$select admin_set_shop_currency('a1000000-0000-0000-0000-0000000000a1', 'EUR')$$, '42501');
reset role;
select sc_test.as_user('00000000-0000-0000-0000-0000000000a3');
select admin_set_shop_currency('a1000000-0000-0000-0000-0000000000a4', 'GBP');
select sc_test.fails('an unknown shop is refused', $$select admin_set_shop_currency(gen_random_uuid(), 'GBP')$$);
select sc_test.fails('the platform admin must give a real code too', $$select admin_set_shop_currency('a1000000-0000-0000-0000-0000000000a4', 'pounds')$$);
select sc_test.check('a platform admin sets any tenant''s shop, and sees it in the shop list',
  (select currency = 'GBP' from admin_list_tenant_shops('a0000000-0000-0000-0000-0000000000a2')));
select sc_test.check('the tenants list shows each tenant''s currencies and how many shops still have none',
  (select currencies = array['EUR', 'MKD', 'USD']::text[] and shops_without_currency = 0 from admin_list_tenants() where id = 'a0000000-0000-0000-0000-0000000000a1')
  and (select currencies = array['GBP']::text[] from admin_list_tenants() where id = 'a0000000-0000-0000-0000-0000000000a2'));
reset role;

-- ------------------------------------------------------------------------------------------------ new shops
select sc_test.as_user('00000000-0000-0000-0000-0000000000a2');
select sc_test.fails('a member cannot create a shop', $$select create_integration('a0000000-0000-0000-0000-0000000000a1', 'x', 'MKD')$$, '42501');
reset role;
select sc_test.as_user('00000000-0000-0000-0000-0000000000a1');
select sc_test.fails('a new shop must come with a currency', $$select create_integration('a0000000-0000-0000-0000-0000000000a1', 'x', null)$$);
select sc_test.fails('...a real one', $$select create_integration('a0000000-0000-0000-0000-0000000000a1', 'x', '12')$$);
select create_integration('a0000000-0000-0000-0000-0000000000a1', 'Fresh shop', 'mkd');
select sc_test.check('a new shop is created with its currency', (select currency = 'MKD' from integrations where name = 'Fresh shop'));
reset role;

-- a shop with no currency shows up in the tenants listing as needing one
update integrations set currency = null where id = 'a1000000-0000-0000-0000-0000000000a3';
select sc_test.as_user('00000000-0000-0000-0000-0000000000a3');
select sc_test.check('a shop still without a currency is counted for the tenant, and the others are listed once each',
  (select shops_without_currency = 1 and currencies = array['MKD', 'USD']::text[] from admin_list_tenants() where id = 'a0000000-0000-0000-0000-0000000000a1'));
reset role;

select 'PASSED' as shop_currency;
rollback;
