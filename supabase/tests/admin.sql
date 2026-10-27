-- Platform admin authorization.
begin;

create schema admin_test;
grant usage on schema admin_test to authenticated, anon;
create function admin_test.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema admin_test to authenticated;

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok   - %', label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'super@t.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'tenant-owner@t.dev'),
  ('00000000-0000-0000-0000-0000000000c3', 'new-owner@t.dev');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into organizations (id, name, created_by) values ('a0000000-0000-0000-0000-0000000000c2', 'Existing', '00000000-0000-0000-0000-0000000000c2');
insert into memberships values ('a0000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'owner');

-- ordinary user
select admin_test.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check('ordinary users are not platform admins', not is_platform_admin());
do $$ begin
  begin perform * from admin_list_tenants(); raise exception 'FAIL: non-admin listed tenants';
  exception when insufficient_privilege then raise notice 'ok   - non-admins cannot list tenants'; end;
end $$;
do $$ begin
  begin insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c2'); raise exception 'FAIL: user made themselves admin';
  exception when insufficient_privilege then raise notice 'ok   - users cannot add themselves to platform_admins'; end;
end $$;
do $$ begin
  begin perform admin_create_tenant('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3', 'Evil');
    raise exception 'FAIL: client called admin_create_tenant';
  exception when insufficient_privilege then raise notice 'ok   - clients cannot call admin_create_tenant'; end;
end $$;
reset role;

-- platform admin
select admin_test.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check('platform admin is recognised', is_platform_admin());
select pg_temp.check('platform admin lists all tenants with owners and counts',
  (select count(*) = 1 and bool_and(owner_emails = array['tenant-owner@t.dev'] and members = 1) from admin_list_tenants()));
select pg_temp.check('platform admin gets no direct access to tenant data', (select count(*) from organizations) = 0);
reset role;

-- service-role path: only a real platform admin may be the caller
select pg_temp.check('create tenant works for a platform admin caller',
  (select admin_create_tenant('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3', '  Acme  ')) is not null);
select pg_temp.check('new tenant has the owner membership and a trimmed name',
  (select count(*) = 1 from organizations o join memberships m on m.organization_id = o.id
   where o.name = 'Acme' and m.user_id = '00000000-0000-0000-0000-0000000000c3' and m.role = 'owner'));
do $$ begin
  begin perform admin_create_tenant('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3', 'X');
    raise exception 'FAIL: non-admin caller accepted';
  exception when insufficient_privilege then raise notice 'ok   - non-admin caller is refused even with the service role'; end;
end $$;
do $$ begin
  begin perform admin_create_tenant('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c3', '   ');
    raise exception 'FAIL: blank name accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   - blank tenant name is rejected'; end;
end $$;

rollback;
\echo ADMIN CHECKS PASSED
