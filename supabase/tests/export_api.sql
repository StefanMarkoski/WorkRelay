-- Export API (0052, one signing secret since 0054): off until the owner creates a secret, owner-only switch, a secret nobody else can read, one use per request id,
-- an hourly cap, an audit trail, and pages that hold only this shop's orders, customers and products without gaps or repeats.
begin;

create schema ex_test;
grant usage on schema ex_test to authenticated;
create function ex_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function ex_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function ex_test.err(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema ex_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@ex.dev'), ('00000000-0000-0000-0000-0000000000e2', 'admin@ex.dev'),
  ('00000000-0000-0000-0000-0000000000e3', 'member@ex.dev'), ('00000000-0000-0000-0000-0000000000e4', 'otherowner@ex.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Org A', '00000000-0000-0000-0000-0000000000e1'),
  ('a0000000-0000-0000-0000-0000000000e4', 'Org B', '00000000-0000-0000-0000-0000000000e4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'admin'),
  ('a0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'member'),
  ('a0000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e4', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by, estimate_stock) values
  ('a1000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'Shop A', 'connected', 'wr_live_e001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000e1', true),
  ('a1000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'Shop A2', 'connected', 'wr_live_e002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000e1', true);

insert into products (id, organization_id, integration_id, sku, name, stock, reported_at, updated_at) values
  ('a2000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'P1', 'Pen', 10, '2026-09-30 10:00+00', '2026-09-30 10:00+00'),
  ('a2000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'P2', 'Cap', 5, '2026-09-30 10:00+00', '2026-09-30 10:00:01+00'),
  ('a2000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2', 'Z1', 'Other shop item', 7, '2026-09-30 10:00+00', '2026-09-30 10:00+00');

-- three orders in Shop A (spaced in time), one in Shop A2
insert into orders (id, organization_id, integration_id, external_id, order_number, customer_name, customer_email, placed_at, currency, total_minor, last_event_at, updated_at) values
  ('a3000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'o1', '#1', 'Ann', 'ann@x.dev', '2026-10-01 10:00+00', 'EUR', 1000, '2026-10-01 10:00+00', '2026-10-01 10:00:00.123456+00'),
  ('a3000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'o2', '#2', 'Bob', 'bob@x.dev', '2026-10-02 10:00+00', 'EUR', 2000, '2026-10-02 10:00+00', '2026-10-02 10:00:00.5+00'),
  ('a3000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'o3', '#3', 'Ann', 'ann@x.dev', '2026-10-03 10:00+00', 'EUR', 3000, '2026-10-03 10:00+00', '2026-10-03 10:00+00'),
  ('a3000000-0000-0000-0000-0000000000e4', 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e2', 'x1', '#X1', 'Cy', 'cy@other.dev', '2026-10-03 11:00+00', 'EUR', 9000, '2026-10-03 11:00+00', '2026-10-03 11:00+00');
insert into order_items (organization_id, order_id, position, sku, name, quantity, unit_price_minor) values
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e1', 1, 'P1', 'Pen', 2, 500),
  ('a0000000-0000-0000-0000-0000000000e1', 'a3000000-0000-0000-0000-0000000000e1', 2, 'P2', 'Cap', 1, 0);
-- ---------------------------------------------------------------- off by default
select ex_test.check('export is off for every shop by default', (select not bool_or(export_enabled) from integrations));
select ex_test.check('a call is refused while there is no secret',
  (select reason from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-00000001', 'orders')) = 'export_off');

-- ---------------------------------------------------------------- who may switch it on
select ex_test.as_user('00000000-0000-0000-0000-0000000000e2'); -- admin
select ex_test.check('an admin cannot switch export on',
  ex_test.err($$select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', true)$$) = 'forbidden');
select ex_test.as_user('00000000-0000-0000-0000-0000000000e4'); -- owner of another workspace
select ex_test.check('the owner of another workspace can neither switch it on nor off',
  ex_test.err($$select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', true)$$) = 'forbidden'
  and ex_test.err($$select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', false)$$) = 'forbidden');
reset role;

select ex_test.as_user('00000000-0000-0000-0000-0000000000e1'); -- owner
create temp table ex_secret (s text);
grant all on ex_secret to authenticated;
select ex_test.check('export cannot be switched on before the shop has a signing secret',
  ex_test.err($$select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', true)$$) like 'Create the shop%signing secret first%');
insert into ex_secret select rotate_stock_push_secret('a1000000-0000-0000-0000-0000000000e1');
select ex_test.check('the one signing secret is shown once and looks like one', (select s ~ '^wr_sign_[0-9a-f]{64}$' from ex_secret));
select ex_test.check('having the secret does not switch export on',
  (select not export_enabled from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));
select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', true);
select ex_test.check('the owner switches export on, and a browser never sees which secret it is',
  (select export_enabled and stock_push_has_secret from integrations where id = 'a1000000-0000-0000-0000-0000000000e1')
  and ex_test.err($$select stock_push_secret_id from integrations$$) like 'permission denied%'
  and ex_test.err($$update integrations set export_enabled = false where id = 'a1000000-0000-0000-0000-0000000000e1'$$) like 'permission denied%');
select ex_test.check('a browser cannot call the export functions or write the history',
  ex_test.err($$select * from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-00000002', 'orders')$$) like 'permission denied%'
  and ex_test.err($$select export_page('a1000000-0000-0000-0000-0000000000e1', 'orders', null, null, null, 10)$$) like 'permission denied%'
  and ex_test.err($$select export_finish(gen_random_uuid(), 'ok', null, 1)$$) like 'permission denied%'
  and ex_test.err($$insert into export_calls (organization_id, integration_id, request_id, resource) values ('a0000000-0000-0000-0000-0000000000e1','a1000000-0000-0000-0000-0000000000e1','req-00000003','orders')$$) like 'permission denied%');
reset role;

-- ---------------------------------------------------------------- one call
create temp table ex_call as select * from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-aaaaaaaa', 'orders');
select ex_test.check('a call goes ahead once there is a secret, and it receives that secret',
  (select ok and secret = (select s from ex_secret) and call_id is not null from ex_call));
select ex_test.check('the same request id is refused the second time (a replay)',
  (select reason from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-aaaaaaaa', 'orders')) = 'replayed');
select ex_test.check('another shop may use the same request id (they are separate)',
  (select reason from export_begin('a1000000-0000-0000-0000-0000000000e2', 'req-aaaaaaaa', 'orders')) = 'export_off');
select export_finish((select call_id from ex_call), 'ok', null, 3);
select ex_test.check('a finished call is recorded with its rows and marks the shop as used',
  (select status = 'ok' and row_count = 3 from export_calls where request_id = 'req-aaaaaaaa')
  and (select export_last_used_at is not null from integrations where id = 'a1000000-0000-0000-0000-0000000000e1'));
select export_finish((select call_id from ex_call), 'failed', 'later', 0);
select ex_test.check('a finished call cannot be rewritten afterwards',
  (select status = 'ok' and row_count = 3 from export_calls where request_id = 'req-aaaaaaaa'));

select ex_test.as_user('00000000-0000-0000-0000-0000000000e3'); -- member
select ex_test.check('a plain member does not see the export history', (select count(*) = 0 from export_calls));
select ex_test.as_user('00000000-0000-0000-0000-0000000000e2'); -- admin
select ex_test.check('an admin sees the history of calls', (select count(*) >= 1 from export_calls));
select ex_test.as_user('00000000-0000-0000-0000-0000000000e4');
select ex_test.check('another workspace sees nothing of it', (select count(*) = 0 from export_calls));
reset role;

-- ---------------------------------------------------------------- the hourly cap
insert into export_calls (organization_id, integration_id, request_id, resource, status)
select 'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1', 'fill-' || lpad(g::text, 6, '0'), 'orders', 'ok'
from generate_series(1, 118) g;
select ex_test.check('the 120th call in an hour is still fine',
  (select ok from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-bbbbbbbb', 'orders')));
select ex_test.check('the 121st is refused',
  (select reason from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-cccccccc', 'orders')) = 'rate_limited');
update export_calls set created_at = now() - interval '2 hours' where request_id like 'fill-%';
select ex_test.check('an hour later the allowance is back',
  (select ok from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-dddddddd', 'orders')));
update export_calls set created_at = now() - interval '31 days' where request_id like 'fill-%';
select export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-eeeeeeee', 'orders');
select ex_test.check('history older than 30 days is dropped', (select count(*) = 0 from export_calls where request_id like 'fill-%'));

-- ---------------------------------------------------------------- pages
create temp table ex_p1 as select export_page('a1000000-0000-0000-0000-0000000000e1', 'orders', null, null, null, 2) as p;
select ex_test.check('the first page holds two orders, oldest change first, and points to the next',
  (select jsonb_array_length(p->'items') = 2 and p->'items'->0->>'external_id' = 'o1' and p->'items'->1->>'external_id' = 'o2' and p->'next' is not null from ex_p1));
select ex_test.check('an order carries its lines in order, its customer, and the money as whole minor units',
  (select p->'items'->0->'items'->0->>'sku' = 'P1' and p->'items'->0->'items'->1->>'sku' = 'P2'
      and p->'items'->0->'customer'->>'email' = 'ann@x.dev' and (p->'items'->0->>'total_minor')::int = 1000 from ex_p1));
create temp table ex_p2 as
  select export_page('a1000000-0000-0000-0000-0000000000e1', 'orders', null, (p->'next'->>'at')::timestamptz, (p->'next'->>'id')::uuid, 2) as p from ex_p1;
select ex_test.check('the second page holds the last order and no further page; the other shop''s order never shows',
  (select jsonb_array_length(p->'items') = 1 and p->'items'->0->>'external_id' = 'o3' and p->'next' = 'null'::jsonb from ex_p2));
select ex_test.check('the cursor keeps microseconds, so two orders a moment apart are neither skipped nor repeated',
  (select (p->'next'->>'at')::timestamptz = '2026-10-02 10:00:00.5+00' from ex_p1));
select ex_test.check('"since" returns only what changed after that moment',
  (select jsonb_array_length(export_page('a1000000-0000-0000-0000-0000000000e1', 'orders', '2026-10-02 10:00:00.5+00', null, null, 50)->'items') = 1));
select ex_test.check('a limit of 0 still returns one row',
  (select jsonb_array_length(export_page('a1000000-0000-0000-0000-0000000000e1', 'orders', null, null, null, 0)->'items') = 1));

select ex_test.check('customers are only the people of this shop, with their order count',
  (select count(*) = 2 and bool_and(c->>'email' in ('ann@x.dev', 'bob@x.dev')) and bool_or((c->>'orders')::int = 2)
   from jsonb_array_elements(export_page('a1000000-0000-0000-0000-0000000000e1', 'customers', null, null, null, 50)->'items') c));
select ex_test.check('products are this shop''s only, with the estimate (10 reported, 2 sold since)',
  (select count(*) = 2 and bool_and(p->>'sku' <> 'Z1')
      and bool_or(p->>'sku' = 'P1' and (p->>'stock')::int = 8 and (p->>'stock_reported')::int = 10 and (p->>'stock_is_estimate')::boolean)
   from jsonb_array_elements(export_page('a1000000-0000-0000-0000-0000000000e1', 'products', null, null, null, 50)->'items') p));
select ex_test.check('an unknown resource is refused',
  ex_test.err($$select export_page('a1000000-0000-0000-0000-0000000000e1', 'secrets', null, null, null, 5)$$) = 'unknown resource');

-- ---------------------------------------------------------------- refusals before the signature check (0053)
select export_note_refusal('a1000000-0000-0000-0000-0000000000e1', 'orders', 'The X-Store-Id did not match this shop.');
select ex_test.check('a refusal is written to the history with its reason',
  (select count(*) = 1 from export_calls where status = 'refused' and reason = 'The X-Store-Id did not match this shop.' and request_id like 'refused-%'));
select export_note_refusal('a1000000-0000-0000-0000-0000000000e1', 'secrets', 'x');
select export_note_refusal(gen_random_uuid(), 'orders', 'x');
select ex_test.check('an unknown resource or shop writes nothing', (select count(*) = 1 from export_calls where request_id like 'refused-%'));
select export_note_refusal('a1000000-0000-0000-0000-0000000000e1', 'orders', 'noise') from generate_series(1, 150);
select ex_test.check('at most 100 refusals an hour are kept, so noise cannot fill the table',
  (select count(*) = 100 from export_calls where request_id like 'refused-%'));
select ex_test.check('refusals do not use up the real caller''s allowance',
  (select ok from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-gggggggg', 'orders')));
select ex_test.as_user('00000000-0000-0000-0000-0000000000e1');
select ex_test.check('a browser cannot write the history',
  ex_test.err($$select export_note_refusal('a1000000-0000-0000-0000-0000000000e1', 'orders', 'x')$$) like 'permission denied%');
reset role;
delete from export_calls where request_id like 'refused-%';

-- ---------------------------------------------------------------- switching off
select ex_test.as_user('00000000-0000-0000-0000-0000000000e1');
select set_export_enabled('a1000000-0000-0000-0000-0000000000e1', false);
reset role;
select ex_test.check('switching export off stops it at once and leaves the signing secret for write-back',
  (select not export_enabled and stock_push_has_secret from integrations where id = 'a1000000-0000-0000-0000-0000000000e1')
  and (select reason from export_begin('a1000000-0000-0000-0000-0000000000e1', 'req-ffffffff', 'orders')) = 'export_off');
select ex_test.check('another shop with no secret is refused as off even if switched on by hand',
  (select reason from export_begin('a1000000-0000-0000-0000-0000000000e2', 'req-hhhhhhhh', 'orders')) = 'export_off');

do $$ begin raise notice 'EXPORT API CHECKS PASSED'; end $$;
rollback;
