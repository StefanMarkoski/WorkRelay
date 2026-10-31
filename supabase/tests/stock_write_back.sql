-- Stock write-back (0043): off by default, owner-only to turn on, signed test first, checked again at claim and just before sending,
-- cancelled when switched off, limits, retries, the circuit breaker, conflicts that the owner decides, and nothing visible across workspaces.
begin;

create schema wb_test;
grant usage on schema wb_test to authenticated;
create function wb_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function wb_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- the message of the error a statement raises, or 'ok'
create function wb_test.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function wb_test.flush() returns void language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;
grant execute on all functions in schema wb_test to authenticated;

-- people: org A has an owner, an admin and a member; org B has its own owner; one platform admin
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@wb.dev'), ('00000000-0000-0000-0000-0000000000d2', 'admin@wb.dev'),
  ('00000000-0000-0000-0000-0000000000d3', 'member@wb.dev'), ('00000000-0000-0000-0000-0000000000d4', 'otherowner@wb.dev'),
  ('00000000-0000-0000-0000-0000000000d5', 'platform@wb.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'Org A', '00000000-0000-0000-0000-0000000000d1'),
  ('a0000000-0000-0000-0000-0000000000d4', 'Org B', '00000000-0000-0000-0000-0000000000d4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'admin'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d3', 'member'),
  ('a0000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d4', 'owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000d5');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Shop A', 'connected', 'wr_live_d001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000d1', true),
  ('a1000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'No estimates', 'connected', 'wr_live_d002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000d1', false);
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('a2000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'P1', 'Pen', 10, '2026-10-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'P2', 'Cap', 5, '2026-10-30 10:00+00');

-- ---------------------------------------------------------------- off by default, and the table itself refuses to be turned on
select wb_test.check('write-back is off for every shop by default',
  (select not bool_or(stock_push_enabled) from integrations));
select wb_test.check('even a direct write cannot turn it on without a URL, a secret and a passed test',
  wb_test.err($$update integrations set stock_push_enabled = true where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like '%stock_push_requires%');

-- ---------------------------------------------------------------- the settings can only be changed through the functions
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1'); -- even the owner, writing the table directly
select wb_test.check('a browser cannot write any write-back setting directly, not even the owner',
  wb_test.err($$update integrations set stock_push_url = 'https://evil.example.com/x' where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like 'permission denied%'
  and wb_test.err($$update integrations set stock_push_enabled = true where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like 'permission denied%'
  and wb_test.err($$update integrations set stock_push_verified_at = now() where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like 'permission denied%'
  and wb_test.err($$update integrations set stock_push_locked = false where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like 'permission denied%'
  and wb_test.err($$update integrations set stock_push_secret_id = gen_random_uuid() where id = 'a1000000-0000-0000-0000-0000000000d1'$$) like 'permission denied%'
  and wb_test.err($$update products set last_pushed_stock = 1$$) like 'permission denied%');
reset role;

-- ---------------------------------------------------------------- who may change what
select wb_test.as_user('00000000-0000-0000-0000-0000000000d2'); -- admin
select wb_test.check('an admin cannot set the stock address',
  wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com/stock')$$) = 'forbidden');
select wb_test.check('an admin cannot create the signing secret',
  wb_test.err($$select rotate_stock_push_secret('a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select wb_test.as_user('00000000-0000-0000-0000-0000000000d4'); -- owner of another workspace
select wb_test.check('the owner of another workspace cannot touch this shop',
  wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com/stock')$$) = 'forbidden'
  and wb_test.err($$select rotate_stock_push_secret('a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden'
  and wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', false)$$) = 'forbidden');

select wb_test.as_user('00000000-0000-0000-0000-0000000000d1'); -- owner
select wb_test.check('only https addresses of a public name are accepted',
  wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'http://shop.example.com/stock')$$) like 'Use a full https%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://user:pw@shop.example.com/stock')$$) like 'Use a full https%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://localhost/stock')$$) like 'Use the shop%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://10.0.0.5/stock')$$) like 'Use the shop%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://intranet/stock')$$) like 'Use the shop%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://db.internal/stock')$$) like 'Use the shop%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com/a b')$$) like 'Use a full https%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com:8443/stock')$$) like 'Use a full https%'
  and wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com:22/stock')$$) like 'Use a full https%');
select wb_test.check('the owner can set a proper address', wb_test.err($$select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://shop.example.com/workrelay/stock')$$) = 'ok');

-- ---------------------------------------------------------------- the order of things: secret, test, then on
select wb_test.check('cannot switch on before there is a secret',
  wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'Create a signing secret%');
create temp table wb_secret (s text);
grant all on wb_secret to authenticated;
insert into wb_secret select rotate_stock_push_secret('a1000000-0000-0000-0000-0000000000d1');
select wb_test.check('the secret is shown once, with a recognisable prefix and 256 bits', (select s ~ '^wr_sign_[0-9a-f]{64}$' from wb_secret));
select wb_test.check('a browser cannot read the secret or where it is kept',
  wb_test.err($$select stock_push_secret_id from integrations$$) like 'permission denied%'
  and wb_test.err($$select secret_version from stock_push_requests$$) like 'permission denied%');
select wb_test.check('cannot switch on before the signed test has passed',
  wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'Send a test first%');

reset role;
-- the test: only the owner may start it
select wb_test.check('a member cannot start the test [' || wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1')$$) || ']',
  wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select wb_test.check('an admin cannot start the test [' || wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1')$$) || ']',
  wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
create temp table wb_test1 as select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1');
select wb_test.check('the owner gets the address, the secret and a challenge to have echoed',
  (select url = 'https://shop.example.com/workrelay/stock' and secret = (select s from wb_secret) and length(challenge) = 32 and store_id = 's1' from wb_test1));
select wb_test.check('tests are limited to one every 10 seconds',
  wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'too_soon');
select finish_stock_push_test((select request_id from wb_test1), true, 200, null);
select wb_test.check('a passed test verifies the shop', (select stock_push_verified_at is not null from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));

select wb_test.as_user('00000000-0000-0000-0000-0000000000d2');
select wb_test.check('an admin cannot switch it on, even after the test',
  wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'Only the workspace owner%');
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select wb_test.check('a shop that does not estimate cannot be switched on',
  wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d2', true)$$) like 'Switch on "Estimate%');
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);
select wb_test.check('the owner switches it on', (select stock_push_enabled from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));

-- a changed address or a new secret means a new destination: off again, and it has to be tested again
select set_stock_push_url('a1000000-0000-0000-0000-0000000000d1', 'https://other.example.com/stock');
select wb_test.check('changing the address switches it off and drops the verification',
  (select not stock_push_enabled and stock_push_verified_at is null from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));

-- a test that finishes after the address changed does not verify the new address
reset role;
update stock_push_requests set created_at = now() - interval '1 minute' where kind = 'test';
create temp table wb_test2 as select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1');
update stock_push_requests set created_at = now() - interval '1 minute' where id = (select request_id from wb_test2);
update integrations set stock_push_url = 'https://third.example.com/stock' where id = 'a1000000-0000-0000-0000-0000000000d1';
select finish_stock_push_test((select request_id from wb_test2), true, 200, null);
select wb_test.check('a test for an old address verifies nothing',
  (select stock_push_verified_at is null from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));

-- verify the current address properly, then switch on for the rest
update stock_push_requests set created_at = now() - interval '1 minute' where kind = 'test';
create temp table wb_test3 as select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1');
select finish_stock_push_test((select request_id from wb_test3), true, 200, null);
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);

-- turning estimating off turns write-back off with it
select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000d1', false);
select wb_test.check('switching estimating off switches write-back off',
  (select not stock_push_enabled and stock_push_paused_reason like '%estimating%' from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));
select wb_test.check('and it cannot come back on until estimating does',
  wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'Switch on "Estimate%');
select set_integration_estimate_stock('a1000000-0000-0000-0000-0000000000d1', true);
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);

-- ---------------------------------------------------------------- orders queue numbers
reset role;
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'O1', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d1', 0, 'P1', 'x', 3);
select wb_test.flush();
select wb_test.check('an order queues the new absolute number for its product: 10 - 3 = 7',
  (select count(*) = 1 and bool_and(stock = 7 and sku = 'P1' and status = 'pending' and reason = 'order') from stock_push_items));

insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'O2', '2026-10-30 12:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d2', 0, 'P1', 'x', 2);
select wb_test.flush();
select wb_test.check('a second order replaces the waiting number instead of adding another: one row, now 5',
  (select count(*) = 1 and bool_and(stock = 5) from stock_push_items where status = 'pending' and sku = 'P1'));

insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'O3', '2026-10-30 13:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d3', 0, 'P2', 'x', 9);
select wb_test.flush();
select wb_test.check('an estimate below zero is never queued to send: it is logged as skipped, with the reason',
  (select count(*) = 1 and bool_and(stock is null and note like '%not sent%') from stock_push_items where sku = 'P2' and status = 'skipped')
  and (select count(*) = 0 from stock_push_items where sku = 'P2' and status = 'pending'));

-- a return gives the pieces back, and the number follows
update orders set fulfillment_status = 'returned' where id = 'a3000000-0000-0000-0000-0000000000d2';
select wb_test.flush();
select wb_test.check('marking an order returned queues the higher number: 10 - 3 = 7 again',
  (select count(*) = 1 and bool_and(stock = 7) from stock_push_items where status = 'pending' and sku = 'P1'));

-- a shop with write-back off queues nothing
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('a2000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d2', 'Q1', 'Plain', 10, '2026-10-30 10:00+00');
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d4', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d2', 'O4', '2026-10-30 13:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d4', 0, 'Q1', 'x', 1);
select wb_test.flush();
select wb_test.check('a shop that has write-back off queues nothing', (select count(*) = 0 from stock_push_items where sku = 'Q1'));

-- ---------------------------------------------------------------- claiming and sending
create temp table wb_claim1 as select * from claim_stock_pushes();
select wb_test.check('the engine claims one request for the shop, with the number and a sequence',
  (select count(*) = 1 and bool_and(url = 'https://third.example.com/stock' and jsonb_array_length(items) = 1 and (items->0->>'stock')::int = 7 and items->0->>'sku' = 'P1') from wb_claim1));
select wb_test.check('the claimed SKUs are marked as being sent', (select count(*) = 1 from stock_push_items where status = 'sending' and sku = 'P1'));
select wb_test.check('only one request is out per shop: nothing more is claimed meanwhile', (select count(*) = 0 from claim_stock_pushes()));
select wb_test.check('the check just before sending says yes while everything holds', stock_push_still_allowed((select request_id from wb_claim1)));

-- switching off while a request is waiting to leave: the last check refuses
select wb_test.as_user('00000000-0000-0000-0000-0000000000d3'); -- a plain member
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', false);
select wb_test.check('any member may switch write-back off', (select not stock_push_enabled from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));
select wb_test.check('but a member cannot switch it on', wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'Only the workspace owner%');
reset role;
create temp table wb_allowed as select stock_push_still_allowed((select request_id from wb_claim1)) as ok;
select wb_test.check('the last check before sending now says no, and cancels the request and its numbers',
  (select not ok from wb_allowed)
  and (select status = 'cancelled' from stock_push_requests where id = (select request_id from wb_claim1))
  and (select count(*) = 0 from stock_push_items where status in ('pending', 'sending')));
select wb_test.check('nothing is claimed for a shop that is off', (select count(*) = 0 from claim_stock_pushes()));
select complete_stock_push((select request_id from wb_claim1), true, 200, null);
select wb_test.check('a stale answer for a cancelled request changes nothing', (select count(*) = 0 from stock_push_items where status = 'sent')
  and (select status = 'cancelled' from stock_push_requests where id = (select request_id from wb_claim1)));

-- back on (the verification is still valid for the same address and secret)
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);
reset role;
update orders set fulfillment_status = 'unfulfilled' where id = 'a3000000-0000-0000-0000-0000000000d2';
select wb_test.flush();
create temp table wb_claim2 as select * from claim_stock_pushes();
select wb_test.check('a new change is claimed again once it is on', (select count(*) = 1 from wb_claim2));
select complete_stock_push((select request_id from wb_claim2), true, 200, null);
select wb_test.check('a success marks the SKUs sent and remembers what was told to the shop',
  (select count(*) >= 1 and bool_and(status = 'sent') from stock_push_items where request_id = (select request_id from wb_claim2))
  and (select last_pushed_stock = 5 and last_pushed_at is not null from products where id = 'a2000000-0000-0000-0000-0000000000d1'));

-- ---------------------------------------------------------------- failures: retries, then the circuit breaker
update orders set fulfillment_status = 'returned' where id = 'a3000000-0000-0000-0000-0000000000d2';
select wb_test.flush();
create temp table wb_claim3 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from wb_claim3), false, 500, 'The shop answered with HTTP 500.');
select wb_test.check('a failed request returns its numbers to the queue for a later try, noting why',
  (select count(*) = 1 and bool_and(attempts = 1 and note like '%HTTP 500%' and due_at > now()) from stock_push_items where status = 'pending' and sku = 'P1'));
select wb_test.check('the retry is not claimed before it is due', (select count(*) = 0 from claim_stock_pushes()));
update stock_push_items set due_at = now() where status = 'pending';
create temp table wb_claim4 as select * from claim_stock_pushes();
select wb_test.check('once due it is claimed again, on a new request', (select count(*) = 1 and bool_and(request_id <> (select request_id from wb_claim3)) from wb_claim4));
select complete_stock_push((select request_id from wb_claim4), false, 500, 'The shop answered with HTTP 500.');
update stock_push_items set due_at = now() where status = 'pending';
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1'; -- out of the rate-limit minute
create temp table wb_claim5 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from wb_claim5), false, 500, 'The shop answered with HTTP 500.');
select wb_test.check('after the third try the number is given up on and marked failed',
  (select count(*) = 1 from stock_push_items where status = 'failed' and sku = 'P1' and attempts = 3));
select wb_test.check('three failed requests so far: still on', (select stock_push_enabled and stock_push_failures = 3 from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));
-- two more failed requests in a row
update orders set status = 'cancelled' where id = 'a3000000-0000-0000-0000-0000000000d1';
select wb_test.flush();
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
create temp table wb_claim6 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from wb_claim6), false, null, 'The request timed out.');
update stock_push_items set due_at = now() where status = 'pending';
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
create temp table wb_claim7 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from wb_claim7), false, null, 'The request timed out.');
select wb_test.check('five failed requests in a row switch write-back off by itself, with the reason, and drop what is waiting',
  (select not stock_push_enabled and stock_push_paused_reason like 'Switched off after 5 failed%timed out%' from integrations where id = 'a1000000-0000-0000-0000-0000000000d1')
  and (select count(*) = 0 from stock_push_items where status in ('pending', 'sending')));

-- ---------------------------------------------------------------- limits
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);
reset role;
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
insert into products (organization_id, integration_id, sku, name, stock, reported_at)
select 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'B' || g, 'Bulk ' || g, 100, '2026-10-30 10:00+00' from generate_series(1, 150) g;
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason)
select p.organization_id, p.integration_id, p.id, p.sku, 99, 'order' from products p where p.sku like 'B%';
create temp table wb_claim8 as select * from claim_stock_pushes();
select wb_test.check('a request carries at most 100 SKUs', (select jsonb_array_length(items) = 100 from wb_claim8));
select complete_stock_push((select request_id from wb_claim8), true, 200, null);
insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version, status, finished_at)
select 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', 'stock', 'https://third.example.com/stock',
       (select stock_push_secret_version from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'), 'ok', now()
from generate_series(1, 20);
create temp table wb_claim9 as select * from claim_stock_pushes();
select wb_test.check('more than 20 requests in a minute: nothing more is claimed until the minute is over', (select count(*) = 0 from wb_claim9));
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
create temp table wb_claim10 as select * from claim_stock_pushes();
select wb_test.check('and the 50 left over go out in the next request', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 50) from wb_claim10));
-- a request nobody reported back on
update stock_push_requests set created_at = now() - interval '3 minutes' where status = 'sending';
create temp table wb_claim11 as select * from claim_stock_pushes();
select wb_test.check('a request with no recorded answer is counted as failed and its numbers are tried again later',
  (select count(*) = 0 from wb_claim11) and (select count(*) = 50 from stock_push_items where status = 'pending' and attempts = 1 and due_at > now())
  and (select count(*) = 1 from stock_push_requests where status = 'failed' and error like 'No answer%'));

-- ---------------------------------------------------------------- conflicts: the owner decides
delete from stock_push_items where status = 'pending';
update products set last_pushed_stock = 5, last_pushed_at = now() where id = 'a2000000-0000-0000-0000-0000000000d1';
update products set stock = 10, reported_at = '2026-10-30 10:00+00' where id = 'a2000000-0000-0000-0000-0000000000d1';
-- the order list gives WorkRelay's number: cancel O1 and return O2 -> the estimate is 10; the push told the shop 5 earlier. Now the shop reports 8.
select run_product_sync('a1000000-0000-0000-0000-0000000000d1', '[{"sku":"P1","stock":8}]', 'push', '2026-10-31 09:00+00', 'shop');
select wb_test.check('a report that disagrees with what WorkRelay pushed opens a conflict with both numbers',
  (select count(*) = 1 and bool_and(sku = 'P1' and shop_value = 8 and workrelay_value = 10 and status = 'open') from stock_conflicts));
select wb_test.check('and the push has been judged: it is forgotten', (select last_pushed_at is null from products where id = 'a2000000-0000-0000-0000-0000000000d1'));

select wb_test.as_user('00000000-0000-0000-0000-0000000000d2');
select wb_test.check('an admin cannot decide a conflict',
  wb_test.err($$select resolve_stock_conflict((select id from stock_conflicts limit 1), 'shop')$$) = 'forbidden');
select wb_test.as_user('00000000-0000-0000-0000-0000000000d4');
select wb_test.check('another workspace cannot see it or decide it',
  (select count(*) = 0 from stock_conflicts) and (select count(*) = 0 from list_stock_conflicts('a0000000-0000-0000-0000-0000000000d1', 'all'))
  and wb_test.err($$select resolve_stock_conflict((select id from stock_conflicts limit 1), 'shop')$$) <> 'ok');
select wb_test.as_user('00000000-0000-0000-0000-0000000000d3');
select wb_test.check('a member can see the conflict', (select count(*) = 1 from list_stock_conflicts('a0000000-0000-0000-0000-0000000000d1')));
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select resolve_stock_conflict((select id from stock_conflicts where status = 'open'), 'workrelay');
select wb_test.check('the owner picks WorkRelay: its number goes into the queue as a conflict push',
  (select status = 'sent_workrelay' from stock_conflicts)
  and (select count(*) = 1 and bool_and(stock = 10 and reason = 'conflict' and sku = 'P1') from stock_push_items where status = 'pending'));
select wb_test.check('a conflict cannot be decided twice',
  wb_test.err($$select resolve_stock_conflict((select id from stock_conflicts limit 1), 'shop')$$) like 'This conflict was already decided%');

-- picking the shop closes it without sending anything; a report that agrees closes it by itself
reset role;
delete from stock_push_items where status = 'pending';
update products set last_pushed_stock = 8, last_pushed_at = now() where id = 'a2000000-0000-0000-0000-0000000000d1';
select run_product_sync('a1000000-0000-0000-0000-0000000000d1', '[{"sku":"P1","stock":4}]', 'push', '2026-10-31 10:00+00', 'shop');
select wb_test.check('a second disagreement opens a new conflict', (select count(*) = 1 from stock_conflicts where status = 'open'));
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select resolve_stock_conflict((select id from stock_conflicts where status = 'open'), 'shop');
select wb_test.check('keeping the shop''s number sends nothing', (select count(*) = 0 from stock_push_items where status = 'pending')
  and (select count(*) = 1 from stock_conflicts where status = 'kept_shop'));
reset role;
update products set last_pushed_stock = 4, last_pushed_at = now() where id = 'a2000000-0000-0000-0000-0000000000d1';
select run_product_sync('a1000000-0000-0000-0000-0000000000d1', '[{"sku":"P1","stock":9}]', 'push', '2026-10-31 11:00+00', 'shop');
select wb_test.check('a third disagreement (shop says 9, WorkRelay had 4) opens a conflict', (select count(*) = 1 and bool_and(shop_value = 9 and workrelay_value = 4) from stock_conflicts where status = 'open'));
update products set last_pushed_stock = 9, last_pushed_at = now() where id = 'a2000000-0000-0000-0000-0000000000d1';
select run_product_sync('a1000000-0000-0000-0000-0000000000d1', '[{"sku":"P1","stock":9}]', 'push', '2026-10-31 12:00+00', 'shop');
select wb_test.check('a report that agrees with WorkRelay''s number closes the open conflict by itself',
  (select count(*) = 0 from stock_conflicts where status = 'open') and (select count(*) = 1 from stock_conflicts where status = 'agreed'));

-- ---------------------------------------------------------------- the platform lock, and revoking
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select wb_test.check('an ordinary owner cannot lock a shop', wb_test.err($$select admin_set_stock_push_locked('a1000000-0000-0000-0000-0000000000d1', true)$$) = 'forbidden');
select wb_test.as_user('00000000-0000-0000-0000-0000000000d5');
select admin_set_stock_push_locked('a1000000-0000-0000-0000-0000000000d1', true);
reset role;
select wb_test.check('a platform admin can lock a shop, which switches it off', (select not stock_push_enabled and stock_push_locked from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select wb_test.check('a locked shop cannot be switched on by its owner', wb_test.err($$select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true)$$) like 'WorkRelay has blocked%');
reset role;
update integrations set stock_push_locked = false where id = 'a1000000-0000-0000-0000-0000000000d1';
select wb_test.as_user('00000000-0000-0000-0000-0000000000d1');
select set_stock_push_enabled('a1000000-0000-0000-0000-0000000000d1', true);
select revoke_integration('a1000000-0000-0000-0000-0000000000d1');
select wb_test.check('revoking the connection switches write-back off',
  (select not stock_push_enabled and status = 'revoked' from integrations where id = 'a1000000-0000-0000-0000-0000000000d1'));

-- ---------------------------------------------------------------- nothing leaks between workspaces
select wb_test.as_user('00000000-0000-0000-0000-0000000000d4');
select wb_test.check('another workspace sees no requests, no numbers, no conflicts of this one',
  (select count(*) = 0 from stock_push_requests) and (select count(*) = 0 from stock_push_items) and (select count(*) = 0 from stock_conflicts)
  and (select count(*) = 0 from list_stock_pushes('a0000000-0000-0000-0000-0000000000d1')));
select wb_test.as_user('00000000-0000-0000-0000-0000000000d3');
select wb_test.check('members of the workspace can read the log', (select count(*) > 0 from list_stock_pushes('a0000000-0000-0000-0000-0000000000d1')));
select wb_test.check('nobody can write the log from a browser',
  wb_test.err($$insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason) values ('a0000000-0000-0000-0000-0000000000d1','a1000000-0000-0000-0000-0000000000d1','a2000000-0000-0000-0000-0000000000d1','P1',1,'order')$$) like 'permission denied%'
  and wb_test.err($$select claim_stock_pushes()$$) like 'permission denied%'
  and wb_test.err($$select complete_stock_push(gen_random_uuid(), true, 200, null)$$) like 'permission denied%'
  and wb_test.err($$select stock_push_still_allowed(gen_random_uuid())$$) like 'permission denied%'
  and wb_test.err($$select * from begin_stock_push_test('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')$$) like 'permission denied%');

do $$ begin raise notice 'STOCK WRITE-BACK CHECKS PASSED'; end $$;
rollback;
