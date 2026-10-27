-- verify_engine_secret against Vault. Skipped when Vault is not available in the test image.
begin;
do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'skip - vault not available'; return;
  end if;
  perform vault.create_secret('s3cret-value', 'engine_secret');
  if not public.verify_engine_secret('s3cret-value') then raise exception 'FAIL: correct secret rejected'; end if;
  if public.verify_engine_secret('wrong') then raise exception 'FAIL: wrong secret accepted'; end if;
  if public.verify_engine_secret('') or public.verify_engine_secret(null) then raise exception 'FAIL: empty secret accepted'; end if;
  raise notice 'ok   - engine secret verification';
end $$;
-- anon/authenticated cannot call it
set local role authenticated;
do $$ begin
  begin perform public.verify_engine_secret('x'); raise exception 'FAIL: authenticated can verify secrets';
  exception when insufficient_privilege then raise notice 'ok   - clients cannot call verify_engine_secret'; end;
end $$;
rollback;
\echo ENGINE SECRET CHECKS PASSED
