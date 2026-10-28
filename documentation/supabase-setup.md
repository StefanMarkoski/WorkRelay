# Supabase setup (hosted)

Everything below is verified locally by `scripts/test-db.sh` (migrations + SQL tests against a real Supabase
Postgres image) and `npm test` (unit tests). Nothing has been deployed to a hosted project yet.

## 1. Create the project
supabase.com -> New project. Save the database password. Note the **project ref** (the `abcd1234` in `https://abcd1234.supabase.co`).

## 2. Link and apply migrations
```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push        # applies supabase/migrations/0001..0006
```

## 3. Deploy migrations and Edge Functions
Either connect the repo (Project Settings -> Integrations -> GitHub, working directory `.`, **Deploy to production**, branch
`main`): every push to `main` then applies new migrations and deploys the functions declared in `supabase/config.toml`.
Or use the CLI: `npx supabase link --project-ref <ref>`, `npx supabase db push`, and
`npx supabase functions deploy <bind|order-webhook|publish-workflow|run-engine> --no-verify-jwt`.
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically in hosted functions;
there are no function secrets to set. The service-role key must never appear in the frontend or in any committed file.

## 4. Start the execution engine (pg_cron)
The engine endpoint is protected by a secret stored in Supabase Vault, generated inside Postgres so it never leaves the
database. Run once in the SQL editor:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'engine_secret');
select vault.create_secret('https://<ref>.supabase.co', 'project_url');

select cron.schedule('workrelay-engine', '10 seconds', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/run-engine',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'engine_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
$$);
```
Each tick is short and bounded: it fails overdue runs, claims up to 10 due runs under a 60 s lease, and executes up to
20 steps per run. Retries, approval waits and long workflows are rows with a `next_run_at`; no invocation stays open.
If the engine stops, nothing is lost: pending runs wait, and crashed leases expire and are re-claimed.
To stop it: `select cron.unschedule('workrelay-engine');`

## 5. Auth settings (Dashboard -> Authentication)
- URL Configuration: Site URL = the URL where the frontend is hosted; add it and `http://localhost:5173` to Redirect URLs.
- Providers -> Email: keep enabled. Decide whether "Confirm email" is on (recommended in production).

## 6. Frontend environment
Dashboard -> Project Settings -> API: copy the **Project URL** and the **anon** key.
- Local: put them in `.env.local` (see `.env.example`), then `npm run dev`.
- Hosting (GitHub Pages, no Actions needed): set Pages to "Deploy from a branch: main / docs", then run
  `GIT_PUSH_AUTH_USER=<gh account> scripts/deploy-pages.sh`. It builds with the values from `.env.local` into `docs/`,
  commits the build to the current branch and requests a Pages build. Re-run it after frontend changes.
  Supabase itself deploys via its GitHub integration.

## 7. First run through the UI
1. Sign up, create a workspace.
2. Integrations -> Connect store -> copy the key (shown once).
3. From the commerce app (or curl):
```bash
KEY=wr_live_...; BASE=https://<ref>.supabase.co/functions/v1
curl -X POST $BASE/bind -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"store_id":"store-1","base_url":"https://shop.example.com"}'
curl -X POST $BASE/order-webhook -H "Authorization: Bearer $KEY" -H 'X-Store-Id: store-1' \
  -H 'content-type: application/json' \
  -d '{"event_id":"evt_1","event_type":"order.created","occurred_at":"2026-10-27T10:00:00Z","order":{"external_id":"1001","order_number":"#1001","currency":"EUR","totals":{"total_minor":4999}}}'
```
Repeating the second call returns `{"status":"duplicate"}`. The order appears under Orders.
4. Automations -> Add automation -> "Order notifications" (a Discord or Slack webhook URL) or "Review large orders", then send
   another order. The run appears under Executions within about 10 seconds. Automations are visible to owners and admins only,
   because a destination URL works like a secret.

## Testing locally
```bash
npm test                 # unit tests (ingestion, engine, workflow schema, SSRF)
scripts/test-db.sh       # throwaway Docker Postgres: all migrations + RLS/engine/ingestion SQL tests
```

## Known limits
- Outbound HTTP: resolved IPs are checked before the request, but `fetch` resolves again, so DNS rebinding is a
  residual risk. For sensitive deployments add a destination allowlist or egress proxy.
- Email actions are unavailable until an email provider integration exists; publishing rejects them.
- Members must already have an account; there are no invitation emails.
- Order status changes in the commerce app need a write-capable connector; only internal notes are offered.
