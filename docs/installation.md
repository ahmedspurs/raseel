# Installation

Raseel runs as one Docker Compose stack: Caddy (HTTPS and the web app), the API, a background worker, PostgreSQL and Redis.

## Requirements

|         | Minimum                                                                                | Recommended                                         |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Server  | 1 vCPU, 4 GB RAM, 50 GB disk (e.g. Hostinger KVM 1)                                    | 2 vCPU, 8 GB RAM for 10+ agents or heavy broadcasts |
| OS      | Any Linux with Docker Engine 24+ and Compose v2                                        | Ubuntu 24.04 LTS                                    |
| Network | A domain (or subdomain) with an A record pointing to the server; ports 80 and 443 open |                                                     |

A public HTTPS domain is required because Meta only delivers webhooks over HTTPS.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/ahmedspurs/raseel/main/scripts/install.sh | bash
```

The script:

1. Creates `/opt/raseel` (override with `RASEEL_DIR=/path`).
2. Downloads `docker-compose.yml` and the backup script.
3. Asks for your domain and writes `.env` with freshly generated secrets.
4. Pulls the images and starts the stack.

Open `https://your-domain` and complete the setup wizard to create the owner account.

## Manual install

```bash
git clone https://github.com/ahmedspurs/raseel.git /opt/raseel
cd /opt/raseel
cp .env.example .env
# Edit .env: set DOMAIN and generate POSTGRES_PASSWORD, ENCRYPTION_KEY and SESSION_SECRET
docker compose up -d --build
```

## Configuration

All settings live in `.env`. See [`.env.example`](../.env.example) for every option.

| Variable            | Required | Description                                                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`            | yes      | Public domain; Caddy obtains the certificate for it                                                                       |
| `POSTGRES_PASSWORD` | yes      | Database password                                                                                                         |
| `ENCRYPTION_KEY`    | yes      | 32-byte key that encrypts WhatsApp tokens and 2FA secrets. **Back it up**: without it, stored secrets cannot be decrypted |
| `SESSION_SECRET`    | yes      | Signs session cookies                                                                                                     |
| `SMTP_URL`          | no       | Sends invitation emails. Without it, Raseel shows a link to share                                                         |
| `RASEEL_VERSION`    | no       | Image tag; pin a release such as `1.0.0` in production                                                                    |

## Updating

```bash
cd /opt/raseel
./scripts/update.sh
```

Database migrations run automatically when the API starts.

## Backups

```bash
./scripts/backup.sh
```

This writes a PostgreSQL dump and an archive of media files to `./backups` and deletes backups older than 14 days (`KEEP_DAYS`). Schedule it daily:

```cron
30 3 * * * /opt/raseel/scripts/backup.sh >> /var/log/raseel-backup.log 2>&1
```

Copy backups and your `.env` file off the server regularly.

### Restore

```bash
docker compose exec -T postgres pg_restore -U raseel -d raseel --clean --if-exists < backups/raseel-db-YYYYMMDD-HHMMSS.dump
```

## Health checks

- `GET /health` returns `200` while the API process is running.
- `GET /health/ready` also checks PostgreSQL and Redis and returns `503` if either is down.

## Logs

```bash
docker compose logs -f api worker
```

Logs are JSON on stdout; secrets and cookies are redacted.
