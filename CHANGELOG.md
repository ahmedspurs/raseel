# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Automation: working hours with an away message, a welcome message with reply buttons, and keyword rules that tag, assign or reply
- STOP / إيقاف replies withdraw marketing consent automatically
- Segments by tags, custom fields and language, with live audience counts
- Broadcasts of approved templates to opted-in segments, now or scheduled, rate limited, with delivery, read and reply reports
- Deals pipeline (Kanban, SAR) with editable stages, and tasks with due reminders
- CSV import (Arabic or English headers, Saudi number normalization, explicit consent) and export

### Fixed

- Settings now link to the templates, tags and custom fields pages

## [0.1.0] - 2026-11-13

First MVP release.

### Added

- Contacts with profiles, tags, validated custom fields and marketing consent records
- Arabic-aware search across contacts and messages (ignores tashkeel and alef, taa marbuta and yaa variants)
- Contact data export and permanent deletion for PDPL requests
- Message templates: sync from Meta, create and submit for review, send with variables from contact fields
- Starting conversations with templates and replying with templates after the 24-hour window
- Inbox filter by contact tag
- Realtime inbox over Socket.io: new messages, delivery ticks, assignments and notes appear instantly
- Inbox views (Mine, Unassigned, My teams, All, Closed) with agent, team, status and date filters
- Assignment to agents and teams, assign-to-me, optional round-robin auto-assignment
- Open, Pending and Closed statuses with audit log entries
- Internal notes with @mentions, mention notifications and unread count
- Quick replies inserted with "/" in Arabic or English
- Collision warning when a colleague is viewing or typing in the same conversation
- Voice notes recorded in the browser and converted to WhatsApp format
- Read receipts sent to customers when an agent opens the conversation
- WhatsApp connection: Phone Number ID, WABA ID, token and app secret verified against the Cloud API, with webhook URL, verify token and first-delivery check
- Signed webhook receiver that stores events before acknowledging and processes them in a queue
- Inbound text, images, video, voice notes, documents, stickers, locations, contacts, reactions and button replies, with automatic contacts and conversation reopening
- Sending text and files through a retrying queue, delivery ticks, Meta's failure reason and manual retry
- 24-hour customer service window enforced in the API and shown as a countdown
- Inbox with conversation list, filters, unread counts and message thread
- Mock Graph API and webhook simulator for trying Raseel without a Meta account
- First-run setup wizard that creates the owner account and business profile
- Owner, Admin, Agent and Viewer roles with permission checks on every API route
- Email or link-based user invitations, role changes, deactivation and teams
- Argon2id passwords, signed session cookies and optional TOTP two-factor authentication
- AES-256-GCM encryption of stored secrets and an audit log of sensitive actions
- Arabic and English interface with full right-to-left support and per-user language
- Docker Compose deployment with automatic HTTPS, migrations on start, install, update and backup scripts
- Background worker with scheduled maintenance
- CI for lint, type checks, tests and Docker builds; image publishing on release tags

[Unreleased]: https://github.com/ahmedspurs/raseel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ahmedspurs/raseel/releases/tag/v0.1.0
