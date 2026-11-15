#!/usr/bin/env bash
# Starts SQL Server (Docker, host port 14330), then prints the commands to run the API (5180) and web app (4210).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d sql
echo "Waiting for SQL Server to become healthy..."
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' docroof-sql 2>/dev/null || echo starting)
  if [ "$status" = "healthy" ]; then echo "SQL Server is healthy on 127.0.0.1:14330"; break; fi
  sleep 3
done
[ "$status" = "healthy" ] || { echo "SQL Server did not become healthy" >&2; exit 1; }

[ -d web/node_modules ] || (cd web && npm ci)

cat <<'MSG'

Next, in two terminals:
  dotnet run --project api/src/DocRoof.Api --launch-profile http   # API on http://localhost:5180 (migrates + seeds)
  cd web && npm start                                             # App on http://localhost:4210
MSG
