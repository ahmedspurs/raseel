<div align="center">

<img src="apps/web/public/icon.svg" width="72" alt="Raseel logo" />

# Raseel · رسيل

**Open-source, self-hosted WhatsApp team inbox and CRM for Arabic-speaking businesses.**

One WhatsApp Business number, many agents, one shared inbox, on your own server, with no per-seat fees.

[![CI](https://github.com/ahmedspurs/raseel/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmedspurs/raseel/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

[English](#english) · [العربية](#العربية)

</div>

> [!IMPORTANT]
> Raseel is under active development and **not ready for production use yet**.
> The foundation (accounts, roles, setup, deployment) is done; the WhatsApp inbox is being built now.
> See the [roadmap](#roadmap) and star or watch the repo to follow along.

## English

### Why Raseel?

Small and mid-size businesses in the Gulf often run sales and support from one WhatsApp number shared by several staff, sometimes on a single phone. Messages get lost, nobody knows who replied, and there is no customer history. Hosted tools charge per seat every month and have weak Arabic support; open-source alternatives are heavy and English-first.

Raseel is built for this case:

- **Shared inbox** for one WhatsApp Business number, with assignment, internal notes and quick replies
- **Arabic first**: full right-to-left interface, Arabic-aware search, and English with one click
- **Your server, your data**: runs on a small VPS; nothing is sent anywhere except to Meta
- **Official Cloud API only**: no unofficial WhatsApp Web automation, so your number is not at risk of being banned
- **Lightweight**: the whole stack uses about 200 MB of RAM at idle and is designed for a 1 vCPU / 4 GB server

### Features

| Area                     | Status         | Details                                                                                 |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------- |
| Setup and accounts       | ✅ Done        | Setup wizard, Owner/Admin/Agent/Viewer roles, invitations, teams                        |
| Security                 | ✅ Done        | Argon2id passwords, TOTP two-factor, encrypted secrets, audit log, CSRF and rate limits |
| Deployment               | ✅ Done        | Docker Compose, automatic HTTPS (Caddy), one-command install and backups                |
| WhatsApp connection      | 🚧 In progress | Cloud API credentials, signed webhooks, send and receive all message types              |
| Team inbox               | 🗓 Planned      | Real-time inbox, assignment and round robin, notes with @mentions, quick replies        |
| Contacts and CRM         | 🗓 Planned      | Contact profiles, tags, custom fields, deals pipeline, tasks                            |
| Templates and broadcasts | 🗓 Planned      | Template sync, opt-in only broadcasts, automatic opt-out                                |
| Automation and reports   | 🗓 Planned      | Working hours, welcome messages, keyword rules, dashboards                              |

### Quick start (self-hosting)

You need a Linux server with Docker and a domain pointing to it.

```bash
curl -fsSL https://raw.githubusercontent.com/ahmedspurs/raseel/main/scripts/install.sh | bash
```

The script asks for your domain, generates secrets in `/opt/raseel/.env`, and starts the stack. Open `https://your-domain` to create the owner account.

> [!NOTE]
> Prebuilt images are published with the first release. Until then, clone the repository and run `docker compose up -d --build` after creating `.env` from [`.env.example`](.env.example).

See [docs/installation.md](docs/installation.md) for manual installation, updates and backups.

### Architecture

```
            ┌──────────── your server ────────────────────────────────┐
 Browser ──▶│ Caddy (HTTPS, static web app) ──▶ API (Fastify) ──▶ PostgreSQL │
 Meta    ──▶│                                    │                       │
            │                                    └──▶ Redis ◀── Worker   │
            └──────────────────────────────────────────────────────────┘
```

| Layer       | Technology                                                |
| ----------- | --------------------------------------------------------- |
| Web app     | Nuxt 4 (Vue 3), TypeScript, Pinia, Tailwind CSS, vue-i18n |
| API         | Node.js 22, Fastify 5, Zod                                |
| Jobs        | BullMQ on Redis                                           |
| Database    | PostgreSQL 16, Prisma                                     |
| Proxy/HTTPS | Caddy with automatic Let's Encrypt certificates           |

### Development

Requirements: Node.js 22+, pnpm 12, Docker.

```bash
pnpm install
docker run -d --name raseel-pg -e POSTGRES_USER=raseel -e POSTGRES_PASSWORD=raseel -e POSTGRES_DB=raseel -p 55432:5432 postgres:16-alpine
docker run -d --name raseel-redis -p 56379:6379 redis:7-alpine
cp apps/api/.env.example apps/api/.env   # then fill in the secrets
pnpm --filter @raseel/api db:migrate
pnpm dev                                  # web on :3000, API on :4000
```

Run the checks:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

### Roadmap

| Milestone         | Scope                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| **Foundation** ✅ | Monorepo, CI, Docker, database schema, auth, roles, setup wizard                |
| **WhatsApp core** | Meta setup, webhook receiver, send/receive text and media, message status       |
| **Team inbox**    | Real-time inbox, assignment, internal notes, quick replies, conversation status |
| **CRM · v0.1**    | Contacts, tags, custom fields, search, templates, 24-hour window                |
| **Automation**    | Auto-assign rules, away message, keyword replies, broadcasts                    |
| **v1.0**          | Reports, audit log UI, backups, PWA, documentation                              |

### WhatsApp costs

Raseel itself is free. Meta bills your business directly for WhatsApp conversations according to [its pricing](https://developers.facebook.com/docs/whatsapp/pricing).

### License

[AGPL-3.0](LICENSE). You can use, self-host and modify Raseel freely, including commercially. If you offer a modified version as a hosted service, you must share your changes.

---

## العربية

<div dir="rtl">

### ما هو رسيل؟

رسيل صندوق واتساب مشترك ونظام CRM خفيف، مفتوح المصدر، تثبّته على سيرفرك الخاص. يحل مشكلة الرقم الواحد الذي يستخدمه عدة موظفين: كل الرسائل في مكان واحد، وكل عميل له سجل كامل، بالعربي والإنجليزي، ومن غير رسوم شهرية على كل مستخدم.

> **تنبيه:** المشروع قيد التطوير وغير جاهز للاستخدام الفعلي بعد. الأساس جاهز (الحسابات، الصلاحيات، الإعداد، النشر)، وصندوق الواتساب قيد البناء الآن.

### المزايا

- **صندوق مشترك** لرقم واتساب أعمال واحد، مع توزيع المحادثات والملاحظات الداخلية والردود الجاهزة
- **عربي أولاً**: واجهة كاملة من اليمين لليسار، وبحث يفهم العربية، والإنجليزية بضغطة زر
- **بياناتك على سيرفرك**: لا يُرسل أي شيء لأي جهة غير ميتا
- **الـ API الرسمي فقط**: بدون أدوات غير رسمية، فرقمك في أمان من الحظر
- **خفيف**: يعمل على أصغر سيرفر (معالج واحد و4 جيجا رام) لحد 10 موظفين

### التثبيت

تحتاج سيرفر لينكس عليه Docker ودومين يشير إليه:

</div>

```bash
curl -fsSL https://raw.githubusercontent.com/ahmedspurs/raseel/main/scripts/install.sh | bash
```

<div dir="rtl">

السكربت يسألك عن الدومين، ويولّد المفاتيح السرية، ويشغّل النظام. افتح الدومين في المتصفح وأنشئ حساب المالك.

### تكلفة واتساب

رسيل مجاني. ميتا تحاسب نشاطك التجاري مباشرة على محادثات واتساب حسب أسعارها.

### الرخصة

AGPL-3.0: مجاني للاستخدام والتعديل والتثبيت على سيرفرك، حتى تجارياً.

</div>
