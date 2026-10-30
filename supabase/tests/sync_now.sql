-- Sync now (0020): who may claim a manual call, the gates (schedule, URL, pause), the shared budget and window, the
-- cooldown, and that scheduled calls draw from the same budget.
begin;

create schema sn_test;
grant usage on schema sn_test to authenticated;
create function sn_test.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;
create function sn_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- the error CODE a statement raises (the function's message), or 'ok'
create function sn_test.code(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on all functions in schema sn_test to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@sn.dev'), ('00000000-0000-0000-0000-0000000000d2', 'member@sn.dev'),
  ('00000000-0000-0000-0000-0000000000d3', 'admin@sn.dev'), ('00000000-0000-0000-0000-0000000000d4', 'other@sn.dev'),
  ('00000000-0000-0000-0000-0000000000d5', 'super@sn.dev');
insert into organizations (id, name, created_by) values
  ('a0000000-0000-0000-0000-0000000000d1', 'Org A', '00000000-0000-0000-0000-0000000000d1'),
  ('a0000000-0000-0000-0000-0000000000d2', 'Org B', '00000000-0000-0000-0000-0000000000d4');
insert into memberships values
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'member'),
  ('a0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d3', 'admin'),
  ('a0000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d4', 'owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000d5');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Scheduled', 'connected', 'wr_live_d001', extensions.digest('k1', 'sha256'), 's1', '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'No schedule', 'connected', 'wr_live_d002', extensions.digest('k2', 'sha256'), 's2', '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'Paused', 'connected', 'wr_live_d003', extensions.digest('k3', 'sha256'), 's3', '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d4', 'a0000000-0000-0000-0000-0000000000d1', 'No url', 'connected', 'wr_live_d004', extensions.digest('k4', 'sha256'), 's4', '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d5', 'a0000000-0000-0000-0000-0000000000d1', 'Revoked', 'revoked', 'wr_live_d005', extensions.digest('k5', 'sha256'), null, '00000000-0000-0000-0000-0000000000d1'),
  ('a1000000-0000-0000-0000-0000000000d6', 'a0000000-0000-0000-0000-0000000000d1', 'No settings', 'connected', 'wr_live_d006', extensions.digest('k6', 'sha256'), 's6', '00000000-0000-0000-0000-0000000000d1');
insert into integration_sync (integration_id, organization_id, source_url, auth_header, calls, days, next_sync_at, paused) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'https://a.example/p', 'Bearer s3cret', 3, 1, now() + interval '5 hours', false),
  ('a1000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', 'https://b.example/p', null, null, null, null, false),
  ('a1000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-0000000000d1', 'https://c.example/p', null, 3, 1, now() + interval '5 hours', true),
  ('a1000000-0000-0000-0000-0000000000d4', 'a0000000-0000-0000-0000-0000000000d1', null, null, 3, 1, now() + interval '5 hours', false),
  ('a1000000-0000-0000-0000-0000000000d5', 'a0000000-0000-0000-0000-0000000000d1', 'https://e.example/p', null, 3, 1, now() + interval '5 hours', false);

-- ------------------------------------------------------------------------------------------------ who
select sn_test.as_user('00000000-0000-0000-0000-0000000000d1');
select sn_test.check('the browser can never call the claim itself (it returns the shop''s secret header)',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')$$) like '%permission denied%');
select sn_test.check('a tenant can read the window columns but still not the auth header',
  (select window_used = 0 from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1')
  and sn_test.code($$select auth_header from integration_sync$$) like '%permission denied%');
reset role;

select sn_test.check('a member of the workspace cannot claim a call',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select sn_test.check('someone from another workspace cannot',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d4', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select sn_test.check('a user that does not exist cannot',
  sn_test.code($$select * from claim_manual_product_sync(gen_random_uuid(), 'a1000000-0000-0000-0000-0000000000d1')$$) = 'forbidden');
select sn_test.check('an unknown shop is just forbidden, revealing nothing',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', gen_random_uuid())$$) = 'forbidden');
select sn_test.check('nothing was spent by any of those', (select window_used = 0 and window_start is null and last_attempt_at is null from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));

-- ------------------------------------------------------------------------------------------------ the gates
select sn_test.check('no schedule set by the platform admin: not available',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d2')$$) = 'not_scheduled');
select sn_test.check('paused: not available',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d3')$$) = 'paused');
select sn_test.check('no products URL: not available',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d4')$$) = 'no_url');
select sn_test.check('a revoked shop: not available',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d5')$$) = 'not_connected');
select sn_test.check('a shop that has no sync settings at all has no URL',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d6')$$) = 'no_url');

-- ------------------------------------------------------------------------------------------------ spending the budget (3 per day)
create temp table first_claim as select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1');
select sn_test.check('an owner gets the URL and header, and 2 calls are left of 3',
  (select source_url = 'https://a.example/p' and auth_header = 'Bearer s3cret' and calls_left = 2 from first_claim));
select sn_test.check('the window started and one call is used',
  (select window_used = 1 and window_start is not null and last_attempt_at is not null from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));
select sn_test.check('a double-click inside a minute is refused instead of spending a second call',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'too_soon'
  and (select window_used = 1 from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));
update integration_sync set last_attempt_at = now() - interval '2 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('an admin can claim after the cooldown: 1 left', (select calls_left = 1 from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d3', 'a1000000-0000-0000-0000-0000000000d1')));
update integration_sync set last_attempt_at = now() - interval '2 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('and the last one: 0 left', (select calls_left = 0 from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')));
update integration_sync set last_attempt_at = now() - interval '2 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('then the budget is used up and further presses are refused',
  sn_test.code($$select * from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')$$) = 'budget_used'
  and (select window_used = 3 from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));

-- scheduled calls draw on the same budget
update integration_sync set next_sync_at = now() - interval '1 minute' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('a scheduled call that is due waits while the window has no calls left', (select count(*) = 0 from claim_due_product_syncs(5)));
update integration_sync set window_start = now() - interval '25 hours' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
create temp table scheduled as select * from claim_due_product_syncs(5);
select sn_test.check('once the window has renewed, the scheduled call goes ahead and opens a new window with one call used',
  (select count(*) = 1 from scheduled)
  and (select window_used = 1 and window_start > now() - interval '1 minute' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));
select sn_test.check('the scheduled call set its next time one interval ahead (8 hours for 3 per day)',
  (select next_sync_at between now() + interval '7 hours 59 minutes' and now() + interval '8 hours 1 minute' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));
update integration_sync set last_attempt_at = now() - interval '2 minutes' where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('and a manual press in the new window sees 2 left after that one scheduled call',
  (select calls_left = 1 from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')));

-- a manual press does not move the schedule
select sn_test.check('a manual call leaves the next scheduled time alone',
  (select next_sync_at between now() + interval '7 hours' and now() + interval '8 hours 1 minute' from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));

-- ------------------------------------------------------------------------------------------------ the platform admin
select sn_test.as_user('00000000-0000-0000-0000-0000000000d5');
select admin_set_sync_rate('a1000000-0000-0000-0000-0000000000d1', 10, 1);
reset role;
select sn_test.check('a new rate starts a fresh window',
  (select window_used = 0 and window_start is null and calls = 10 from integration_sync where integration_id = 'a1000000-0000-0000-0000-0000000000d1'));
update integration_sync set last_attempt_at = null where integration_id = 'a1000000-0000-0000-0000-0000000000d1';
select sn_test.check('and the owner then has the full new budget', (select calls_left = 9 from claim_manual_product_sync('00000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1')));

select 'PASSED' as sync_now;
rollback;
