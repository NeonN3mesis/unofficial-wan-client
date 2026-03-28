# Security Policy

## Reporting

If you find a security issue, do not open a public issue with exploit details or live session material.

Report it privately to the maintainer with:
- a short description
- affected version or commit
- reproduction steps
- impact

## Scope

High-priority issues include:
- exposure of saved Floatplane session data
- unexpected network exposure beyond loopback
- arbitrary upstream fetch or playback proxy bypasses
- background auto-watch behavior that launches or authenticates unexpectedly

## Public reviews

Public-safe security reviews may be published in `docs/`.

Current audit:
- [Security Audit - 2026-03-28](./docs/security-audit-2026-03-28.md)

## Secrets and user data

Never share:
- Floatplane cookies
- browser storage-state files
- Chrome/Chromium profile directories
- captured HAR or probe payloads from real accounts
