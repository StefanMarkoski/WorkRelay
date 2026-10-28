-- Automations are generated from presets. Their definitions can contain destination URLs (for example a Discord
-- webhook, which acts like a secret), so workflows and their versions are readable by owners and admins only.

alter table public.workflows
  add column preset text check (preset in ('notify', 'review_large')),
  add column preset_config jsonb;

drop policy wf_select on public.workflows;
drop policy wv_select on public.workflow_versions;
create policy wf_select on public.workflows for select
  using (has_org_role(organization_id, array['owner','admin']::org_role[]));
create policy wv_select on public.workflow_versions for select
  using (has_org_role(organization_id, array['owner','admin']::org_role[]));

grant insert (preset, preset_config) on public.workflows to authenticated;
grant update (preset_config) on public.workflows to authenticated;
