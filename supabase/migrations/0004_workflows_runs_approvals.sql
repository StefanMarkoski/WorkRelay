-- Workflows, immutable versions, runs, approvals, plus key rotation, member and note RPCs.

create type public.workflow_status as enum ('draft', 'published');
create type public.run_status as enum ('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  status public.workflow_status not null default 'draft',
  enabled boolean not null default false,
  draft_definition jsonb not null default '{}',
  current_version_id uuid,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflows_org_idx on public.workflows (organization_id, updated_at desc);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version int not null,
  definition jsonb not null,
  published_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);

alter table public.workflows
  add constraint workflows_current_version_fk foreign key (current_version_id) references public.workflow_versions (id),
  add constraint workflows_enabled_requires_version check (not enabled or current_version_id is not null);

-- Published versions are immutable.
create function public.block_version_update() returns trigger language plpgsql as $$
begin raise exception 'workflow versions are immutable'; end $$;
create trigger workflow_versions_immutable before update on public.workflow_versions
  for each row execute function public.block_version_update();

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  version_id uuid not null references public.workflow_versions (id),
  trigger_source text not null,
  event_id text,
  status public.run_status not null default 'pending',
  attempt int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index workflow_runs_event_uniq on public.workflow_runs (workflow_id, event_id) where event_id is not null;
create index workflow_runs_org_idx on public.workflow_runs (organization_id, created_at desc);

create table public.step_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  step_key text not null,
  step_name text,
  step_type text,
  position int not null default 0,
  status public.run_status not null default 'pending',
  input jsonb,   -- sensitive fields redacted before write
  output jsonb,  -- sensitive fields redacted before write
  error text,
  attempt int not null default 0,
  started_at timestamptz,
  finished_at timestamptz
);
create index step_runs_run_idx on public.step_runs (run_id, position);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid references public.workflow_runs (id) on delete cascade,
  step_key text,
  title text not null,
  context jsonb not null default '{}',
  reviewer_user_id uuid references auth.users (id),
  reviewer_role public.org_role not null default 'admin',
  status public.approval_status not null default 'pending',
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create index approvals_org_idx on public.approvals (organization_id, status, created_at desc);

alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.step_runs enable row level security;
alter table public.approvals enable row level security;

create policy wf_select on public.workflows for select using (is_org_member(organization_id));
create policy wf_insert on public.workflows for insert
  with check (has_org_role(organization_id, array['owner','admin']::org_role[]));
create policy wf_update on public.workflows for update
  using (has_org_role(organization_id, array['owner','admin']::org_role[]))
  with check (has_org_role(organization_id, array['owner','admin']::org_role[]));
create policy wv_select on public.workflow_versions for select using (is_org_member(organization_id));
create policy wr_select on public.workflow_runs for select using (is_org_member(organization_id));
create policy sr_select on public.step_runs for select using (is_org_member(organization_id));
create policy ap_select on public.approvals for select using (is_org_member(organization_id));

revoke all on public.workflows, public.workflow_versions, public.workflow_runs, public.step_runs, public.approvals
  from anon, authenticated;
grant select on public.workflows, public.workflow_versions, public.workflow_runs, public.step_runs, public.approvals
  to authenticated;
grant insert (organization_id, name, description, draft_definition) on public.workflows to authenticated;
grant update (name, description, draft_definition, enabled) on public.workflows to authenticated;

-- Publishing is server-side only: the publish-workflow Edge Function validates the definition,
-- then calls this with the service role.
create function public.publish_workflow(p_workflow uuid, p_definition jsonb, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare wf workflows; next_version int; vid uuid;
begin
  select * into wf from workflows where id = p_workflow for update;
  if not found then raise exception 'workflow not found'; end if;
  if not exists (select 1 from memberships where organization_id = wf.organization_id and user_id = p_user
                 and role in ('owner','admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from workflow_versions where workflow_id = p_workflow;
  insert into workflow_versions (workflow_id, organization_id, version, definition, published_by)
    values (p_workflow, wf.organization_id, next_version, p_definition, p_user) returning id into vid;
  update workflows set status = 'published', current_version_id = vid, draft_definition = p_definition,
    updated_at = now() where id = p_workflow;
  return vid;
end $$;
revoke execute on function public.publish_workflow(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.publish_workflow(uuid, jsonb, uuid) to service_role;

-- Approval decisions. Resuming the paused run is the execution engine's job (it reads decided approvals).
create function public.decide_approval(p_id uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a approvals; allowed org_role[];
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;
  select * into a from approvals where id = p_id for update;
  if not found or not is_org_member(a.organization_id) then raise exception 'not found'; end if;
  if a.status <> 'pending' then raise exception 'already decided'; end if;
  if a.reviewer_user_id is not null then
    if a.reviewer_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    allowed := case a.reviewer_role
      when 'member' then array['owner','admin','member']::org_role[]
      when 'owner' then array['owner']::org_role[]
      else array['owner','admin']::org_role[] end;
    if not has_org_role(a.organization_id, allowed) then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  update approvals set status = p_decision::approval_status, decided_by = auth.uid(),
    decided_at = now(), comment = nullif(trim(p_comment), '') where id = p_id;
end $$;
revoke execute on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- Integration key lifecycle
create function public.revoke_integration(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from integrations where id = p_id;
  if org is null or not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update integrations set status = 'revoked', updated_at = now() where id = p_id;
end $$;

-- Rotation keeps the store binding; the commerce app must be updated with the new key.
create function public.rotate_integration_key(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare org uuid; raw text;
begin
  select organization_id into org from integrations where id = p_id and status <> 'revoked';
  if org is null or not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  raw := 'wr_live_' || encode(gen_random_bytes(32), 'hex');
  update integrations set key_prefix = left(raw, 12), key_hash = digest(raw, 'sha256'), updated_at = now()
    where id = p_id;
  return raw;
end $$;

-- Members
create function public.list_members(org uuid)
returns table (user_id uuid, email text, role public.org_role, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_org_member(org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select m.user_id, u.email::text, m.role, m.created_at
    from memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = org order by m.created_at;
end $$;

-- Adds an existing WorkRelay user. (No invitation emails in this phase.)
create function public.add_member_by_email(org uuid, member_email text, member_role public.org_role) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not has_org_role(org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if member_role = 'owner' then raise exception 'cannot add owners'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(member_email));
  if uid is null then raise exception 'user_not_found'; end if;
  insert into memberships (organization_id, user_id, role) values (org, uid, member_role)
    on conflict do nothing;
end $$;

create function public.guard_last_owner() returns trigger language plpgsql as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from organizations where id = old.organization_id)
     and not exists (select 1 from memberships where organization_id = old.organization_id
                     and role = 'owner' and user_id <> old.user_id) then
    raise exception 'an organization must keep at least one owner';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_last_owner before update or delete on public.memberships
  for each row execute function public.guard_last_owner();

-- Internal notes are WorkRelay-authored timeline entries.
create function public.add_order_note(p_order uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from orders where id = p_order;
  if org is null or not is_org_member(org) then raise exception 'not found'; end if;
  if char_length(trim(coalesce(p_note, ''))) not between 1 and 2000 then raise exception 'invalid note'; end if;
  insert into order_events (organization_id, order_id, source, type, occurred_at, actor_user_id, data)
    values (org, p_order, 'workrelay', 'note.added', now(), auth.uid(), jsonb_build_object('note', trim(p_note)));
end $$;

revoke execute on function public.revoke_integration(uuid), public.rotate_integration_key(uuid),
  public.list_members(uuid), public.add_member_by_email(uuid, text, public.org_role),
  public.add_order_note(uuid, text) from public, anon;
grant execute on function public.revoke_integration(uuid), public.rotate_integration_key(uuid),
  public.list_members(uuid), public.add_member_by_email(uuid, text, public.org_role),
  public.add_order_note(uuid, text) to authenticated;
