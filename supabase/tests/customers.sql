-- Customers: trigger sync, matching, newer-wins profile, backfill, row security, and the two read functions.
begin;

create schema ct_test;
grant usage on schema ct_test to anon, authenticated;

create function ct_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

create function ct_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function ct_test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;

create function ct_test.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema ct_test to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@c.dev'), ('00000000-0000-0000-0000-0000000000d2', 'member@c.dev'),
  ('00000000-0000-0000-0000-0000000000d3', 'other@c.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'Org A', '00000000-0000-0000-0000-0000000000d1'),
  ('a0000000-0000-0000-0000-0000000000d2', 'Org B', '00000000-0000-0000-0000-0000000000d3');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'member'),
  ('a0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Main shop', 'connected', 'wr_live_cccc', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d2', 'B shop', 'connected', 'wr_live_dddd', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000d3');

-- ------------------------------------------------------------- the trigger creates and merges customers
insert into orders (id, organization_id, integration_id, external_id, order_number, customer_name, customer_email, customer_phone,
                    placed_at, currency, total_minor, status, applied_at, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '1', '#1',
   'Ana Petrova', '  Ana@Example.com ', '+389 70 111', now() - interval '3 days', 'EUR', 1000, 'completed',
   jsonb_build_object('customer', (now() - interval '3 days')::text), now() - interval '3 days'),
  ('a3000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '2', '#2',
   'Ana P.', 'ana@example.com', null, now() - interval '2 days', 'EUR', 500, 'cancelled',
   jsonb_build_object('customer', (now() - interval '2 days')::text), now() - interval '2 days'),
  ('a3000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '3', '#3',
   null, 'ANA@example.com', null, now() - interval '1 day', 'JPY', 5000, 'pending',
   jsonb_build_object('customer', (now() - interval '1 day')::text), now() - interval '1 day'),
  ('a3000000-0000-0000-0000-0000000000d4', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '4', '#4',
   'No Email', null, null, now(), 'EUR', 999, 'pending', '{}', now()),
  ('a3000000-0000-0000-0000-0000000000d5', 'a0000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d2', '1', '#B1',
   'Ana Other', 'ana@example.com', null, now(), 'USD', 777, 'pending', jsonb_build_object('customer', now()::text), now());

select ct_test.check('three emails differing in case and spaces are one customer; an order without email makes none',
  (select count(*) = 1 from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1')
  and (select email_key = 'ana@example.com' from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1'));
select ct_test.check('the same email in another workspace is a different customer',
  (select count(*) = 1 from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d2'));
select ct_test.check('the newest order sets the profile, a missing name never blanks it, first seen is the earliest order',
  (select email = 'ANA@example.com' and name = 'Ana P.' and phone = '+389 70 111'
      and first_seen_at < now() - interval '2 days 23 hours'
   from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1'));

-- an older order arriving late does not overwrite a newer name; a newer one does
insert into orders (id, organization_id, integration_id, external_id, customer_name, customer_email, applied_at, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d6', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '6',
   'Old Name', 'ana@example.com', jsonb_build_object('customer', (now() - interval '10 days')::text), now() - interval '10 days');
select ct_test.check('an older profile does not overwrite a newer one',
  (select name = 'Ana P.' from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1'));
update orders set customer_name = 'Ana Petrova-Ilieva', applied_at = jsonb_build_object('customer', now()::text)
  where id = 'a3000000-0000-0000-0000-0000000000d3';
select ct_test.check('a newer profile replaces it',
  (select name = 'Ana Petrova-Ilieva' from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1'));

-- an update that leaves the customer fields alone is not a profile change
select profile_at as before_at from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1' \gset
update orders set status = 'completed', total_minor = total_minor where id = 'a3000000-0000-0000-0000-0000000000d3';
select ct_test.check('an update that keeps the customer fields does not touch the customer',
  (select profile_at = :'before_at'::timestamptz from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1'));
delete from orders where id = 'a3000000-0000-0000-0000-0000000000d6';
update orders set status = 'pending' where id = 'a3000000-0000-0000-0000-0000000000d3';

-- ------------------------------------------------------------- the read functions
set local role authenticated;
select ct_test.as_user('00000000-0000-0000-0000-0000000000d2'); -- plain member of org A
select * from list_customers('a0000000-0000-0000-0000-0000000000d1') as r \gset
reset role;
select ct_test.check('a member sees one customer with 3 orders and per-currency order value that leaves out cancelled orders',
  (select count(*) = 1 and bool_and(order_count = 3 and total_count = 1 and spent = '{"EUR": 1000, "JPY": 5000}'::jsonb
      and last_order_at > now() - interval '25 hours') from (
     select * from (select set_config('role', 'authenticated', true)) s,
     lateral list_customers('a0000000-0000-0000-0000-0000000000d1')) x));

select set_config('role', 'authenticated', true);
select ct_test.as_user('00000000-0000-0000-0000-0000000000d2');
select ct_test.check('search finds by email part and by name, and is case-insensitive',
  (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', 'EXAMPLE')) = 1
  and (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', 'petrova')) = 1
  and (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', 'nobody')) = 0);
select ct_test.check('search treats % and _ as plain characters', (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', '%')) = 0
  and (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', '_')) = 0);
select id as cust_id from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1' \gset
select ct_test.check('one customer can be fetched by id', (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1', null, 25, 0, :'cust_id')) = 1);
select ct_test.check('the orders list has only this customer''s orders, newest first, with the shop name',
  (select count(*) = 3 and bool_and(integration_name = 'Main shop') and min(total_count) = 3 from customer_orders(:'cust_id'))
  and (select (array_agg(order_number order by placed_at desc))[1] = '#3' from customer_orders(:'cust_id')));
select ct_test.check('orders paginate with the full total', (select count(*) = 2 and min(total_count) = 3 from customer_orders(:'cust_id', 2, 0))
  and (select count(*) = 1 from customer_orders(:'cust_id', 2, 2)));

-- ------------------------------------------------------------- nobody else sees them
select ct_test.as_user('00000000-0000-0000-0000-0000000000d3'); -- owner of org B
select ct_test.check('another workspace sees none of org A''s customers or their orders',
  (select count(*) from list_customers('a0000000-0000-0000-0000-0000000000d1')) = 0
  and (select count(*) from customer_orders(:'cust_id')) = 0
  and (select count(*) from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1') = 0);
select ct_test.check('org B sees only its own customer, with only its own order',
  (select count(*) = 1 and bool_and(order_count = 1 and spent = '{"USD": 777}'::jsonb) from list_customers('a0000000-0000-0000-0000-0000000000d2')));
select ct_test.fails('a member cannot write customers directly', $$ insert into customers (organization_id, email_key, email, profile_at, first_seen_at) values ('a0000000-0000-0000-0000-0000000000d2', 'x@y.z', 'x@y.z', now(), now()) $$);
select ct_test.fails('a member cannot edit customers directly', $$ update customers set name = 'x' $$);
select ct_test.as_anon();
select ct_test.fails('anonymous callers cannot list customers', $$ select * from list_customers('a0000000-0000-0000-0000-0000000000d1') $$);
reset role;

-- ------------------------------------------------------------- an email change moves the order
update orders set customer_email = 'bob@example.com', customer_name = 'Bob', applied_at = jsonb_build_object('customer', now()::text)
  where id = 'a3000000-0000-0000-0000-0000000000d2';
select ct_test.check('correcting an order''s email creates the new customer and leaves the old one with its other orders',
  (select count(*) = 2 from customers where organization_id = 'a0000000-0000-0000-0000-0000000000d1')
  and (select order_count = 2 from list_customers('a0000000-0000-0000-0000-0000000000d1', 'ana') limit 1)
  and (select order_count = 1 from list_customers('a0000000-0000-0000-0000-0000000000d1', 'bob') limit 1));

-- ------------------------------------------------------------- backfill: the same statement from the migration rebuilds the same rows
create temp table before_rows as select organization_id, email_key, email, name, phone from customers order by 1, 2;
delete from customers;
insert into public.customers (organization_id, email_key, email, name, phone, profile_at, first_seen_at)
select organization_id, k,
       (array_agg(email order by at desc))[1],
       (array_agg(name order by at desc) filter (where name is not null))[1],
       (array_agg(phone order by at desc) filter (where phone is not null))[1],
       max(at), min(seen)
from (
  select organization_id, lower(btrim(customer_email)) as k, btrim(customer_email) as email,
         nullif(btrim(customer_name), '') as name, nullif(btrim(customer_phone), '') as phone,
         coalesce((applied_at->>'customer')::timestamptz, last_event_at) as at, coalesce(placed_at, created_at) as seen
  from public.orders where nullif(lower(btrim(customer_email)), '') is not null
) o group by organization_id, k;
select ct_test.check('the backfill reproduces the customers the trigger built',
  (select count(*) from customers) = (select count(*) from before_rows)
  and not exists (select 1 from customers c join before_rows b using (organization_id, email_key)
                  where c.email is distinct from b.email or c.name is distinct from b.name or c.phone is distinct from b.phone));

rollback;
\echo CUSTOMERS SQL CHECKS PASSED
