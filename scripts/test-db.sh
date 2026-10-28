#!/usr/bin/env bash
# Rebuilds a throwaway Supabase Postgres in Docker, applies every migration, and runs the SQL tests.
# Usage: scripts/test-db.sh        (needs Docker; uses port 54399)
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=workrelay-testdb
IMAGE=supabase/postgres:15.8.1.085

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 54399:5432 "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 3 # image runs init scripts after the first ready signal

psql_run() { docker exec -i "$NAME" psql -U postgres -h localhost -v ON_ERROR_STOP=1 -q "$@"; }
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  psql_run < "$f"
done
# pg_net ships with the image but is not enabled by default; hosted Supabase has it after the setup guide.
docker exec -i "$NAME" psql -U supabase_admin -d postgres -h localhost -q -c "create extension if not exists pg_net" >/dev/null
for f in supabase/tests/*.sql; do
  [ "$(basename "$f")" = "00_auth_shim.sql" ] && continue
  echo "test: $f"
  psql_run < "$f" 2>&1 | grep -E "ERROR|FAIL|PASSED|skip - |engine secret verification|skip - |ok   - .*kick|published" || true
  psql_run < "$f" >/dev/null 2>"/tmp/$NAME.err" || { cat "/tmp/$NAME.err"; exit 1; }
done
echo "all database tests passed"
