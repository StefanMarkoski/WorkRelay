-- Pull first (0046): WorkRelay reads the shop's own numbers before it sends its own and once more after, a disagreement holds the number
-- and waits for the owner, the sync history shows both directions, and nothing the API role refuses (a bare DELETE or UPDATE) is used.
begin;

create schema pf_test;
grant usage on schema pf_test to authenticated;
create function pf_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function pf_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pf_test.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pf_test.flush() returns void language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end $$;
-- a suspected difference waits 90 seconds for a late order; the tests age it, then let it be judged
create function pf_test.settle() returns void language plpgsql as $$
begin
  update stock_suspects set first_seen = now() - interval '5 minutes' where true;
  perform settle_stock_suspects();
end $$;
-- the engine's read marks the waiting numbers as read; tests stand in for it
create function pf_test.read_all() returns void language plpgsql as $$
begin
  update stock_push_items set read_at = clock_timestamp() where status = 'pending';
end $$;
grant execute on all functions in schema pf_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@pf.dev'), ('00000000-0000-0000-0000-0000000000e3', 'member@pf.dev'),
  ('00000000-0000-0000-0000-0000000000e4', 'other@pf.dev'), ('00000000-0000-0000-0000-0000000000e5', 'platform@pf.dev');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000e5');
insert into organizations (id, name, created_by) values
  ('b0000000-0000-0000-0000-0000000000e1', 'Org A', '00000000-0000-0000-0000-0000000000e1'),
  ('b0000000-0000-0000-0000-0000000000e4', 'Org B', '00000000-0000-0000-0000-0000000000e4');
insert into memberships values
  ('b0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('b0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'member'),
  ('b0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e4', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('b1000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000e1', 'Shop', 'connected', 'wr_live_e001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000e1', true);
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P1', 'Pen', 10, '2026-10-30 10:00+00'),
  ('b2000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P2', 'Cap', 5, '2026-10-30 10:00+00');

-- the owner sets the shop up: address, secret, a passed test (stood in for), and the product feed address
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select set_stock_push_url('b1000000-0000-0000-0000-0000000000e1', 'https://shop.example.com/workrelay/stock');
select length(rotate_stock_push_secret('b1000000-0000-0000-0000-0000000000e1'));
reset role;
update integrations set stock_push_verified_at = now() where id = 'b1000000-0000-0000-0000-0000000000e1';

-- ---------------------------------------------------------------- switching on needs the shop's product feed
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select pf_test.check('write-back cannot be switched on without a product feed address: WorkRelay reads the shop first',
  pf_test.err($$select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', true)$$) like 'Add the shop''s product feed address first%');
reset role;
insert into integration_sync (integration_id, organization_id, source_url) values
  ('b1000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000e1', 'https://shop.example.com/feed');
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', true);
reset role;
select pf_test.check('with a feed address it switches on', (select stock_push_enabled from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));

-- ---------------------------------------------------------------- nothing is sent before the shop was read
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O1', '2026-10-30 11:00+00', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e1', 0, 'P1', 'x', 3);
select pf_test.flush();
select pf_test.check('an order queues the number 10 - 3 = 7', (select count(*) = 1 and bool_and(stock = 7 and status = 'pending') from stock_push_items));
select pf_test.check('but nothing is claimed while the shop has not been read', (select count(*) = 0 from claim_stock_pushes()));
create temp table pf_pulls1 as select * from claim_pre_push_pulls();
select pf_test.check('the shop is asked to be read first, with its feed address, before the push',
  (select count(*) = 1 and bool_and(phase = 'before_push' and source_url = 'https://shop.example.com/feed') from pf_pulls1));
select pf_test.check('and not twice at once: nobody else reads it for the next 30 seconds', (select count(*) = 0 from claim_pre_push_pulls()));

-- the shop already took the order off its own stock: it reports 7, which is what WorkRelay believes. Nothing to send.
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P1","stock":7},{"sku":"P2","stock":5}]', 'pull', now(), 'before_push');
select pf_test.settle();
select pf_test.check('the read is in the sync history as a read before pushing, and says the same number: no conflict',
  (select count(*) = 1 and bool_and(source = 'pull' and trigger = 'before_push') from product_sync_runs) and (select count(*) = 0 from stock_conflicts));
create temp table pf_c0 as select * from claim_stock_pushes();
select pf_test.check('nothing is claimed: the shop already has the number', (select count(*) = 0 from pf_c0));
select pf_test.check('the number is dropped with the reason', (select count(*) = 1 from stock_push_items where status = 'cancelled' and note = 'The shop already has this number.'));

-- ---------------------------------------------------------------- the shop was restocked behind WorkRelay's back
update products set reported_at = now() - interval '1 hour' where integration_id = 'b1000000-0000-0000-0000-0000000000e1'; -- the earlier read is an hour old
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O2', now() - interval '30 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e2', 0, 'P2', 'x', 1);
select pf_test.flush();
select pf_test.check('an order for the cap queues 5 - 1 = 4', (select count(*) = 1 and bool_and(stock = 4) from stock_push_items where status = 'pending' and sku = 'P2'));
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P2","stock":20}]', 'pull', now(), 'before_push');
select pf_test.settle();
select pf_test.check('the shop reports 20 although WorkRelay believed 5 - 1: that is a conflict, not an overwrite',
  (select count(*) = 1 and bool_and(sku = 'P2' and shop_value = 20 and workrelay_value = 4 and status = 'open') from stock_conflicts));
select pf_test.check('the waiting number is held with the reason', (select count(*) = 0 from stock_push_items where status = 'pending' and sku = 'P2')
  and (select count(*) = 1 from stock_push_items where status = 'cancelled' and note like 'Held: the shop reports 20 but WorkRelay had 4%'));
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O3', now() - interval '20 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e3', 0, 'P2', 'x', 1);
select pf_test.flush();
select pf_test.check('a new order for a product with an open conflict queues nothing', (select count(*) = 0 from stock_push_items where status = 'pending'));

-- ---------------------------------------------------------------- the owner decides for WorkRelay: its number is sent, and is not a new conflict
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select resolve_stock_conflict((select id from stock_conflicts where status = 'open'), 'workrelay');
reset role;
select pf_test.check('the chosen number is queued as chosen: 4, less what sold since', (select count(*) = 1 and bool_and(stock = 4 and reason = 'conflict' and sku = 'P2') from stock_push_items where status = 'pending'));
update integrations set stock_push_pulled_at = clock_timestamp() where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.read_all();
create temp table pf_claim1 as select * from claim_stock_pushes();
select pf_test.check('after a fresh read it is sent, with what the shop last reported next to it so the shop can tell if its own number moved',
  (select count(*) = 1 from pf_claim1)
  and (select bool_and((i->>'sku') = 'P2' and (i->>'stock')::int = 4 and (i->>'reported_stock')::int = 20 and i->>'reported_at' is not null and i->>'as_of' is not null)
       from pf_claim1, jsonb_array_elements(items) i));
select complete_stock_push((select request_id from pf_claim1), true, 200, null);
select pf_test.check('a successful push asks for one more read, to check the shop took it',
  (select stock_push_verify and stock_push_failures = 0 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
update integrations set stock_push_pull_claimed_at = null, stock_push_pulled_at = now() - interval '1 minute' where id = 'b1000000-0000-0000-0000-0000000000e1'; -- the last read came before the push finished
create temp table pf_pulls2 as select * from claim_pre_push_pulls();
select pf_test.check('and that read is claimed as a check after pushing', (select count(*) = 1 and bool_and(phase = 'after_push') from pf_pulls2));
select pf_test.check('nothing more is sent until it has happened', (select count(*) = 0 from claim_stock_pushes()));
-- the shop applied the number: it reports 4. WorkRelay's own estimate still starts from the report of 20, but the push was acknowledged.
update products set reported_at = now() - interval '2 minutes' where id = 'b2000000-0000-0000-0000-0000000000e2';
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P2","stock":4}]', 'pull', clock_timestamp(), 'after_push');
select pf_test.settle();
select pf_test.check('the shop took the number: no new conflict, the number WorkRelay shows follows the shop',
  (select count(*) = 0 from stock_conflicts where status = 'open')
  and (select count(*) = 1 from stock_conflicts where status = 'sent_workrelay')
  and (select stock = 4 from products where id = 'b2000000-0000-0000-0000-0000000000e2'));
select pf_test.check('the check after the push is done: no more reads until there is something to send',
  (select not stock_push_verify from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.check('and nothing is claimed for a read', (select count(*) = 0 from claim_pre_push_pulls()));

-- ---------------------------------------------------------------- the shop did NOT take the number
-- the owner decides for WorkRelay once more; the shop acknowledges with 200 but its next report disagrees: that is a conflict again
insert into stock_conflicts (organization_id, integration_id, product_id, sku, workrelay_value, shop_value, status, decided_at)
values ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e2', 'P2', 4, 9, 'kept_shop', now());
update products set last_pushed_stock = 4, last_pushed_at = now(), reported_at = now() - interval '2 minutes' where id = 'b2000000-0000-0000-0000-0000000000e2';
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P2","stock":11}]', 'pull', clock_timestamp(), 'after_push');
select pf_test.settle();
select pf_test.check('a shop that says 200 but still reports another number is a conflict',
  (select count(*) = 1 and bool_and(shop_value = 11 and workrelay_value = 4) from stock_conflicts where status = 'open'));

-- ---------------------------------------------------------------- reads that fail count like failed requests
update stock_conflicts set status = 'kept_shop', decided_at = now() where status = 'open';
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e4', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O4', now() - interval '10 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e4', 0, 'P1', 'x', 2);
select pf_test.flush();
select pf_test.check('a number is waiting for the read', (select count(*) = 1 from stock_push_items where status = 'pending' and sku = 'P1'));
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'The shop answered with HTTP 503');
select pf_test.check('a failed read makes the number wait and counts as a failure',
  (select stock_push_failures = 1 and stock_push_enabled and stock_push_pull_claimed_at > now() from integrations where id = 'b1000000-0000-0000-0000-0000000000e1')
  and (select count(*) = 1 from stock_push_items where status = 'pending' and due_at > now() and note like 'Waiting: WorkRelay could not read the shop%503%'));
select pf_test.check('and the next read is not tried at once', (select count(*) = 0 from claim_pre_push_pulls()));
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'The shop answered with HTTP 503');
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'The shop answered with HTTP 503');
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'The shop answered with HTTP 503');
select pf_test.check('four failures: still on', (select stock_push_enabled and stock_push_failures = 4 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'The shop answered with HTTP 503');
select pf_test.check('five failures in a row switch write-back off, with the reason, and drop what is waiting',
  (select not stock_push_enabled and stock_push_paused_reason like 'Switched off after 5 failed%503%' from integrations where id = 'b1000000-0000-0000-0000-0000000000e1')
  and (select count(*) = 0 from stock_push_items where status in ('pending', 'sending')));

-- ---------------------------------------------------------------- the feed address is a condition for staying on
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', true);
reset role;
select pf_test.check('switched on again', (select stock_push_enabled from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
update integration_sync set paused = true where integration_id = 'b1000000-0000-0000-0000-0000000000e1';
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e5', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O5', now() - interval '5 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e5', 0, 'P1', 'x', 1);
select pf_test.flush();
update integrations set stock_push_pull_claimed_at = null, stock_push_pulled_at = now() - interval '5 minutes' where id = 'b1000000-0000-0000-0000-0000000000e1'; -- the last read is old
select pf_test.check('a feed that the platform has paused is not read, so nothing is sent for that shop',
  (select count(*) = 0 from claim_pre_push_pulls()) and (select count(*) = 0 from claim_stock_pushes()));
update integration_sync set paused = false where integration_id = 'b1000000-0000-0000-0000-0000000000e1';
update integration_sync set source_url = null where integration_id = 'b1000000-0000-0000-0000-0000000000e1';
select count(*) from claim_stock_pushes();
select pf_test.check('a shop whose feed address was removed is switched off with the reason, and nothing waits',
  (select not stock_push_enabled and stock_push_paused_reason like 'Switched off: the shop''s product feed address was removed%' from integrations where id = 'b1000000-0000-0000-0000-0000000000e1')
  and (select count(*) = 0 from stock_push_items where status in ('pending', 'sending')));
update integration_sync set source_url = 'https://shop.example.com/feed' where integration_id = 'b1000000-0000-0000-0000-0000000000e1';

-- ---------------------------------------------------------------- a queueing failure leaves a trace
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', true);
reset role;
select log_stock_push_queue_failure(array['b2000000-0000-0000-0000-0000000000e1']::uuid[], 'boom');
select pf_test.check('a queueing failure is logged as a skipped number with the reason, not only as a database warning',
  (select count(*) = 1 and bool_and(stock is null and note like 'Not queued%boom') from stock_push_items where status = 'skipped' and sku = 'P1' and note like 'Not queued%'));

-- ---------------------------------------------------------------- the history shows both directions, the issues and what was decided
select pf_test.as_user('00000000-0000-0000-0000-0000000000e3');
create temp table pf_hist as select * from list_sync_runs('b0000000-0000-0000-0000-0000000000e1');
select pf_test.check('the sync history lists reads of the shop and requests sent to it, and a member can see it',
  (select count(*) filter (where source = 'pull' and trigger = 'before_push') >= 2 and count(*) filter (where source = 'pull' and trigger = 'after_push') >= 1
          and count(*) filter (where source = 'send') = 1 from pf_hist));
select pf_test.check('a request to the shop says how many numbers it carried and how many came from a decision for WorkRelay',
  (select bool_and(received = 1 and changed = 1 and issues = 1 and status = 'ok' and trigger is null) from pf_hist where source = 'send'));
select pf_test.check('a read says how many conflicts it opened, and what was decided about each is one call away',
  (select count(*) >= 1 from pf_hist where source = 'pull' and issues >= 1)
  and (select count(*) >= 1 and bool_or(status in ('sent_workrelay', 'kept_shop')) from sync_run_conflicts((select id from pf_hist where source = 'pull' and issues >= 1 order by created_at limit 1))));
select pf_test.as_user('00000000-0000-0000-0000-0000000000e4');
select pf_test.check('another workspace sees none of it',
  (select count(*) = 0 from list_sync_runs('b0000000-0000-0000-0000-0000000000e1'))
  and (select count(*) = 0 from sync_run_conflicts((select id from product_sync_runs limit 1))));
reset role;
select pf_test.check('only the known triggers are accepted', pf_test.err($$select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[]', 'pull', now(), 'whenever')$$) like '%product_sync_runs_trigger_check%');

-- ---------------------------------------------------------------- a shop that refuses a batch over one SKU
reset role;
delete from stock_push_items where status in ('pending', 'sending');
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e1', 'P1', 3, 'conflict'),
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e2', 'P2', 4, 'conflict');
update integrations set stock_push_pulled_at = clock_timestamp(), stock_push_failures = 0 where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.read_all();
create temp table pf_batch as select * from claim_stock_pushes();
select pf_test.check('two numbers go out in one request', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 2) from pf_batch));
select complete_stock_push((select request_id from pf_batch), false, 400, 'The shop answered with HTTP 400.');
select pf_test.check('a 4xx for the batch splits it: both numbers wait to be sent on their own, no try is used up and it is not counted as a failed request',
  (select count(*) = 2 and bool_and(solo and attempts = 0 and due_at <= now()) from stock_push_items where status = 'pending')
  and (select stock_push_failures = 0 and stock_push_enabled from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
update integrations set stock_push_pulled_at = clock_timestamp() where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.read_all();
create temp table pf_solo1 as select * from claim_stock_pushes();
select pf_test.check('the next request carries one number', (select count(*) = 1 and bool_and(jsonb_array_length(items) = 1) from pf_solo1));
select complete_stock_push((select request_id from pf_solo1), false, 404, 'The shop answered with HTTP 404.');
select pf_test.check('a number the shop refuses on its own is given up on, not retried, and counted; the other one is untouched',
  (select count(*) = 1 and bool_and(note = 'The shop does not accept this number (HTTP 404).') from stock_push_items where status = 'failed')
  and (select count(*) = 1 from stock_push_items where status = 'pending' and solo)
  and (select stock_push_failures = 1 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
update integrations set stock_push_pulled_at = clock_timestamp() where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.read_all();
create temp table pf_solo2 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from pf_solo2), true, 200, null);
select pf_test.check('the other number goes through, and the failure count starts again',
  (select count(*) = 1 from stock_push_items where status = 'sent' and request_id = (select request_id from pf_solo2))
  and (select stock_push_failures = 0 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
-- a server error or a timeout is not the shop refusing a SKU: the usual retry, no split
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e1', 'P1', 2, 'conflict'),
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e2', 'P2', 1, 'conflict');
update integrations set stock_push_pulled_at = clock_timestamp() where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.read_all();
create temp table pf_batch2 as select * from claim_stock_pushes();
select complete_stock_push((select request_id from pf_batch2), false, 503, 'The shop answered with HTTP 503.');
select pf_test.check('a 5xx is retried as before, as a batch, and counted',
  (select count(*) = 2 and bool_and(not solo and attempts = 1 and due_at > now()) from stock_push_items where status = 'pending')
  and (select stock_push_failures = 1 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));

-- ---------------------------------------------------------------- the shop's address belongs to the owner
select pf_test.as_user('00000000-0000-0000-0000-0000000000e3');
select pf_test.check('a member cannot read the address, only whether one is saved',
  pf_test.err($$select stock_push_url from integrations$$) like 'permission denied%'
  and (select bool_and(stock_push_has_url) from integrations where id = 'b1000000-0000-0000-0000-0000000000e1')
  and pf_test.err($$select get_stock_push_url('b1000000-0000-0000-0000-0000000000e1')$$) = 'forbidden');
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select pf_test.check('the owner reads it through the function', get_stock_push_url('b1000000-0000-0000-0000-0000000000e1') = 'https://shop.example.com/workrelay/stock');

-- ---------------------------------------------------------------- another workspace's owner can do none of it (a permanent version of the cross-tenant probe)
reset role;
select set_config('pf.cid', (select id::text from stock_conflicts limit 1), false);
select pf_test.as_user('00000000-0000-0000-0000-0000000000e4');
select pf_test.check('the owner of another workspace cannot read, change, switch, test or decide anything of this shop',
  pf_test.err($$select get_stock_push_url('b1000000-0000-0000-0000-0000000000e1')$$) = 'forbidden'
  and pf_test.err($$select set_stock_push_url('b1000000-0000-0000-0000-0000000000e1', 'https://evil.example.com/x')$$) = 'forbidden'
  and pf_test.err($$select rotate_stock_push_secret('b1000000-0000-0000-0000-0000000000e1')$$) = 'forbidden'
  and pf_test.err($$select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', true)$$) = 'forbidden'
  and pf_test.err($$select set_stock_push_enabled('b1000000-0000-0000-0000-0000000000e1', false)$$) = 'forbidden'
  and pf_test.err($$select resolve_stock_conflict(current_setting('pf.cid')::uuid, 'workrelay')$$) = 'forbidden'
  and pf_test.err($$select admin_set_stock_push_locked('b1000000-0000-0000-0000-0000000000e1', true)$$) = 'forbidden'
  and pf_test.err($$select set_integration_estimate_stock('b1000000-0000-0000-0000-0000000000e1', false)$$) = 'forbidden'
  and (select count(*) = 0 from stock_conflicts) and (select count(*) = 0 from stock_push_items) and (select count(*) = 0 from stock_push_requests)
  and (select count(*) = 0 from stock_push_request_items((select id from stock_push_requests limit 1)))
  and (select count(*) = 0 from list_stock_conflicts('b0000000-0000-0000-0000-0000000000e1', 'all'))
  and (select count(*) = 0 from list_stock_pushes('b0000000-0000-0000-0000-0000000000e1')));
reset role;
select pf_test.check('and the shop is exactly as it was', (select stock_push_enabled and stock_push_url = 'https://shop.example.com/workrelay/stock' from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));

-- ---------------------------------------------------------------- the read compares with what WorkRelay believed when the shop was asked
reset role;
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P3', 'Mug', 10, now() - interval '1 hour'),
  ('b2000000-0000-0000-0000-0000000000e4', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P4', 'Bag', 10, now() - interval '1 hour');
-- both shops' customers ordered 1 three minutes ago (before the shop was asked) and 2 one minute ago (after it answered)
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000e6', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O6', now() - interval '3 minutes', 'pending', now()),
  ('b3000000-0000-0000-0000-0000000000e7', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O7', now() - interval '1 minute', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e6', 0, 'P3', 'x', 1),
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e6', 1, 'P4', 'x', 1),
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e7', 0, 'P3', 'x', 2),
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000e7', 1, 'P4', 'x', 2);
select pf_test.flush();
select pf_test.check('both products have a number waiting: 10 - 1 - 2 = 7', (select count(*) = 2 and bool_and(stock = 7) from stock_push_items where status = 'pending' and sku in ('P3', 'P4')));
-- the shop was asked 2 minutes ago. P3: it never deducted the first order (reports 10). P4: it deducted it (reports 9) but could not have seen the later one.
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P3","stock":10},{"sku":"P4","stock":9}]', 'pull', now() - interval '2 minutes', 'before_push');
select pf_test.settle();
select pf_test.check('the shop that did not deduct an order placed before it was asked is a real disagreement: WorkRelay believed 9, not 7',
  (select count(*) = 1 and bool_and(shop_value = 10 and workrelay_value = 9) from stock_conflicts where sku = 'P3' and status = 'open'));
select pf_test.check('the shop that deducted it, and has not seen the later order, agrees: an order placed after the shop answered is no disagreement',
  (select count(*) = 0 from stock_conflicts where sku = 'P4' and status = 'open'));

-- ---------------------------------------------------------------- a quiet read leaves no row
create temp table pf_rows0 as select count(*) as n from product_sync_runs where trigger = 'after_push';
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P4","stock":7}]', 'pull', clock_timestamp(), 'after_push');
select pf_test.settle();
select pf_test.check('a check that found a change is in the history', (select count(*) = (select n + 1 from pf_rows0) from product_sync_runs where trigger = 'after_push'));
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P4","stock":7}]', 'pull', clock_timestamp(), 'after_push');
select pf_test.settle();
select pf_test.check('the same numbers read again change nothing and leave no row',
  (select count(*) = (select n + 1 from pf_rows0) from product_sync_runs where trigger = 'after_push'));
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P4","stock":7}]', 'pull', clock_timestamp(), 'scheduled');
select pf_test.settle();
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P4","stock":7}]', 'pull', clock_timestamp(), 'manual');
select pf_test.settle();
select pf_test.check('but a scheduled read or a Sync now is always listed, even when nothing changed',
  (select count(*) >= 2 from product_sync_runs where trigger in ('scheduled', 'manual') and changed = 0));

-- ---------------------------------------------------------------- a late order is not a disagreement
reset role;
update stock_push_requests set created_at = now() - interval '5 minutes' where integration_id = 'b1000000-0000-0000-0000-0000000000e1';
insert into products (id, organization_id, integration_id, sku, name, stock, reported_at) values
  ('b2000000-0000-0000-0000-0000000000e5', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P5', 'Lamp', 10, now() - interval '1 hour'),
  ('b2000000-0000-0000-0000-0000000000e6', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'P6', 'Rug', 10, now() - interval '1 hour');
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000f0', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O10', now() - interval '3 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000f0', 0, 'P5', 'x', 1),
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000f0', 1, 'P6', 'x', 1);
select pf_test.flush();
-- the shop was asked a minute ago. P5: its shop took the first order AND a second one (3 pieces) that has not reached WorkRelay yet: it reports 6.
-- P6: nothing is on its way, and the shop reports 4.
select run_product_sync('b1000000-0000-0000-0000-0000000000e1', '[{"sku":"P5","stock":6},{"sku":"P6","stock":4}]', 'pull', now() - interval '1 minute', 'before_push');
select pf_test.check('a difference is first a suspect, not a conflict, and the numbers it concerns are held',
  (select count(*) = 2 from stock_suspects where sku in ('P5', 'P6')) and (select count(*) = 0 from stock_conflicts where sku in ('P5', 'P6'))
  and (select count(*) = 0 from stock_push_items where status = 'pending' and sku in ('P5', 'P6'))
  and (select count(*) = 2 from stock_push_items where status = 'cancelled' and sku in ('P5', 'P6') and note like 'Held: %Checking whether an order is still on its way.'));
select settle_stock_suspects();
select pf_test.check('90 seconds have not passed: nothing is decided yet', (select count(*) = 2 from stock_suspects where sku in ('P5', 'P6')) and (select count(*) = 0 from stock_conflicts where sku in ('P5', 'P6')));
insert into orders (id, organization_id, integration_id, external_id, placed_at, status, last_event_at) values
  ('b3000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'O11', now() - interval '2 minutes', 'pending', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b3000000-0000-0000-0000-0000000000f1', 0, 'P5', 'x', 3);
select pf_test.flush();
select pf_test.check('an order for a product under suspicion queues nothing while it is being judged', (select count(*) = 0 from stock_push_items where status = 'pending' and sku = 'P5'));
select pf_test.settle();
select pf_test.check('the late order arrived: with it WorkRelay believed 6 too, so there was never a disagreement',
  (select count(*) = 0 from stock_suspects where sku = 'P5') and (select count(*) = 0 from stock_conflicts where sku = 'P5'));
select pf_test.check('and the product is queued again', (select count(*) = 1 and bool_and(stock = 6) from stock_push_items where status = 'pending' and sku = 'P5'));
select pf_test.check('nothing was on its way for the other: after 90 seconds it is a real conflict, with both numbers, tied to the read',
  (select count(*) = 1 and bool_and(shop_value = 4 and workrelay_value = 9 and status = 'open' and run_id is not null) from stock_conflicts where sku = 'P6')
  and (select count(*) = 0 from stock_suspects where sku = 'P6'));
select pf_test.check('the read that found it is in the history with its issue',
  (select count(*) = 1 from product_sync_runs r where r.id = (select run_id from stock_conflicts where sku = 'P6')));

-- ---------------------------------------------------------------- only a number whose own SKU was read is sent
update stock_conflicts set status = 'kept_shop', decided_at = now() where status = 'open';
delete from stock_push_items where status = 'pending';
insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason) values
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e1', 'P1', 3, 'conflict'),
  ('b0000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-0000000000e1', 'b2000000-0000-0000-0000-0000000000e2', 'P2', 4, 'conflict');
update stock_push_items set read_at = clock_timestamp() where sku = 'P1' and status = 'pending';
create temp table pf_part as select * from claim_stock_pushes();
select pf_test.check('a read that held only P1 lets only P1 go: P2 was not in any answer and stays waiting',
  (select count(*) = 1 and bool_and((items->0->>'sku') = 'P1' and jsonb_array_length(items) = 1) from pf_part)
  and (select count(*) = 1 from stock_push_items where sku = 'P2' and status = 'pending' and read_at is null));
select complete_stock_push((select request_id from pf_part), true, 200, null);

-- ---------------------------------------------------------------- which SKUs to ask for, and when
update integrations set stock_push_pull_claimed_at = null, stock_push_reads_window_start = null, stock_push_reads_used = 0 where id = 'b1000000-0000-0000-0000-0000000000e1';
create temp table pf_ask as select * from claim_pre_push_pulls();
select pf_test.check('the read asks for the SKUs that wait, with the filter on trial the first time (the shop has never been tried)',
  (select count(*) = 1 and bool_and(phase = 'before_push' and skus = array['P2'] and use_filter and filter_state is null) from pf_ask));
select set_feed_filter('b1000000-0000-0000-0000-0000000000e1', false);
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.check('a shop that ignored the filter is read in full, and tried again only after 7 days',
  (select bool_and(not use_filter and filter_state = false) from claim_pre_push_pulls()));
update integration_sync set feed_filter_checked_at = now() - interval '8 days' where integration_id = 'b1000000-0000-0000-0000-0000000000e1';
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.check('and after 7 days it is tried again', (select bool_and(use_filter) from claim_pre_push_pulls()));
select set_feed_filter('b1000000-0000-0000-0000-0000000000e1', true);

-- ---------------------------------------------------------------- the hourly limit for these reads
update integrations set stock_push_pull_claimed_at = null, stock_push_reads_window_start = now() - interval '10 minutes', stock_push_reads_used = 1, stock_push_reads_limit = 2
  where id = 'b1000000-0000-0000-0000-0000000000e1';
update stock_push_items set read_tries = 0, read_at = null where status = 'pending';
select pf_test.check('the last read of the hour is allowed', (select count(*) = 1 from claim_pre_push_pulls()));
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
select pf_test.check('and then there is none until the hour is over: the numbers wait', (select count(*) = 0 from claim_pre_push_pulls())
  and (select count(*) >= 1 from stock_push_items where status = 'pending'));
select pf_test.as_user('00000000-0000-0000-0000-0000000000e3');
create temp table pf_status as select * from stock_push_status('b0000000-0000-0000-0000-0000000000e1');
select pf_test.check('a member sees what waits and why: the reads used, the limit, and when it resets',
  (select count(*) = 1 and bool_and(waiting >= 1 and reads_used = 2 and reads_limit = 2 and resets_at > now() and enabled) from pf_status));
select pf_test.as_user('00000000-0000-0000-0000-0000000000e4');
select pf_test.check('another workspace is refused', pf_test.err($$select * from stock_push_status('b0000000-0000-0000-0000-0000000000e1')$$) = 'forbidden');
reset role;
update integrations set stock_push_reads_window_start = now() - interval '2 hours' where id = 'b1000000-0000-0000-0000-0000000000e1';
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
create temp table pf_newhour as select * from claim_pre_push_pulls();
select pf_test.check('a new hour starts the count again', (select count(*) = 1 from pf_newhour)
  and (select stock_push_reads_used = 1 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select pf_test.check('only a platform admin can change the limit, and within 1 to 600',
  pf_test.err($$select admin_set_stock_push_read_limit('b1000000-0000-0000-0000-0000000000e1', 5)$$) = 'forbidden');
select pf_test.as_user('00000000-0000-0000-0000-0000000000e5');
select admin_set_stock_push_read_limit('b1000000-0000-0000-0000-0000000000e1', 5);
select pf_test.check('and the shop list of the admin shows it', (select bool_and(reads_limit = 5) from admin_list_tenant_shops('b0000000-0000-0000-0000-0000000000e1')));
select pf_test.check('and limits it to 1 to 600',
  pf_test.err($$select admin_set_stock_push_read_limit('b1000000-0000-0000-0000-0000000000e1', 0)$$) like 'The limit is between%'
  and pf_test.err($$select admin_set_stock_push_read_limit('b1000000-0000-0000-0000-0000000000e1', 601)$$) like 'The limit is between%');
reset role;
select pf_test.check('the platform admin sets it', (select stock_push_reads_limit = 5 from integrations where id = 'b1000000-0000-0000-0000-0000000000e1'));
-- a number whose SKU the shop's answers never contain is dropped after three asks, with the reason
update stock_push_items set read_tries = 3, read_at = null where status = 'pending' and sku = 'P2';
update integrations set stock_push_pull_claimed_at = null where id = 'b1000000-0000-0000-0000-0000000000e1';
select count(*) from claim_pre_push_pulls();
select pf_test.check('three asks without an answer for that SKU: dropped with the reason',
  (select count(*) = 1 from stock_push_items where sku = 'P2' and status = 'cancelled' and note like 'Not sent: the shop''s feed does not list this SKU%'));

-- ---------------------------------------------------------------- browsers cannot reach the new machinery
select pf_test.as_user('00000000-0000-0000-0000-0000000000e1');
select pf_test.check('nobody can claim reads, fail them or log queue failures from a browser',
  pf_test.err($$select claim_pre_push_pulls()$$) like 'permission denied%'
  and pf_test.err($$select fail_pre_push_pull('b1000000-0000-0000-0000-0000000000e1', 'x')$$) like 'permission denied%'
  and pf_test.err($$select log_stock_push_queue_failure(array[]::uuid[], 'x')$$) like 'permission denied%'
  and pf_test.err($$select settle_stock_suspects()$$) like 'permission denied%'
  and pf_test.err($$select set_feed_filter('b1000000-0000-0000-0000-0000000000e1', true)$$) like 'permission denied%'
  and pf_test.err($$select * from stock_suspects$$) like 'permission denied%'
  and pf_test.err($$update integrations set stock_push_pulled_at = now() where id = 'b1000000-0000-0000-0000-0000000000e1'$$) like 'permission denied%');

do $$ begin raise notice 'PULL FIRST CHECKS PASSED'; end $$;
rollback;
