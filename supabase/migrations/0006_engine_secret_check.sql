-- The engine endpoint is authenticated against a secret kept in Supabase Vault (name: 'engine_secret').
-- The same Vault secret is read by the pg_cron job, so the value never needs to be set as a function env var.
create function public.verify_engine_secret(p_secret text) returns boolean
language plpgsql security definer set search_path = public, extensions, vault as $$
declare expected text;
begin
  if p_secret is null or p_secret = '' then return false; end if;
  select decrypted_secret into expected from vault.decrypted_secrets where name = 'engine_secret' limit 1;
  if expected is null then return false; end if;
  -- Compare digests so the comparison does not leak how many leading characters matched.
  return digest(expected, 'sha256') = digest(p_secret, 'sha256');
end $$;

revoke execute on function public.verify_engine_secret(text) from public, anon, authenticated;
grant execute on function public.verify_engine_secret(text) to service_role;
