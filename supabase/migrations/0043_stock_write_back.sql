-- Stock write-back: WorkRelay tells a shop its stock number. Off by default, owner-only, signed, verified, and checked again at the moment of sending.
--
-- What is sent: after an order, a cancellation or a return changes a product's estimate, the new ABSOLUTE number (never a difference) for that SKU
-- goes to the shop's own stock URL, signed with a secret only that shop and WorkRelay know. Nothing else leaves WorkRelay: no names, emails or prices.
--
-- The rules, kept in the database so no code path can skip them:
--  * integrations.stock_push_enabled needs a URL, a signing secret, a successful signed test (verified_at), estimating switched on, no platform
--    lock, and a connected shop. A table check enforces all of it, so even a direct write cannot turn it on without them.
--  * Only the workspace owner can turn it on, change the URL or rotate the secret (changing either switches it off and needs a new test).
--    Any member can turn it off. A platform admin can lock a shop: nothing is sent while locked.
--  * What is queued is checked again when it is claimed and once more right before the request leaves (stock_push_still_allowed): switching
--    off cancels everything queued and nothing in flight is sent after the check fails.
--  * Limits: 100 SKUs per request, 20 requests per minute and one request at a time per shop; 3 tries per SKU; 5 failed requests in a row
--    switch the feature off by itself. Estimates below zero are never sent.
--  * Every request and every SKU is logged for 30 days (who can read it: the workspace).
--  * When the shop's next report disagrees with the number WorkRelay pushed, nothing is overwritten: an open "conflict" records both numbers and the
--    owner decides (stock_conflicts, resolve_stock_conflict).

alter table public.integrations
  add column stock_push_url text check (stock_push_url is null or (stock_push_url ~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' and length(stock_push_url) <= 2000)),
  add column stock_push_enabled boolean not null default false,
  add column stock_push_verified_at timestamptz,        -- the last successful signed test for the current URL and secret
  add column stock_push_secret_id uuid,                 -- the signing secret, in Vault; never readable by a browser
  add column stock_push_secret_version int not null default 0,
  add column stock_push_locked boolean not null default false,  -- set by a platform admin
  add column stock_push_paused_reason text,             -- why WorkRelay switched it off by itself
  add column stock_push_failures int not null default 0,        -- failed requests in a row
  add column stock_push_has_secret boolean generated always as (stock_push_secret_id is not null) stored,
  add constraint stock_push_requires check (
    not stock_push_enabled or (stock_push_url is not null and stock_push_secret_id is not null and stock_push_verified_at is not null
                               and estimate_stock and not stock_push_locked and status = 'connected'));
grant select (stock_push_url, stock_push_enabled, stock_push_verified_at, stock_push_locked, stock_push_paused_reason, stock_push_has_secret)
  on public.integrations to authenticated;

alter table public.products
  add column last_pushed_stock bigint,   -- what WorkRelay last told the shop, until the shop's next report has been compared with it
  add column last_pushed_at timestamptz;

-- ------------------------------------------------------------------------------------------------ the log
create table public.stock_push_requests (
  id uuid primary key default gen_random_uuid(),   -- also the request id the shop sees, for repeat detection
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  kind text not null check (kind in ('stock', 'test')),
  url text not null,
  secret_version int not null,
  challenge text,                                  -- test only: the shop must send it back
  item_count int not null default 0,
  status text not null default 'sending' check (status in ('sending', 'ok', 'failed', 'cancelled')),
  http_status int,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index stock_push_requests_shop_idx on public.stock_push_requests (integration_id, created_at desc);
create index stock_push_requests_org_idx on public.stock_push_requests (organization_id, created_at desc);
create index stock_push_requests_sending_idx on public.stock_push_requests (created_at) where status = 'sending';

create table public.stock_push_items (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,         -- the shop can ignore a number older than one it already applied
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null,
  stock bigint,                                    -- null: skipped
  reason text not null check (reason in ('order', 'conflict')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  note text,
  attempts int not null default 0,
  due_at timestamptz not null default now(),
  request_id uuid references public.stock_push_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'skipped') = (stock is null))
);
create unique index stock_push_items_pending_idx on public.stock_push_items (product_id) where status = 'pending';
create index stock_push_items_claim_idx on public.stock_push_items (integration_id, due_at) where status = 'pending';
create index stock_push_items_request_idx on public.stock_push_items (request_id) where request_id is not null;

create table public.stock_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null,
  workrelay_value bigint not null,                 -- what WorkRelay had just before the shop's report
  shop_value int not null,                         -- what the shop reported
  detected_at timestamptz not null default now(),
  run_id uuid references public.product_sync_runs (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'kept_shop', 'sent_workrelay', 'agreed')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz
);
create unique index stock_conflicts_open_idx on public.stock_conflicts (product_id) where status = 'open';
create index stock_conflicts_org_idx on public.stock_conflicts (organization_id, detected_at desc);

alter table public.stock_push_requests enable row level security;
alter table public.stock_push_items enable row level security;
alter table public.stock_conflicts enable row level security;
create policy stock_push_requests_select on public.stock_push_requests for select using (is_org_member(organization_id));
create policy stock_push_items_select on public.stock_push_items for select using (is_org_member(organization_id));
create policy stock_conflicts_select on public.stock_conflicts for select using (is_org_member(organization_id));
revoke all on public.stock_push_requests, public.stock_push_items, public.stock_conflicts from anon, authenticated;
-- the signed test's challenge and the secret version stay in the database
grant select (id, organization_id, integration_id, kind, item_count, status, http_status, error, created_at, finished_at) on public.stock_push_requests to authenticated;
grant select (id, organization_id, integration_id, product_id, sku, stock, reason, status, note, attempts, request_id, created_at, updated_at) on public.stock_push_items to authenticated;
grant select on public.stock_conflicts to authenticated;

-- ------------------------------------------------------------------------------------------------ switching off
-- Drops everything waiting. A request already out cannot be recalled, but stock_push_still_allowed stops one that has not left yet.
create function public.cancel_stock_pushes(p_integration uuid, p_note text) returns void
language sql security definer set search_path = public as $$
  update stock_push_items set status = 'cancelled', note = left(p_note, 300), updated_at = now()
  where integration_id = p_integration and status in ('pending', 'sending');
$$;
revoke execute on function public.cancel_stock_pushes(uuid, text) from public, anon, authenticated;

-- Estimating off means no number to push: the two go off together (the table check would refuse otherwise).
create or replace function public.set_integration_estimate_stock(p_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_id for update;
  if not found or not has_org_role(i.organization_id, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  update integrations set estimate_stock = p_enabled,
    stock_push_enabled = stock_push_enabled and p_enabled,
    stock_push_paused_reason = case when stock_push_enabled and not p_enabled then 'Switched off because estimating stock was switched off.' else stock_push_paused_reason end,
    updated_at = now() where id = p_id;
  if i.stock_push_enabled and not p_enabled then perform cancel_stock_pushes(p_id, 'Write-back was switched off.'); end if;
end $$;

create or replace function public.revoke_integration(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from integrations where id = p_id;
  if org is null or not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update integrations set status = 'revoked', stock_push_enabled = false, updated_at = now() where id = p_id;
  perform cancel_stock_pushes(p_id, 'The connection was revoked.');
end $$;

-- ------------------------------------------------------------------------------------------------ settings (the workspace owner)
create function public.set_stock_push_url(p_integration uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations; u text := nullif(btrim(coalesce(p_url, '')), ''); host text;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  if u is not null then
    if u !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' or length(u) > 2000 then
      raise exception 'Use a full https address on the standard port, for example https://shop.example.com/workrelay/stock. No login in the address.';
    end if;
    host := lower(substring(u from '^https://([A-Za-z0-9.-]+)'));
    if host = 'localhost' or host ~ '\.(local|localhost|internal)$' or host ~ '^[0-9.]+$' or host !~ '\.' then
      raise exception 'Use the shop''s public domain name. Local and numeric addresses are not allowed.';
    end if;
  end if;
  -- a new address is a new destination: it has to pass the signed test again before anything is sent to it
  update integrations set stock_push_url = u, stock_push_enabled = false, stock_push_verified_at = null,
    stock_push_failures = 0, stock_push_paused_reason = null, updated_at = now() where id = p_integration;
  perform cancel_stock_pushes(p_integration, 'The stock address was changed.');
end $$;

-- Makes (or replaces) the signing secret and returns it ONCE; Vault keeps the only copy, and nothing can read it back to a browser.
create function public.rotate_stock_push_secret(p_integration uuid) returns text
language plpgsql security definer set search_path = public, extensions, vault as $$
declare i integrations; raw text := 'wr_sign_' || encode(gen_random_bytes(32), 'hex'); sid uuid;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not has_org_role(i.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status = 'revoked' then raise exception 'this connection is revoked'; end if;
  if i.stock_push_secret_id is null then
    sid := vault.create_secret(raw, 'stock_push:' || p_integration::text, 'WorkRelay stock write-back signing secret');
  else
    sid := i.stock_push_secret_id;
    perform vault.update_secret(sid, raw);
  end if;
  update integrations set stock_push_secret_id = sid, stock_push_secret_version = stock_push_secret_version + 1,
    stock_push_enabled = false, stock_push_verified_at = null, stock_push_failures = 0, stock_push_paused_reason = null, updated_at = now()
  where id = p_integration;
  perform cancel_stock_pushes(p_integration, 'The signing secret was replaced.');
  return raw;
end $$;

-- on: the owner only, and only when every condition holds. off: any member of the workspace.
create function public.set_stock_push_enabled(p_integration uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i integrations;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not is_org_member(i.organization_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled then
    if not has_org_role(i.organization_id, array['owner']::org_role[]) then raise exception 'Only the workspace owner can switch stock write-back on.' using errcode = '42501'; end if;
    if i.status <> 'connected' then raise exception 'This shop is not connected.'; end if;
    if i.stock_push_locked then raise exception 'WorkRelay has blocked stock write-back for this shop.'; end if;
    if not i.estimate_stock then raise exception 'Switch on "Estimate stock between syncs" first: the estimate is the number that gets sent.'; end if;
    if i.stock_push_url is null then raise exception 'Add the shop''s stock address first.'; end if;
    if i.stock_push_secret_id is null then raise exception 'Create a signing secret first.'; end if;
    if i.stock_push_verified_at is null then raise exception 'Send a test first: the shop has to answer a signed request correctly.'; end if;
    update integrations set stock_push_enabled = true, stock_push_failures = 0, stock_push_paused_reason = null, updated_at = now() where id = p_integration;
  else
    update integrations set stock_push_enabled = false, stock_push_paused_reason = null, updated_at = now() where id = p_integration;
    perform cancel_stock_pushes(p_integration, 'Write-back was switched off.');
  end if;
end $$;

-- A platform admin can block a shop from receiving stock numbers at all.
create function public.admin_set_stock_push_locked(p_integration uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update integrations set stock_push_locked = p_locked,
    stock_push_enabled = stock_push_enabled and not p_locked,
    stock_push_paused_reason = case when p_locked and stock_push_enabled then 'Blocked by WorkRelay.' else stock_push_paused_reason end,
    updated_at = now() where id = p_integration;
  if p_locked then perform cancel_stock_pushes(p_integration, 'Blocked by WorkRelay.'); end if;
end $$;

-- ------------------------------------------------------------------------------------------------ the signed test
-- Called by the test endpoint with the person's id. Only the owner may test; at most one test every 10 seconds per shop.
create function public.begin_stock_push_test(p_user uuid, p_integration uuid)
returns table (request_id uuid, store_id text, url text, secret text, challenge text)
language plpgsql security definer set search_path = public, extensions, vault as $$
declare i integrations; rid uuid; ch text := encode(gen_random_bytes(16), 'hex'); sec text;
begin
  select * into i from integrations where id = p_integration for update;
  if not found or not exists (select 1 from memberships m where m.organization_id = i.organization_id and m.user_id = p_user and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if i.status <> 'connected' then raise exception 'not_connected'; end if;
  if i.stock_push_locked then raise exception 'locked'; end if;
  if i.stock_push_url is null then raise exception 'no_url'; end if;
  if i.stock_push_secret_id is null then raise exception 'no_secret'; end if;
  if exists (select 1 from stock_push_requests r where r.integration_id = p_integration and r.kind = 'test' and r.created_at > now() - interval '10 seconds') then
    raise exception 'too_soon';
  end if;
  select decrypted_secret into sec from vault.decrypted_secrets where id = i.stock_push_secret_id;
  if sec is null then raise exception 'no_secret'; end if;
  insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version, challenge)
  values (i.organization_id, p_integration, 'test', i.stock_push_url, i.stock_push_secret_version, ch) returning id into rid;
  return query select rid, i.external_store_id, i.stock_push_url, sec, ch;
end $$;

-- Marks the shop verified only if the address and the secret are still the ones that were tested.
create function public.finish_stock_push_test(p_request uuid, p_ok boolean, p_http int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r stock_push_requests;
begin
  select * into r from stock_push_requests where id = p_request and kind = 'test' and status = 'sending' for update;
  if not found then return; end if;
  update stock_push_requests set status = case when p_ok then 'ok' else 'failed' end, http_status = p_http,
    error = case when p_ok then null else left(coalesce(p_error, 'failed'), 300) end, finished_at = now() where id = p_request;
  if p_ok then
    update integrations set stock_push_verified_at = now(), updated_at = now()
    where id = r.integration_id and stock_push_url = r.url and stock_push_secret_version = r.secret_version;
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------ queueing (from the estimate checks)
-- Called when an order, a cancellation or a return changed the estimate of these products. Only shops with write-back on.
create function public.enqueue_stock_pushes(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid; r record; queued int := 0;
begin
  -- nearly every call is for a shop that does not use write-back: leave before doing any work
  if not exists (select 1 from products p join integrations i on i.id = p.integration_id
                 where p.id = any(p_ids) and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected') then
    return;
  end if;
  for o in select distinct organization_id from products where id = any(p_ids) loop
    for r in
      select p.organization_id, p.integration_id, p.id as product_id, p.sku, e.estimated
      from stock_estimates(o, p_ids) e
      join products p on p.id = e.product_id
      join integrations i on i.id = p.integration_id and i.stock_push_enabled and not i.stock_push_locked and i.status = 'connected'
    loop
      if r.estimated < 0 or r.estimated > 2147483647 then
        -- never sent: whatever was waiting for this product is dropped, and the skip is logged with its reason
        update stock_push_items set status = 'cancelled', note = 'replaced by a newer value', updated_at = now()
        where product_id = r.product_id and status = 'pending';
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason, status, note)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, null, 'order', 'skipped',
                'The estimate is ' || r.estimated || ', outside what can be sent (0 and up): not sent.');
      else
        insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason)
        values (r.organization_id, r.integration_id, r.product_id, r.sku, r.estimated, 'order')
        on conflict (product_id) where status = 'pending' do update set stock = excluded.stock, updated_at = now(), due_at = now(), reason = 'order';
        queued := queued + 1;
      end if;
    end loop;
  end loop;
  if queued > 0 then perform kick_engine(); end if;
end $$;
revoke execute on function public.enqueue_stock_pushes(uuid[]) from public, anon, authenticated;

create or replace function public.process_estimate_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  with taken as (delete from estimate_checks where txid = txid_current() returning product_id)
  select array_agg(product_id) into ids from taken;
  if ids is not null then
    begin
      perform check_estimated_lows(ids);
    exception when others then
      raise warning 'estimated low-stock check failed: %', sqlerrm;
    end;
    begin
      perform enqueue_stock_pushes(ids);
    exception when others then
      raise warning 'stock write-back queueing failed: %', sqlerrm;
    end;
  end if;
  return null;
end $$;

-- ------------------------------------------------------------------------------------------------ sending (the engine)
-- Takes the next batch for each shop that is allowed to receive one. Everything is decided here, in the database, in one place.
create function public.claim_stock_pushes(p_max_shops int default 10)
returns table (request_id uuid, integration_id uuid, store_id text, url text, secret text, items jsonb)
language plpgsql security definer set search_path = public, vault as $$
declare i integrations; rid uuid; sec text; its jsonb; n int; stuck record;
begin
  -- housekeeping (rows older than 30 days) at most every 10 minutes: the engine calls this every few seconds
  if pg_try_advisory_xact_lock(hashtext('stock_push_housekeeping'))
     and coalesce((select last_run from maintenance_state where key = 'stock_push_housekeeping'), '-infinity') < now() - interval '10 minutes' then
    delete from stock_push_items where created_at < now() - interval '30 days' and status in ('sent', 'failed', 'skipped', 'cancelled');
    delete from stock_push_requests where created_at < now() - interval '30 days';
    insert into maintenance_state (key, last_run) values ('stock_push_housekeeping', now())
    on conflict (key) do update set last_run = excluded.last_run;
  end if;
  -- a request nobody reported back on counts as failed, so its SKUs are tried again and the failure is counted
  for stuck in select id from stock_push_requests where status = 'sending' and created_at < now() - interval '2 minutes' order by id for update skip locked loop
    perform complete_stock_push(stuck.id, false, null, 'No answer was recorded.');
  end loop;

  for i in
    select x.* from integrations x
    where x.stock_push_enabled and not x.stock_push_locked and x.stock_push_verified_at is not null and x.status = 'connected'
      and exists (select 1 from stock_push_items s where s.integration_id = x.id and s.status = 'pending' and s.due_at <= now())
      and not exists (select 1 from stock_push_requests r where r.integration_id = x.id and r.status = 'sending')
      and (select count(*) from stock_push_requests r where r.integration_id = x.id and r.created_at > now() - interval '1 minute') < 20
    order by x.id limit p_max_shops for update of x skip locked
  loop
    select decrypted_secret into sec from vault.decrypted_secrets where id = i.stock_push_secret_id;
    if sec is null then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off: the signing secret is missing.' where id = i.id;
      perform cancel_stock_pushes(i.id, 'The signing secret is missing.');
      continue;
    end if;
    insert into stock_push_requests (organization_id, integration_id, kind, url, secret_version)
    values (i.organization_id, i.id, 'stock', i.stock_push_url, i.stock_push_secret_version) returning id into rid;
    with picked as (
      select s.id from stock_push_items s where s.integration_id = i.id and s.status = 'pending' and s.due_at <= now()
      order by s.seq limit 100 for update skip locked
    ), upd as (
      update stock_push_items s set status = 'sending', request_id = rid, attempts = s.attempts + 1, updated_at = now()
      from picked where s.id = picked.id returning s.sku, s.stock, s.seq, s.updated_at
    )
    select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'stock', stock, 'seq', seq, 'as_of', updated_at) order by seq), '[]'::jsonb), count(*)
    into its, n from upd;
    update stock_push_requests set item_count = n where id = rid;
    request_id := rid; integration_id := i.id; store_id := i.external_store_id; url := i.stock_push_url; secret := sec; items := its;
    return next;
  end loop;
end $$;

-- One more look right before the request leaves. False: do not send (the request is cancelled).
create function public.stock_push_still_allowed(p_request uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r stock_push_requests; i integrations; ok boolean;
begin
  select * into r from stock_push_requests where id = p_request and status = 'sending' for update;
  if not found then return false; end if;
  select * into i from integrations where id = r.integration_id;
  ok := i.status = 'connected' and not i.stock_push_locked and i.stock_push_url = r.url and i.stock_push_secret_version = r.secret_version
        and (r.kind = 'test' or (i.stock_push_enabled and i.stock_push_verified_at is not null));
  if not ok then
    update stock_push_requests set status = 'cancelled', error = 'Not sent: write-back was switched off or changed.', finished_at = now() where id = p_request;
    update stock_push_items set status = 'cancelled', note = 'Not sent: write-back was switched off or changed.', updated_at = now() where request_id = p_request and status = 'sending';
  end if;
  return ok;
end $$;

-- The shop answered (or did not). Success: the numbers are recorded as pushed. Failure: each SKU is tried again (1 and 5 minutes later),
-- and 5 failed requests in a row switch write-back off.
create function public.complete_stock_push(p_request uuid, p_ok boolean, p_http int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r stock_push_requests; i integrations; fails int;
begin
  select * into r from stock_push_requests where id = p_request and kind = 'stock' and status = 'sending' for update;
  if not found then return; end if;
  select * into i from integrations where id = r.integration_id for update;
  if p_ok then
    update stock_push_requests set status = 'ok', http_status = p_http, finished_at = now() where id = p_request;
    update stock_push_items set status = 'sent', note = null, updated_at = now() where request_id = p_request and status = 'sending';
    update products p set last_pushed_stock = x.stock, last_pushed_at = now()
    from stock_push_items x where x.request_id = p_request and x.status = 'sent' and x.product_id = p.id;
    update integrations set stock_push_failures = 0 where id = r.integration_id;
  else
    update stock_push_requests set status = 'failed', http_status = p_http, error = left(coalesce(p_error, 'failed'), 300), finished_at = now() where id = p_request;
    update stock_push_items x set status = 'cancelled', note = 'replaced by a newer value', updated_at = now()
    where x.request_id = p_request and x.status = 'sending' and exists (select 1 from stock_push_items y where y.product_id = x.product_id and y.status = 'pending');
    update stock_push_items x set updated_at = now(), note = left(coalesce(p_error, 'failed'), 300),
      status = case when x.attempts >= 3 then 'failed' else 'pending' end,
      due_at = now() + case when x.attempts = 1 then interval '1 minute' else interval '5 minutes' end
    where x.request_id = p_request and x.status = 'sending';
    update integrations set stock_push_failures = stock_push_failures + 1 where id = r.integration_id returning stock_push_failures into fails;
    if fails >= 5 and i.stock_push_enabled then
      update integrations set stock_push_enabled = false, stock_push_paused_reason = 'Switched off after 5 failed requests in a row. Last error: ' || left(coalesce(p_error, 'failed'), 200)
      where id = r.integration_id;
      perform cancel_stock_pushes(r.integration_id, 'Write-back was switched off after repeated failures.');
    end if;
  end if;
end $$;

revoke execute on function public.begin_stock_push_test(uuid, uuid), public.finish_stock_push_test(uuid, boolean, int, text),
  public.claim_stock_pushes(int), public.stock_push_still_allowed(uuid), public.complete_stock_push(uuid, boolean, int, text)
  from public, anon, authenticated;
grant execute on function public.begin_stock_push_test(uuid, uuid), public.finish_stock_push_test(uuid, boolean, int, text),
  public.claim_stock_pushes(int), public.stock_push_still_allowed(uuid), public.complete_stock_push(uuid, boolean, int, text) to service_role;

revoke execute on function public.set_stock_push_url(uuid, text), public.rotate_stock_push_secret(uuid), public.set_stock_push_enabled(uuid, boolean),
  public.admin_set_stock_push_locked(uuid, boolean) from public, anon;
grant execute on function public.set_stock_push_url(uuid, text), public.rotate_stock_push_secret(uuid), public.set_stock_push_enabled(uuid, boolean),
  public.admin_set_stock_push_locked(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------------------------------------ conflicts
-- Compares the shop's report with the number WorkRelay held just before it, for the products WorkRelay has pushed to.
-- Disagreement opens (or refreshes) one conflict per product; agreement closes it. Either way the push has now been judged.
create function public.record_stock_conflicts(p_run uuid, p_integration uuid, p_snapshot jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  create temporary table if not exists _stock_cmp (product_id uuid, org uuid, sku text, wr bigint, shop int) on commit drop;
  delete from _stock_cmp;
  insert into _stock_cmp
  select p.id, p.organization_id, p.sku, (s.value->>'wr')::bigint, p.stock
  from jsonb_each(p_snapshot) s
  join products p on p.id = s.key::uuid
  where p.integration_id = p_integration and p.stock is not null and p.reported_at > (s.value->>'rep')::timestamptz;
  insert into stock_conflicts (organization_id, integration_id, product_id, sku, workrelay_value, shop_value, run_id)
  select org, p_integration, product_id, sku, wr, shop, p_run from _stock_cmp where shop <> wr
  on conflict (product_id) where status = 'open' do update set workrelay_value = excluded.workrelay_value, shop_value = excluded.shop_value,
    detected_at = now(), run_id = excluded.run_id;
  update stock_conflicts c set status = 'agreed', decided_at = now()
  from _stock_cmp m where c.product_id = m.product_id and c.status = 'open' and m.shop = m.wr;
  update products p set last_pushed_stock = null, last_pushed_at = null from _stock_cmp m where p.id = m.product_id;
end $$;
revoke execute on function public.record_stock_conflicts(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.run_product_sync(
  p_integration uuid, p_items jsonb, p_source text, p_at timestamptz, p_trigger text, p_by_name text default null, p_by_role text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare org uuid; push_on boolean; run uuid := gen_random_uuid(); n int; ids uuid[]; snap jsonb := '{}'::jsonb;
begin
  select organization_id, stock_push_enabled into org, push_on from integrations where id = p_integration;
  if org is null then raise exception 'shop is not connected'; end if;
  delete from product_sync_runs where integration_id = p_integration and created_at < now() - interval '30 days';
  insert into product_sync_runs (id, organization_id, integration_id, source, trigger, by_name, by_role, received, status)
  values (run, org, p_integration, p_source, p_trigger, nullif(left(btrim(coalesce(p_by_name, '')), 120), ''),
          nullif(left(btrim(coalesce(p_by_role, '')), 60), ''),
          case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end, 'ok');
  if push_on then
    select array_agg(id) into ids from products where integration_id = p_integration and last_pushed_at is not null;
    if ids is not null then
      select coalesce(jsonb_object_agg(e.product_id, jsonb_build_object('wr', e.estimated, 'rep', e.as_of)), '{}'::jsonb) into snap from stock_estimates(org, ids) e;
    end if;
  end if;
  perform set_config('workrelay.sync_run', run::text, true);
  n := apply_product_sync(p_integration, p_items, p_source, p_at);
  perform flush_first_reports(run, p_integration); -- 0035
  perform set_config('workrelay.sync_run', '', true);
  if snap <> '{}'::jsonb then perform record_stock_conflicts(run, p_integration, snap); end if;
  update product_sync_runs set changed = (
    select count(*) from (select product_id from stock_events where run_id = run union select product_id from price_events where run_id = run) c
  ) where id = run;
  return n;
end $$;

-- The owner decides. "shop": keep the shop's number (nothing else happens). "workrelay": send WorkRelay's number, less what sold since.
create function public.resolve_stock_conflict(p_conflict uuid, p_choice text) returns void
language plpgsql security definer set search_path = public as $$
declare c stock_conflicts; i integrations; v bigint;
begin
  if p_choice not in ('shop', 'workrelay') then raise exception 'choose the shop or WorkRelay'; end if;
  select * into c from stock_conflicts where id = p_conflict for update;
  if not found or not has_org_role(c.organization_id, array['owner']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This conflict was already decided.'; end if;
  if p_choice = 'shop' then
    update stock_conflicts set status = 'kept_shop', decided_by = auth.uid(), decided_at = now() where id = p_conflict;
    return;
  end if;
  select * into i from integrations where id = c.integration_id for share;
  if not (i.stock_push_enabled and not i.stock_push_locked and i.stock_push_verified_at is not null and i.status = 'connected') then
    raise exception 'Stock write-back is off for this shop, so WorkRelay cannot send its number. Switch it on, or keep the shop''s number.';
  end if;
  v := c.workrelay_value - estimated_sold(c.integration_id, c.sku, c.detected_at);
  if v < 0 or v > 2147483647 then raise exception 'WorkRelay''s number would be below zero, so it is not sent. Keep the shop''s number.'; end if;
  insert into stock_push_items (organization_id, integration_id, product_id, sku, stock, reason)
  values (c.organization_id, c.integration_id, c.product_id, c.sku, v, 'conflict')
  on conflict (product_id) where status = 'pending' do update set stock = excluded.stock, updated_at = now(), due_at = now(), reason = 'conflict';
  update stock_conflicts set status = 'sent_workrelay', decided_by = auth.uid(), decided_at = now() where id = p_conflict;
  perform kick_engine();
end $$;
revoke execute on function public.resolve_stock_conflict(uuid, text) from public, anon;
grant execute on function public.resolve_stock_conflict(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------------------ reading
create function public.list_stock_pushes(p_org uuid, p_integration uuid default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, integration_id uuid, integration_name text, kind text, item_count int, status text, http_status int, error text,
               created_at timestamptz, finished_at timestamptz, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select r.id, r.integration_id, i.name, r.kind, r.item_count, r.status, r.http_status, r.error, r.created_at, r.finished_at, count(*) over ()
  from stock_push_requests r join integrations i on i.id = r.integration_id
  where r.organization_id = p_org and (p_integration is null or r.integration_id = p_integration)
  order by r.created_at desc, r.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

create function public.stock_push_request_items(p_request uuid, p_limit int default 200)
returns table (sku text, name text, stock bigint, status text, note text, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select x.sku, p.name, x.stock, x.status, x.note, count(*) over ()
  from stock_push_items x join products p on p.id = x.product_id
  where x.request_id = p_request
  order by x.seq
  limit least(greatest(p_limit, 1), 500)
$$;

create function public.list_stock_conflicts(p_org uuid, p_status text default 'open', p_limit int default 50, p_offset int default 0)
returns table (id uuid, integration_id uuid, integration_name text, product_id uuid, sku text, name text, workrelay_value bigint, shop_value int,
               detected_at timestamptz, status text, decided_at timestamptz, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select c.id, c.integration_id, i.name, c.product_id, c.sku, p.name, c.workrelay_value, c.shop_value, c.detected_at, c.status, c.decided_at, count(*) over ()
  from stock_conflicts c join integrations i on i.id = c.integration_id join products p on p.id = c.product_id
  where c.organization_id = p_org and (p_status = 'all' or (p_status = 'open' and c.status = 'open') or (p_status = 'decided' and c.status <> 'open'))
  order by c.detected_at desc, c.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke execute on function public.list_stock_pushes(uuid, uuid, int, int), public.stock_push_request_items(uuid, int),
  public.list_stock_conflicts(uuid, text, int, int) from public, anon;
grant execute on function public.list_stock_pushes(uuid, uuid, int, int), public.stock_push_request_items(uuid, int),
  public.list_stock_conflicts(uuid, text, int, int) to authenticated;
