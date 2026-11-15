#!/usr/bin/env bash
# Post-deploy smoke test: health, readiness, landing page, guest demo start and document list.
# Usage: ./scripts/smoke.sh https://your-app.example.com
set -euo pipefail
BASE="${1:?usage: smoke.sh <base-url>}"
BASE="${BASE%/}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

fail() { echo "FAIL $1"; exit 1; }

printf '%-28s' "GET /health"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")
[ "$code" = 200 ] && echo "OK $code" || fail "$code"

printf '%-28s' "GET /health/ready"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health/ready")
[ "$code" = 200 ] && echo "OK $code" || fail "$code"

printf '%-28s' "GET / (landing)"
curl -s "$BASE/" | grep -q "<app-root" && echo "OK app shell served" || fail "no app shell"

printf '%-28s' "GET antiforgery token"
token=$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/antiforgery" | sed -E 's/.*"token":"([^"]+)".*/\1/')
[ -n "$token" ] && echo "OK" || fail "no token"

printf '%-28s' "POST /api/demo/start"
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -X POST -H "X-XSRF-TOKEN: $token" "$BASE/api/demo/start")
[ "$code" = 200 ] && echo "OK $code" || fail "$code"

printf '%-28s' "GET /api/auth/me"
project=$(curl -s -b "$JAR" "$BASE/api/auth/me" | sed -E 's/.*"projects":\[\{"id":"([^"]+)".*/\1/')
[ -n "$project" ] && echo "OK project $project" || fail "no project"

printf '%-28s' "GET project documents"
count=$(curl -s -b "$JAR" "$BASE/api/projects/$project/documents?pageSize=50" | sed -E 's/.*"totalCount":([0-9]+).*/\1/')
[ "${count:-0}" -gt 0 ] && echo "OK $count documents" || fail "no documents"

echo "Smoke test passed for $BASE"
