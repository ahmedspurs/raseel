# Contributing to Raseel

Thanks for helping! Raseel aims to be simple to run, safe by default and excellent in Arabic.

## Getting started

Follow the development setup in the [README](README.md#development). Then:

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript across all packages
pnpm test        # Vitest (API tests need the dev Postgres and Redis containers)
pnpm format      # Prettier
```

## Project layout

| Path              | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `apps/api`        | Fastify API, BullMQ worker, Prisma schema and migrations |
| `apps/web`        | Nuxt web app (client-rendered, served as static files)   |
| `packages/shared` | Roles, permissions and Zod schemas shared by API and web |
| `docker/`         | Dockerfiles, Caddyfile and entrypoint                    |
| `scripts/`        | Install, update and backup scripts                       |

## Pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles (`feat(inbox): …`, `fix(api): …`).
- Keep PRs focused; add or update tests for behaviour changes.
- Every user-facing string goes through i18n with both `ar` and `en` translations.
- Use logical CSS properties (`ms-`, `pe-`, `start`, `end`) so layouts mirror correctly in RTL.
- Database changes need a Prisma migration: `pnpm --filter @raseel/api db:dev --name your_change`.
- Never log secrets, tokens or message bodies at `info` level.

## WhatsApp policy

Raseel only uses Meta's official WhatsApp Cloud API. Contributions that add unofficial WhatsApp Web automation, or ways to message people who have not opted in, will not be accepted.

## Reporting bugs and ideas

Open an issue using the templates. For security problems, see [SECURITY.md](SECURITY.md) instead.
