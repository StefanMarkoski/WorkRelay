-- Insights aggregates (0017): orders and revenue per day, time zones, shop scope, runs, events, customers, top products,
-- busiest hours, inventory health, and workspace isolation.
begin;

create schema in_test;
grant usage on schema in_test to authenticated;
create function in_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function in_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema in_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'member@in.dev'), ('00000000-0000-0000-0000-0000000000b2', 'other@in.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000b1', 'Org A', '00000000-0000-0000-0000-0000000000b1'),
  ('a0000000-0000-0000-0000-0000000000b2', 'Org B', '00000000-0000-0000-0000-0000000000b2');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'member'),
  ('a0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'owner');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'Alpha', 'connected', 'wr_live_b001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000b1'),
  ('a1000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'Beta', 'connected', 'wr_live_b002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000b1'),
  ('a1000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000b2', 'Gamma', 'connected', 'wr_live_b003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000b2');

-- o5 is before the window; o6 belongs to another workspace; o2 is cancelled
insert into orders (id, organization_id, integration_id, external_id, customer_email, placed_at, currency, total_minor, status, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '1', 'A@x.com', '2026-10-01 23:30+00', 'EUR', 1000, 'completed', now()),
  ('a3000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '2', ' a@x.com', '2026-10-02 10:00+00', 'EUR', 2000, 'cancelled', now()),
  ('a3000000-0000-0000-0000-0000000000b3', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b2', '3', 'b@x.com', '2026-10-02 12:00+00', 'USD', 500, 'pending', now()),
  ('a3000000-0000-0000-0000-0000000000b4', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '4', 'a@x.com', '2026-10-03 09:00+00', 'EUR', 3000, 'completed', now()),
  ('a3000000-0000-0000-0000-0000000000b5', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '5', 'c@x.com', '2026-09-01 09:00+00', 'EUR', 700, 'completed', now()),
  ('a3000000-0000-0000-0000-0000000000b6', 'a0000000-0000-0000-0000-0000000000b2', 'a1000000-0000-0000-0000-0000000000b3', '6', 'z@x.com', '2026-10-02 09:00+00', 'EUR', 9999, 'completed', now()),
  -- o7 is dated in the year 3000: it must be left out of every total
  ('a3000000-0000-0000-0000-0000000000b7', 'a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', '7', 'future@x.com', '3000-01-01 00:00+00', 'EUR', 123456, 'completed', now());
insert into order_items (organization_id, order_id, position, sku, name, quantity, unit_price_minor) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b1', 0, 'S1', 'Widget', 2, 500),
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b2', 0, 'S2', 'Gadget', 100, 20),
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b3', 0, 'S1', 'Widget', 1, 500),
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b4', 0, 'S2', 'Gadget', 5, 600),
  ('a0000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b4', 1, null, 'Gift wrap', 1, 100);

select in_test.as_user('00000000-0000-0000-0000-0000000000b1');

-- ------------------------------------------------------------------------------------------------ orders and revenue
select in_test.check('orders per day, shop and currency (UTC); cancelled counted as orders but not revenue; the window starts at p_since',
  (select count(*) = 4 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC'))
  and (select orders = 1 and revenue_minor = 1000 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-01')
  and (select orders = 1 and cancelled = 1 and revenue_minor = 0 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-02' and currency = 'EUR')
  and (select orders = 1 and revenue_minor = 500 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-02' and currency = 'USD')
  and (select revenue_minor = 3000 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-03'));
select in_test.check('an order dated far in the future is left out of the totals, the statuses, the customers and the hourly counts',
  (select coalesce(sum(revenue_minor), 0) = 4500 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC'))
  and (select coalesce(sum(orders), 0) = 4 from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00'))
  and (select coalesce(sum(new_customers), 0) = 2 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC'))
  and (select coalesce(sum(orders), 0) = 4 from insights_hourly('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC')));
select in_test.check('currencies stay separate rows and are never added together',
  (select count(distinct currency) = 2 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC')));
select in_test.check('days are cut in the caller''s time zone: 23:30 UTC on Oct 1 is already Oct 2 in Auckland',
  (select count(*) = 0 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'Pacific/Auckland') where day = '2026-10-01')
  and (select sum(orders) = 4 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'Pacific/Auckland')));
select in_test.check('an unknown time zone falls back to UTC instead of failing',
  (select count(*) = 4 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'Not/AZone')));
select in_test.check('a shop filter limits everything to that shop',
  (select sum(orders) = 1 and bool_and(currency = 'USD') from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC', 'a1000000-0000-0000-0000-0000000000b2')));

select in_test.check('the period''s orders by status, and by shop',
  (select orders = 2 from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') where status = 'completed')
  and (select orders = 1 from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') where status = 'cancelled')
  and (select orders = 1 from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') where status = 'pending')
  and (select sum(orders) = 1 and bool_and(status = 'pending') from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'a1000000-0000-0000-0000-0000000000b2')));

-- ------------------------------------------------------------------------------------------------ customers
select in_test.check('new customers are counted on the day of their first order (case and spaces in the email ignored), later orders are "returning"',
  (select new_customers = 1 and returning_orders = 0 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-01')
  and (select new_customers = 1 and returning_orders = 1 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-02')
  and (select new_customers = 0 and returning_orders = 1 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-03'));
select in_test.check('someone whose first order was before the window is not new inside it',
  (select coalesce(sum(new_customers), 0) = 2 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC')));
select in_test.check('with a shop chosen, "new" means their first order in that shop',
  (select sum(new_customers) = 1 and sum(returning_orders) = 0 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC', 'a1000000-0000-0000-0000-0000000000b2')));

-- ------------------------------------------------------------------------------------------------ top products and hours
select in_test.check('top products by pieces: cancelled orders left out, same SKU in two shops stays separate, no-SKU items grouped by name',
  (select count(*) = 4 from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00'))
  and (select sku = 'S2' and quantity = 5 and integration_name = 'Alpha' from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') limit 1)
  and (select quantity = 1 from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') where sku = 'S1' and integration_name = 'Beta')
  and (select quantity = 1 and product_id is null from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00') where sku = 'Gift wrap'));
select in_test.check('a limit and a shop filter both apply',
  (select count(*) = 1 from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', null, 1))
  and (select count(*) = 1 and bool_and(sku = 'S1') from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'a1000000-0000-0000-0000-0000000000b2')));
select in_test.check('orders by weekday and hour: Oct 2 2026 is a Friday, noon UTC; four orders in the window',
  (select sum(orders) = 4 from insights_hourly('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC'))
  and (select orders = 1 from insights_hourly('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where dow = 5 and hour = 12)
  and (select orders = 1 from insights_hourly('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where dow = 4 and hour = 23));

-- ------------------------------------------------------------------------------------------------ runs and events
reset role;
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'wf');
insert into workflow_versions (id, workflow_id, organization_id, version, definition)
  values ('a5000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 1, '{"trigger":{"type":"order_created"},"steps":[]}');
insert into workflow_runs (organization_id, workflow_id, version_id, trigger_source, status, context, created_at) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a5000000-0000-0000-0000-0000000000b1', 'order_created', 'succeeded', '{"order":{"integration_id":"a1000000-0000-0000-0000-0000000000b1"}}', '2026-10-02 10:00+00'),
  ('a0000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a5000000-0000-0000-0000-0000000000b1', 'low_stock', 'failed', '{"event":{"integration_id":"a1000000-0000-0000-0000-0000000000b2"}}', '2026-10-02 11:00+00'),
  ('a0000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a5000000-0000-0000-0000-0000000000b1', 'order_created', 'succeeded', '{"order":{"integration_id":"a1000000-0000-0000-0000-0000000000b1"}}', '2026-10-03 10:00+00');
insert into webhook_events (organization_id, integration_id, event_id, event_type, status, raw_payload, received_at) values
  ('a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', 'e1', 'order.created', 'processed', '{}', '2026-10-02 10:00+00'),
  ('a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b1', 'e2', 'order.created', 'failed', '{}', '2026-10-02 11:00+00'),
  ('a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b2', 'e3', 'inventory.pull', 'processed', '{}', '2026-10-02 12:00+00');
select in_test.as_user('00000000-0000-0000-0000-0000000000b1');
select in_test.check('automation runs per day and status, with the shop read from the order or the event',
  (select runs = 1 from insights_runs_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-02' and status = 'succeeded')
  and (select runs = 1 from insights_runs_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where day = '2026-10-02' and status = 'failed')
  and (select sum(runs) = 2 and bool_and(status = 'succeeded') from insights_runs_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC', 'a1000000-0000-0000-0000-0000000000b1'))
  and (select sum(runs) = 1 and bool_and(status = 'failed') from insights_runs_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC', 'a1000000-0000-0000-0000-0000000000b2')));
select in_test.check('deliveries per day and status, including product feeds, and per shop',
  (select sum(events) = 3 from insights_events_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC'))
  and (select events = 1 from insights_events_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC') where status = 'failed')
  and (select sum(events) = 1 from insights_events_daily('a0000000-0000-0000-0000-0000000000b1', '2026-10-01 00:00+00', 'UTC', 'a1000000-0000-0000-0000-0000000000b2')));

-- ------------------------------------------------------------------------------------------------ inventory health
reset role;
select apply_product_sync('a1000000-0000-0000-0000-0000000000b1',
  '[{"sku":"LOW","stock":3,"notify_on":5},{"sku":"FINE","stock":50,"notify_on":5},{"sku":"NOLIMIT","stock":10}]', 'pull', now());
select in_test.as_user('00000000-0000-0000-0000-0000000000b1');
select in_test.check('the catalogue splits into low, fine, no threshold and never reported (S1, S2 and Gift wrap came from orders)',
  (select low = 1 and ok = 1 and no_threshold = 1 and not_reported = 3 from insights_inventory_health('a0000000-0000-0000-0000-0000000000b1')));
select in_test.check('the health count follows a shop filter',
  (select low = 0 and ok = 0 and no_threshold = 0 and not_reported = 1 from insights_inventory_health('a0000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000b2')));
reset role;

-- ------------------------------------------------------------------------------------------------ isolation
select in_test.as_user('00000000-0000-0000-0000-0000000000b2');
select in_test.check('another workspace sees none of this workspace''s numbers through any function',
  (select count(*) = 0 from insights_orders_daily('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_runs_daily('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_events_daily('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_customers_daily('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_top_products('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_hourly('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select count(*) = 0 from insights_order_status('a0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00+00'))
  and (select low + ok + no_threshold + not_reported = 0 from insights_inventory_health('a0000000-0000-0000-0000-0000000000b1')));
reset role;

select 'PASSED' as insights;
rollback;
