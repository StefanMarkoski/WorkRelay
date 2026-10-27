-- Test-only: stands in for the table GoTrue creates in a real Supabase project.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);
grant select on auth.users to postgres;
