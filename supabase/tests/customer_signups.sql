-- Customer signups and the two customer triggers: the setting, apply_customer_signup, first-order detection, automations,
-- and the list scopes.
begin;

create schema cs_test;
grant usage on schema cs_test to authenticated;
create function cs_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function cs_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function cs_test.fails(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if state is not null and sqlstate <> state then raise exception 'FAIL: % (wrong error %: %)', label, sqlstate, sqlerrm; end if;
    raise notice 'ok   - % [%]', label, sqlerrm; return; end;
  raise exception 'FAIL: % (statement succeeded)', label;
end $$;
grant execute on all functions in schema cs_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@s.dev'), ('00000000-0000-0000-0000-0000000000e2', 'admin@s.dev'),
  ('00000000-0000-0000-0000-0000000000e3', 'member@s.dev'), ('00000000-0000-0000-0000-0000000000e4', 'other@s.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Org A', '00000000-0000-0000-0000-0000000000e1'),
  ('a0000000-0000-0000-0000-0000000000e2', 'Org B', '00000000-0000-0000-0000-0000000000e4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'admin'),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'member'),
  ('a0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e4', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'Shop 1', 'connected', 'wr_live_e001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'Shop 2 (tracking stays off)', 'connected', 'wr_live_e002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'Shop 3', 'connected', 'wr_live_e003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000e1'),
  ('a1000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e2', 'B shop', 'connected', 'wr_live_e004', extensions.digest('k4', 'sha256'), 's4', '00000000-0000-0000-0000-0000000000e4');

-- ------------------------------------------------------------- the setting
select cs_test.check('tracking is off by default', (select not bool_or(track_signups) and bool_and(signups_enabled_at is null) from integrations));
set local role authenticated;
select cs_test.as_user('00000000-0000-0000-0000-0000000000e3');
select cs_test.fails('a plain member cannot switch signups on', $$ select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', true) $$, '42501');
select cs_test.as_user('00000000-0000-0000-0000-0000000000e4');
select cs_test.fails('another workspace cannot switch them on', $$ select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', true) $$, '42501');
select cs_test.fails('the signup function is not callable by users', $$ select apply_customer_signup(gen_random_uuid(), 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'customer.created', now(), 'x@y.z', null, null, null, null) $$);
select cs_test.as_user('00000000-0000-0000-0000-0000000000e2');
select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', true);
select set_integration_signups('a1000000-0000-0000-0000-0000000000e3', true);
reset role;
select cs_test.check('an admin switches it on and the moment is recorded',
  (select track_signups and signups_enabled_at > now() - interval '1 minute' from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));
select signups_enabled_at as first_on from integrations where id = 'a1000000-0000-0000-0000-0000000000e1' \gset
set local role authenticated;
select cs_test.as_user('00000000-0000-0000-0000-0000000000e2');
select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', true);
reset role;
select cs_test.check('switching on again does not restart the window', (select signups_enabled_at = :'first_on'::timestamptz from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));

-- ------------------------------------------------------------- automations (published and enabled)
insert into workflows (id, organization_id, name) values
  ('a4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'signup any shop'),
  ('a4000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'signup shop 1 only'),
  ('a4000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'signup shop 3 only'),
  ('a4000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e1', 'first order'),
  ('a4000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000e1', 'order created'),
  ('a4000000-0000-0000-0000-0000000000e6', 'a0000000-0000-0000-0000-0000000000e1', 'signup, disabled');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
select ('a5000000-0000-0000-0000-0000000000e' || n)::uuid, ('a4000000-0000-0000-0000-0000000000e' || n)::uuid,
       'a0000000-0000-0000-0000-0000000000e1', 1, def
from (values
  (1, '{"trigger":{"type":"customer_signup"},"steps":[]}'::jsonb),
  (2, '{"trigger":{"type":"customer_signup","integration_id":"a1000000-0000-0000-0000-0000000000e1"},"steps":[]}'::jsonb),
  (3, '{"trigger":{"type":"customer_signup","integration_id":"a1000000-0000-0000-0000-0000000000e3"},"steps":[]}'::jsonb),
  (4, '{"trigger":{"type":"customer_first_order"},"steps":[]}'::jsonb),
  (5, '{"trigger":{"type":"order_created"},"steps":[]}'::jsonb),
  (6, '{"trigger":{"type":"customer_signup"},"steps":[]}'::jsonb)) v(n, def);
update workflows w set current_version_id = ('a5000000-0000-0000-0000-0000000000e' || right(w.id::text, 1))::uuid
  where organization_id = 'a0000000-0000-0000-0000-0000000000e1';
update workflows set enabled = true where organization_id = 'a0000000-0000-0000-0000-0000000000e1' and id <> 'a4000000-0000-0000-0000-0000000000e6';

-- ------------------------------------------------------------- first order
insert into orders (id, organization_id, integration_id, external_id, order_number, customer_name, customer_email, currency, total_minor,
                    placed_at, applied_at, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '1', '#1',
   'Guest Buyer', 'Guest@Example.com', 'EUR', 2500, now(), jsonb_build_object('customer', now()::text), now());
select cs_test.check('a new customer''s first order records one event and starts only the first-order automation',
  (select count(*) = 1 from customer_events where type = 'first_order')
  and (select count(*) = 1 and bool_and(workflow_id = 'a4000000-0000-0000-0000-0000000000e4' and trigger_source = 'customer_first_order'
        and context->'customer'->>'email' = 'Guest@Example.com' and context->'order'->>'order_number' = '#1'
        and context->'event'->>'type' = 'customer.first_order') from workflow_runs where context ? 'customer'));
select cs_test.check('the order-created automation is not started by a customer event',
  (select count(*) = 0 from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000e5'));

insert into orders (id, organization_id, integration_id, external_id, order_number, customer_name, customer_email, currency, total_minor,
                    placed_at, applied_at, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', '2', '#2',
   'Guest Buyer', ' guest@example.com', 'EUR', 100, now(), jsonb_build_object('customer', now()::text), now());
update orders set customer_name = 'Guest B.', applied_at = jsonb_build_object('customer', now()::text) where id = 'a3000000-0000-0000-0000-0000000000e1';
select cs_test.check('a second order, or a renamed customer, is not a first order',
  (select count(*) = 1 from customer_events where type = 'first_order') and (select count(*) = 1 from workflow_runs));

-- an order whose email is corrected to an address with no other orders is that customer's first
update orders set customer_email = 'corrected@example.com', applied_at = jsonb_build_object('customer', now()::text) where id = 'a3000000-0000-0000-0000-0000000000e2';
select cs_test.check('moving an order to a brand-new email makes it that customer''s first order',
  (select count(*) = 2 from customer_events where type = 'first_order') and (select count(*) = 2 from workflow_runs));
-- and moving it back never fires twice for the first customer
update orders set customer_email = 'guest@example.com', applied_at = jsonb_build_object('customer', now()::text) where id = 'a3000000-0000-0000-0000-0000000000e2';
select cs_test.check('moving it back fires nothing more', (select count(*) = 2 from customer_events where type = 'first_order'));

-- ------------------------------------------------------------- signup events
insert into webhook_events (id, organization_id, integration_id, event_id, event_type, raw_payload) values
  ('a8000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg1', 'customer.created', '{}'),
  ('a8000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg2', 'customer.created', '{}'),
  ('a8000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e3', 'sg3', 'customer.created', '{}'),
  ('a8000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2', 'sg4', 'customer.created', '{}'),
  ('a8000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg5', 'customer.updated', '{}'),
  ('a8000000-0000-0000-0000-0000000000e6', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg6', 'customer.created', '{}'),
  ('a8000000-0000-0000-0000-0000000000e7', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg7', 'customer.updated', '{}');
delete from workflow_runs;
delete from customer_events;

-- a brand-new signup
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.created', now(), '  New.Person@Example.com ', 'New Person', '+389 70 5', 'shop-cust-7', null) as r \gset
select cs_test.check('a signup creates the customer, marks them registered and records one event',
  :'r' = 'ok'
  and (select count(*) = 1 and bool_and(email_key = 'new.person@example.com' and email = 'New.Person@Example.com' and name = 'New Person'
        and external_id = 'shop-cust-7' and registered_at is not null and signup_integration_id = 'a1000000-0000-0000-0000-0000000000e1')
      from customers where email_key = 'new.person@example.com')
  and (select count(*) = 1 from customer_events where type = 'signed_up')
  and (select status = 'processed' from webhook_events where id = 'a8000000-0000-0000-0000-0000000000e1'));
select cs_test.check('it starts the any-shop and the shop-1 automations only (not shop 3, not the disabled one, not first-order)',
  (select count(*) = 2 and bool_and(workflow_id in ('a4000000-0000-0000-0000-0000000000e1', 'a4000000-0000-0000-0000-0000000000e2')
      and context->'customer'->>'name' = 'New Person' and context->'event'->>'type' = 'customer.signed_up' and not (context ? 'order')) from workflow_runs));

-- resent as a new event id (the shop retried, or sent it twice): nothing fires again
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.created', now(), 'new.person@example.com', null, null, null, null);
select cs_test.check('a repeated signup for the same shop fires nothing and keeps one event', (select count(*) = 1 from customer_events where type = 'signed_up') and (select count(*) = 2 from workflow_runs));

-- the same person signs up in a second tracked shop
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e3',
  'customer.created', now(), 'new.person@example.com', null, null, null, null);
select cs_test.check('a second shop is a second signup of the same customer, and starts that shop''s automations',
  (select count(*) = 1 from customers where email_key = 'new.person@example.com')
  and (select count(*) = 2 from customer_events where type = 'signed_up')
  and (select count(*) = 2 from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000e1')
  and (select count(*) = 1 from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000e2')
  and (select count(*) = 1 from workflow_runs where workflow_id = 'a4000000-0000-0000-0000-0000000000e3'));
select cs_test.check('the first shop stays recorded as where they signed up',
  (select signup_integration_id = 'a1000000-0000-0000-0000-0000000000e1' from customers where email_key = 'new.person@example.com'));

-- tracking off for shop 2: the event is kept, visibly ignored, and nothing else happens
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2',
  'customer.created', now(), 'off@example.com', 'Off', null, null, null) as r \gset
select cs_test.check('with tracking off the event is ignored with a retryable reason and creates nothing',
  :'r' = 'disabled' and (select count(*) = 0 from customers where email_key = 'off@example.com')
  and (select status = 'ignored' and error like 'signups_off:%' from webhook_events where id = 'a8000000-0000-0000-0000-0000000000e4'));

-- a guest who already ordered registers: the row exists, they become registered, and the signup fires
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e6', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.created', now(), 'GUEST@example.com', null, null, null, null);
select cs_test.check('a customer who ordered as a guest becomes registered and fires "signed up", and registering is never a first order',
  (select registered_at is not null from customers where email_key = 'guest@example.com')
  and (select count(*) = 1 from customer_events e join customers c on c.id = e.customer_id where e.type = 'signed_up' and c.email_key = 'guest@example.com')
  and (select count(*) = 0 from customer_events e join customers c on c.id = e.customer_id where e.type = 'first_order' and c.email_key = 'guest@example.com'));

-- customer.updated for someone never seen: the account exists, but an edit is not a signup
delete from workflow_runs;
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e5', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.updated', now(), 'old.account@example.com', 'Old Account', null, null, null);
select cs_test.check('an update for an unseen customer registers them and fires nothing',
  (select registered_at is not null from customers where email_key = 'old.account@example.com')
  and (select count(*) = 0 from customer_events e join customers c on c.id = e.customer_id where c.email_key = 'old.account@example.com')
  and (select count(*) = 0 from workflow_runs));

-- profile: an older update never overwrites a newer name
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e7', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.updated', now() - interval '5 days', 'old.account@example.com', 'Ancient Name', null, null, null);
select cs_test.check('an older update does not overwrite a newer name', (select name = 'Old Account' from customers where email_key = 'old.account@example.com'));

-- history import: a signup from before tracking was switched on is saved, not notified
insert into webhook_events (id, organization_id, integration_id, event_id, event_type, raw_payload) values
  ('a8000000-0000-0000-0000-0000000000e8', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'sg8', 'customer.created', '{}');
select apply_customer_signup('a8000000-0000-0000-0000-0000000000e8', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'customer.created', now(), 'imported@example.com', 'Imported', null, null, now() - interval '400 days');
select cs_test.check('an old account imported as a new event is saved with its real signup date and notifies no one',
  (select registered_at < now() - interval '399 days' from customers where email_key = 'imported@example.com')
  and (select count(*) = 0 from customer_events e join customers c on c.id = e.customer_id where c.email_key = 'imported@example.com')
  and (select count(*) = 0 from workflow_runs));

-- switching tracking off and on opens a fresh window (now() is fixed inside a transaction, so start from a past moment)
update integrations set signups_enabled_at = now() - interval '10 days' where id = 'a1000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select cs_test.as_user('00000000-0000-0000-0000-0000000000e2');
select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', false);
reset role;
select cs_test.check('switching off keeps the old moment', (select not track_signups and signups_enabled_at < now() - interval '9 days' from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));
set local role authenticated;
select cs_test.as_user('00000000-0000-0000-0000-0000000000e2');
select set_integration_signups('a1000000-0000-0000-0000-0000000000e1', true);
reset role;
select cs_test.check('switching back on starts a fresh window', (select track_signups and signups_enabled_at > now() - interval '1 minute' from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));

-- ------------------------------------------------------------- the list scopes and who can see what
set local role authenticated;
select cs_test.as_user('00000000-0000-0000-0000-0000000000e3'); -- plain member
select cs_test.check('the default list is people who ordered', (select count(*) = 1 and bool_and(lower(email) = 'guest@example.com' and order_count = 2) from list_customers('a0000000-0000-0000-0000-0000000000e1')));
select cs_test.check('"registered" lists people who signed up and have not ordered',
  (select count(*) = 3 and bool_and(order_count = 0 and registered_at is not null and last_order_at is null) from list_customers('a0000000-0000-0000-0000-0000000000e1', null, 25, 0, null, 'registered')));
select cs_test.check('"all" is both, and search works across them',
  (select count(*) = 4 from list_customers('a0000000-0000-0000-0000-0000000000e1', null, 25, 0, null, 'all'))
  and (select count(*) = 1 from list_customers('a0000000-0000-0000-0000-0000000000e1', 'imported', 25, 0, null, 'all')));
select id as reg_id from customers where email_key = 'old.account@example.com' \gset
select cs_test.check('one signed-up customer is found by id, whatever the scope',
  (select count(*) = 1 and bool_and(order_count = 0 and name = 'Old Account') from list_customers('a0000000-0000-0000-0000-0000000000e1', null, 25, 0, :'reg_id')));
select cs_test.fails('members cannot read the internal event table', $$ select * from customer_events $$);
select cs_test.as_user('00000000-0000-0000-0000-0000000000e4');
select cs_test.check('another workspace sees none of them',
  (select count(*) = 0 from list_customers('a0000000-0000-0000-0000-0000000000e1', null, 25, 0, null, 'all'))
  and (select count(*) = 0 from list_customers('a0000000-0000-0000-0000-0000000000e1', null, 25, 0, :'reg_id')));
reset role;

rollback;
\echo CUSTOMER SIGNUPS SQL CHECKS PASSED
