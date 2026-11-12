# Security Policy

## Supported versions

Security fixes are released for the latest minor version.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through [GitHub Security Advisories](https://github.com/ahmedspurs/raseel/security/advisories/new). Include steps to reproduce and the affected version. You will get a reply within 5 working days, and a fix will be released as soon as possible with credit to you unless you prefer otherwise.

## Security design

- Passwords hashed with Argon2id; optional TOTP two-factor authentication
- Sessions in signed, HTTP-only, `Secure`, `SameSite=Lax` cookies, stored as SHA-256 hashes
- WhatsApp access tokens and 2FA secrets encrypted at rest with AES-256-GCM
- Role checks on every API route; strict rate limits on sign-in, setup and invitations
- Cross-origin write protection on all cookie-authenticated endpoints
- Meta webhook signatures (`X-Hub-Signature-256`) verified on every request
- No telemetry; data stays on your server
