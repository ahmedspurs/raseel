# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- First-run setup wizard that creates the owner account and business profile
- Owner, Admin, Agent and Viewer roles with permission checks on every API route
- Email or link-based user invitations, role changes, deactivation and teams
- Argon2id passwords, signed session cookies and optional TOTP two-factor authentication
- AES-256-GCM encryption of stored secrets and an audit log of sensitive actions
- Arabic and English interface with full right-to-left support and per-user language
- Docker Compose deployment with automatic HTTPS, migrations on start, install, update and backup scripts
- Background worker with scheduled maintenance
- CI for lint, type checks, tests and Docker builds; image publishing on release tags
