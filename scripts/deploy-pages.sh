#!/usr/bin/env bash
# Builds the app into docs/ on the current branch, commits it and pushes, then requests a GitHub Pages build.
# Pages must be set to "Deploy from a branch: main / docs". No GitHub Actions needed.
# Reads VITE_SUPABASE_* from .env.local. Optional: GIT_PUSH_AUTH_USER=<gh account> pushes with that account's token.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_URL=$(git remote get-url origin)
REPO_NAME=$(basename "$REMOTE_URL" .git)
OWNER_REPO=$(echo "$REMOTE_URL" | sed -E 's#.*github.com[:/]##; s#\.git$##')
BRANCH=$(git rev-parse --abbrev-ref HEAD)

set -a; . ./.env.local; set +a
BASE_PATH="/${REPO_NAME}/" npm run build -- --outDir docs --emptyOutDir
touch docs/.nojekyll
cp docs/index.html docs/404.html

git add -A docs
if git diff --cached --quiet; then
  echo "No frontend changes to deploy."
else
  git commit -q -m "Deploy frontend build

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
fi

ARGS=()
TOKEN=""
if [ -n "${GIT_PUSH_AUTH_USER:-}" ]; then
  TOKEN=$(gh auth token --user "$GIT_PUSH_AUTH_USER")
  ARGS=(-c credential.helper= -c "http.https://github.com/.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)")
fi
git "${ARGS[@]}" push origin "$BRANCH" 2>&1 | sed -E "s/${TOKEN:-__none__}/***/g" | tail -2

# A push alone did not trigger a Pages build here, so ask for one explicitly.
if command -v gh >/dev/null; then
  GH_TOKEN=${TOKEN:-$(gh auth token 2>/dev/null || true)} gh api -X POST "repos/$OWNER_REPO/pages/builds" --jq .status || true
fi
