#!/usr/bin/env bash
# One-command install for Raseel on a fresh server (NFR-15).
#   curl -fsSL https://raw.githubusercontent.com/ahmedspurs/raseel/main/scripts/install.sh | bash
set -euo pipefail

INSTALL_DIR="${RASEEL_DIR:-/opt/raseel}"
REPO="https://raw.githubusercontent.com/ahmedspurs/raseel/main"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

[ -f docker-compose.yml ] || curl -fsSL "$REPO/docker-compose.yml" -o docker-compose.yml
mkdir -p scripts
[ -f scripts/backup.sh ] || { curl -fsSL "$REPO/scripts/backup.sh" -o scripts/backup.sh; chmod +x scripts/backup.sh; }

if [ ! -f .env ]; then
  DOMAIN="${DOMAIN:-}"
  if [ -z "$DOMAIN" ]; then
    read -rp "Domain for Raseel (e.g. inbox.example.com): " DOMAIN </dev/tty
  fi
  [ -n "$DOMAIN" ] || { echo "A domain is required." >&2; exit 1; }
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
RASEEL_VERSION=latest
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -hex 32)
SMTP_URL=
MAIL_FROM=Raseel <no-reply@$DOMAIN>
LOG_LEVEL=info
ENV
  echo "Created $INSTALL_DIR/.env — keep a copy of ENCRYPTION_KEY somewhere safe."
fi

docker compose pull
docker compose up -d

DOMAIN_VALUE=$(grep '^DOMAIN=' .env | cut -d= -f2-)
echo
echo "Raseel is starting. Open https://$DOMAIN_VALUE to create the owner account."
