-- Realtime publication safety and the engine kick. Parts needing Realtime / pg_net / Vault skip if the test image lacks them.
begin;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'skip - realtime publication not available'; return;
  end if;
  perform pg_temp.check('client-readable tables are published',
    (select count(*) = 6 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('orders', 'order_events', 'workflow_runs', 'step_runs', 'approvals', 'product_sync_events')));
  perform pg_temp.check('tables with secrets or raw customer data are NOT published',
    (select count(*) = 0 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('webhook_events', 'integrations', 'workflows', 'workflow_versions', 'memberships', 'platform_admins',
                        'integration_sync', 'products', 'stock_events', 'low_stock_events', 'customers')));
end $$;

-- fixtures: one enabled order-created workflow
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'kick@t.dev');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000d1', 'Org', '00000000-0000-0000-0000-0000000000d1');
insert into integrations (id, organization_id, name, status, key_prefix, key_hash, external_store_id, created_by) values
  ('a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'S', 'connected', 'wr_live_kkkk', extensions.digest('k', 'sha256'), 's', '00000000-0000-0000-0000-0000000000d1');
insert into workflows (id, organization_id, name) values ('a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'wf');
insert into workflow_versions (id, workflow_id, organization_id, version, definition) values
  ('a5000000-0000-0000-0000-0000000000d1', 'a4000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 1, '{"trigger":{"type":"order_created"},"steps":[]}');
update workflows set current_version_id = 'a5000000-0000-0000-0000-0000000000d1', enabled = true;
insert into orders (id, organization_id, integration_id, external_id, last_event_at) values
  ('a3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'a1000000-0000-0000-0000-0000000000d1', '1', now());

do $$
declare before_n bigint; after_n bigint;
begin
  if to_regclass('net.http_request_queue') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'skip - pg_net or vault not available'; return;
  end if;

  -- without the Vault secrets the kick is a silent no-op and the write still succeeds
  select count(*) into before_n from net.http_request_queue;
  insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
    ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d1', 'external', 'order.created', now(), '{"event_id":"k0","applied":[]}');
  select count(*) into after_n from net.http_request_queue;
  perform pg_temp.check('no secrets configured: run is queued, kick is skipped, write succeeds',
    after_n = before_n and (select count(*) from workflow_runs where event_id = 'k0') = 1);

  perform vault.create_secret('https://example.supabase.co', 'project_url');
  perform vault.create_secret('test-engine-secret', 'engine_secret');

  select count(*) into before_n from net.http_request_queue;
  insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
    ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d1', 'external', 'order.created', now(), '{"event_id":"k1","applied":[]}');
  select count(*) into after_n from net.http_request_queue;
  perform pg_temp.check('a newly queued run kicks the engine once', after_n = before_n + 1);
  perform pg_temp.check('the kick targets the run-engine endpoint and carries the secret',
    (select count(*) = 1 from net.http_request_queue
      where url = 'https://example.supabase.co/functions/v1/run-engine' and headers::text like '%test-engine-secret%'));

  -- a duplicate event queues no run, so no kick
  select count(*) into before_n from net.http_request_queue;
  insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
    ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d1', 'external', 'order.created', now(), '{"event_id":"k1","applied":[]}');
  select count(*) into after_n from net.http_request_queue;
  perform pg_temp.check('a duplicate event does not kick the engine', after_n = before_n);

  -- an internal note never queues runs, so no kick
  insert into order_events (organization_id, order_id, source, type, occurred_at, data) values
    ('a0000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-0000000000d1', 'workrelay', 'note.added', now(), '{"note":"x"}');
  select count(*) into after_n from net.http_request_queue;
  perform pg_temp.check('internal notes do not kick the engine', after_n = before_n);
end $$;

rollback;
\echo REALTIME AND KICK CHECKS PASSED
