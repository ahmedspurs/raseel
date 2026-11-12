#!/usr/bin/env bash
# Update Raseel to the newest images. Migrations run automatically on start.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose pull
docker compose up -d
docker image prune -f >/dev/null
echo "Raseel updated."
