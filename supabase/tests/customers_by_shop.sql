-- The Customers page per shop: workspace-wide by default, one shop on request, with that shop's own numbers.
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
  ('00000000-0000-0000-0000-0000000000f1', 'owner@h.dev'), ('00000000-0000-0000-0000-0000000000f2', 'other@h.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000f1', 'Org A', '00000000-0000-0000-0000-0000000000f1'),
  ('a0000000-0000-0000-0000-0000000000f2', 'Org B', '00000000-0000-0000-0000-0000000000f2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, track_signups, signups_enabled_at) values
  ('a1000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'Shop 1', 'connected', 'wr_live_f001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000f1', true, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1', 'Shop 2', 'connected', 'wr_live_f002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000f1', true, now() - interval '30 days'),
  ('a1000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f2', 'Other shop', 'connected', 'wr_live_f003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000f2', false, null);

-- orders: Ana orders from both shops, Ben only from shop 2 (one cancelled)
insert into orders (id, organization_id, integration_id, external_id, customer_name, customer_email, currency, total_minor, status, placed_at, applied_at, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f1', '1', 'Ana', 'ana@example.com', 'EUR', 1000, 'completed', now() - interval '3 days', jsonb_build_object('customer', (now() - interval '3 days')::text), now()),
  ('a3000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f2', '2', 'Ana', 'ana@example.com', 'EUR', 500, 'completed', now() - interval '2 days', jsonb_build_object('customer', (now() - interval '2 days')::text), now()),
  ('a3000000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f2', '3', 'Ben', 'ben@example.com', 'USD', 300, 'cancelled', now() - interval '2 days', jsonb_build_object('customer', (now() - interval '2 days')::text), now()),
  ('a3000000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f2', '4', 'Ben', 'ben@example.com', 'USD', 200, 'pending', now() - interval '1 day', jsonb_build_object('customer', (now() - interval '1 day')::text), now()),
  ('a3000000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-0000000000f2', 'a1000000-0000-0000-0000-0000000000f3', '1', 'Zed', 'zed@example.com', 'EUR', 1, 'pending', now(), jsonb_build_object('customer', now()::text), now());

-- signups: Ana at shop 1, Cleo at shop 2 and then shop 1, Dan at shop 1
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f1', 'customer.created', now(), 'ana@example.com', null, null, null, null);
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f2', 'customer.created', now() - interval '2 hours', 'cleo@example.com', 'Cleo', null, null, null);
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f1', 'customer.created', now() - interval '1 hour', 'cleo@example.com', null, null, null, null);
select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000f1', 'a1000000-0000-0000-0000-0000000000f1', 'customer.created', now(), 'dan@example.com', 'Dan', null, null, null);

select sh_test.check('every shop a customer signed up in is recorded, not just the first',
  (select count(*) = 2 from customer_signups s join customers c on c.id = s.customer_id where c.email_key = 'cleo@example.com')
  and (select signup_integration_id = 'a1000000-0000-0000-0000-0000000000f2' from customers where email_key = 'cleo@example.com'));

set local role authenticated;
select sh_test.as_user('00000000-0000-0000-0000-0000000000f1');
select sh_test.check('workspace-wide: everyone who ordered, with totals across both shops',
  (select count(*) = 2 from list_customers('a0000000-0000-0000-0000-0000000000f1'))
  and (select order_count = 2 and spent = '{"EUR": 1500}'::jsonb from list_customers('a0000000-0000-0000-0000-0000000000f1') where lower(email) = 'ana@example.com'));

select sh_test.check('shop 1: only people who ordered there, with shop 1''s own numbers',
  (select count(*) = 1 and bool_and(order_count = 1 and spent = '{"EUR": 1000}'::jsonb) from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'ordered', 'a1000000-0000-0000-0000-0000000000f1')));
select sh_test.check('shop 2: Ana with 500, Ben with his pending order only (cancelled left out of the value)',
  (select count(*) = 2 from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'ordered', 'a1000000-0000-0000-0000-0000000000f2'))
  and (select order_count = 1 and spent = '{"EUR": 500}'::jsonb from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'ordered', 'a1000000-0000-0000-0000-0000000000f2') where lower(email) = 'ana@example.com')
  and (select order_count = 2 and spent = '{"USD": 200}'::jsonb from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'ordered', 'a1000000-0000-0000-0000-0000000000f2') where lower(email) = 'ben@example.com'));

select sh_test.check('shop 1, registered only: signed up there and never ordered there (Ana ordered, so not her)',
  (select count(*) = 2 and bool_and(order_count = 0 and lower(email) in ('cleo@example.com', 'dan@example.com')) from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'registered', 'a1000000-0000-0000-0000-0000000000f1')));
select sh_test.check('shop 2, registered only: just Cleo, who signed up there first',
  (select count(*) = 1 and bool_and(lower(email) = 'cleo@example.com') from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'registered', 'a1000000-0000-0000-0000-0000000000f2')));
select sh_test.check('a shop''s "all" is those who ordered plus those who signed up there',
  (select count(*) = 3 from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'all', 'a1000000-0000-0000-0000-0000000000f1'))
  and (select count(*) = 3 from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'all', 'a1000000-0000-0000-0000-0000000000f2')));
select sh_test.check('workspace-wide "all" is four people', (select count(*) = 4 from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'all')));
select sh_test.check('search narrows a shop view too', (select count(*) = 1 from list_customers('a0000000-0000-0000-0000-0000000000f1', 'ben', 25, 0, null, 'all', 'a1000000-0000-0000-0000-0000000000f2')));

-- another workspace: nothing leaks either way
select sh_test.as_user('00000000-0000-0000-0000-0000000000f2');
select sh_test.check('another workspace sees none of it, even naming the shop',
  (select count(*) = 0 from list_customers('a0000000-0000-0000-0000-0000000000f1', null, 25, 0, null, 'all', 'a1000000-0000-0000-0000-0000000000f1'))
  and (select count(*) = 0 from customer_signups));
select sh_test.check('and a foreign shop id shows this workspace nothing of the others',
  (select count(*) = 0 from list_customers('a0000000-0000-0000-0000-0000000000f2', null, 25, 0, null, 'all', 'a1000000-0000-0000-0000-0000000000f1')));
reset role;

rollback;
\echo CUSTOMERS BY SHOP SQL CHECKS PASSED
