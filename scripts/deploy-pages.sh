#!/usr/bin/env bash
# Builds the app and publishes dist/ to the gh-pages branch (GitHub Pages "deploy from branch").
# No GitHub Actions needed. Reads VITE_SUPABASE_* from .env.local.
# Optional: GIT_PUSH_AUTH_USER=<gh account> pushes with that `gh` account's token for this one push.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_URL=$(git remote get-url origin)
REPO_NAME=$(basename "$REMOTE_URL" .git)

set -a; . ./.env.local; set +a
BASE_PATH="/${REPO_NAME}/" npm run build

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -r dist/. "$TMP"/
touch "$TMP/.nojekyll"
cp "$TMP/index.html" "$TMP/404.html"

cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)"

ARGS=(-c credential.helper=)
if [ -n "${GIT_PUSH_AUTH_USER:-}" ]; then
  TOKEN=$(gh auth token --user "$GIT_PUSH_AUTH_USER")
  ARGS+=(-c "http.https://github.com/.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)")
fi
[ -z "${GIT_PUSH_AUTH_USER:-}" ] && ARGS=()
git "${ARGS[@]}" push -f "$REMOTE_URL" gh-pages 2>&1 | sed -E "s/${TOKEN:-__none__}/***/g" | tail -2

# A push alone did not trigger a Pages build here, so ask for one explicitly (needs `gh`).
if command -v gh >/dev/null; then
  OWNER_REPO=$(echo "$REMOTE_URL" | sed -E 's#.*github.com[:/]##; s#\.git$##')
  GH_TOKEN=${TOKEN:-$(gh auth token 2>/dev/null || true)} gh api -X POST "repos/$OWNER_REPO/pages/builds" --jq .status || true
fi
