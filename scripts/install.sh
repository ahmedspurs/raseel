#!/usr/bin/env bash
# One-command install for Raseel on a fresh server (NFR-15).
#   curl -fsSL https://raw.githubusercontent.com/ahmedspurs/raseel/main/scripts/install.sh | bash
set -euo pipefail

INSTALL_DIR="${RASEEL_DIR:-/opt/raseel}"
REF="${RASEEL_REF:-main}"
REPO_URL="https://github.com/ahmedspurs/raseel.git"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }
command -v git >/dev/null || { echo "git is required." >&2; exit 1; }

if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

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

# Use published images when available; otherwise build them on this server.
if docker compose pull --quiet 2>/dev/null; then
  docker compose up -d
else
  echo "Prebuilt images not available; building on this server (this takes a few minutes)…"
  docker compose up -d --build
fi

DOMAIN_VALUE=$(grep '^DOMAIN=' .env | cut -d= -f2-)
echo
echo "Raseel is starting. Open https://$DOMAIN_VALUE to create the owner account."
