#!/usr/bin/env bash
# Update Raseel. Migrations run automatically when the API starts.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
if docker compose pull --quiet 2>/dev/null; then
  docker compose up -d
else
  docker compose up -d --build
fi
docker image prune -f >/dev/null
echo "Raseel updated."
