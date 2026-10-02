# Wattanam Customer School

Self-hostable, single-school Wattanam data plane. A clean installation runs the lean core and has no school business modules until the owner installs signed plugins.

## Default core

- installation and school profile;
- owner profile, accounts, MFA, roles, sessions, and audit;
- appearance, settings, backup and restore;
- system health and signed core updates;
- Plugin Manager and the plugin runtime foundation;
- optional licensing and Marketplace connection.

Academic management, attendance, timetable, examinations, learning, finance, HR, parent portal, transportation, communication, document design, and domain reporting are not part of the physical core build.

## Build

```powershell
npm.cmd run install:all
npm.cmd run build:core
```

The backend and frontend core build scripts compile only the approved core surface. Do not use the legacy full build for a new school.

## Standalone deployment

Copy `.env.example` to `.env`, replace every placeholder, and leave `MARKETPLACE_URL` empty. Deploy with the digest-pinned images in `docker-compose.core.yml`.

```powershell
docker compose --env-file .env -f docker-compose.core.yml up -d
```

## Optional Marketplace connection

Set `MARKETPLACE_URL` only to the trusted HTTPS origin operated by Wattanam. The school initiates outbound requests; Marketplace receives no school database credentials and no installation private key. Owner approval occurs on the Marketplace origin, and delegated credentials remain server-side in the school installation.

See `docs/architecture/customer-school-marketplace-separation-plan.md` for the trust boundary and production acceptance gates.
