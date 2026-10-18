# Plugin platform production runbook

This runbook certifies the lean Customer School core, Marketplace-delivered plugins, and the two supported deployment profiles. Run destructive database drills only against a disposable certification database or a verified restored copy.

## 1. Release inputs

- Customer School core images are built only from `backend/Dockerfile.core` and `frontend/Dockerfile.core`.
- Marketplace plugin packages are immutable `.wtp` archives signed by a trusted Ed25519 publisher key.
- Pin every production container by digest. Never certify a mutable tag.
- Configure `PLUGIN_IN_PROCESS_PUBLISHERS=wattanam` unless an operator has explicitly reviewed another publisher's native backend code. A trusted package signature alone does not authorize in-process JavaScript.
- Set `WATTANAM_PLUGIN_SOURCE_ROOT` only for CI/source certification commands. A running customer school never needs publisher source code.

## 2. Pre-release gates

From Customer School:

```powershell
npm.cmd run build:core
npm.cmd run verify:core
npm.cmd run test:core
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend test -- --runInBand src/plugins/plugin-artifact-cache.service.spec.ts src/plugins/plugin-rollout.service.spec.ts src/plugins/plugins.service.spec.ts
node --test backend/scripts/plugin-recovery-contract.test.js backend/scripts/restore-recovery-set.test.js
```

From Marketplace/publisher source:

```powershell
npm.cmd test
node packages/plugin-cli/bin/cli.js check plugins/wattanam.organizing-management --require-universal-ui
```

Customer School CI also runs full-history Gitleaks 8.29.1, the full backend build-tool audit at the high threshold, a full frontend dependency audit, and production-only audits for every deployable dependency tree. The frontend uses Tailwind 4 with the official PostCSS adapter; the obsolete Next 16 `next lint` command and unused vulnerable ESLint stack were replaced by an explicit TypeScript no-emit check.

Set `PLUGIN_SOURCE_CATALOG` to the publisher `plugins` directory, then run `all-plugin-package-lifecycle.spec.ts` in Customer School. This packages and verifies the official catalog and proves install, activate, update, rollback, deactivate, retained-data removal, and reinstall/adoption behavior.

## 3. Active update and rollback

1. Confirm the installed plugin is healthy and its current artifact digest is retained.
2. Inspect the candidate package and activation preflight; every check must pass.
3. Start the update. The host stages files and migrations under a per-plugin lock.
4. Wait for every required runtime role to report the same rollout generation and digest.
5. If migration, load, health, or rollout readiness fails, verify the staging generation is marked failed and the prior registry/runtime generation is automatically restored. Each split process reconciles its loaded version and digest against the authoritative registry, so an API or worker cannot report a new digest while still running the old module.
6. Treat database migrations as forward-only and backward-compatible across the rollback window.

Never manually edit a registry row or replace files inside an installed version directory.

## 4. Railway / split runtime

- New schools must use `WATTANAM_DISTRIBUTION=core`; `legacy-full` is migration-only.
- A combined service uses `PROCESS_ROLE=combined`. Split deployments require one `api` and one `worker` service and `PLUGIN_REQUIRED_RUNTIME_ROLES=api,worker`.
- Each role independently downloads, digest-checks, signature-verifies, and materializes the same immutable package. Do not assume Railway filesystem sharing.
- Split roles must use shared S3-compatible object storage. The API authenticates Marketplace downloads, verifies and content-addresses each archive, then seeds `__host/plugin-artifacts/sha256/...`; the worker only accepts that shared immutable archive and never requires a copy of the installation private key. Marketplace-learned publisher keys are persisted in the database as host trust records, so both roles verify against the same trust set even with independent volumes.
- Persist plugin data, backups, and installation identity. Artifact code caches may be rebuilt from Marketplace, but recovery copies must follow the backup contract.
- Run `node tools/railway-core-hosted-preflight.js --environment <isolated-environment> --confirm-isolated <isolated-environment> --require-marketplace --out <evidence.json>` against an isolated project. The command refuses `production` and requires an exact confirmation value. It must report successful API and worker deployments, matching immutable backend image digests, exact `api,worker` rollout roles, a healthy gateway, completed installation, exact `core` distribution, and Marketplace connectivity.

The new-school provisioner creates API and worker services from the same digest-pinned backend image and gives each role its own `/data` volume. `PROCESS_ROLE` selects `dist-core/main.js` or `dist-core/worker.js`; both roles deploy the same core schema before starting, and both require `PLUGIN_REQUIRED_RUNTIME_ROLES=api,worker`. Execution requires `WATTANAM_PROVISION_S3_BUCKET` and `WATTANAM_PROVISION_S3_REGION`; optional endpoint and credential values are read from the provisioning process and written through Railway stdin, never embedded in the release blueprint or journal. This prevents a hosted install from being declared ready when only the API has loaded the candidate generation.

Provisioning a live Railway certification project may incur cost and must be explicitly authorized. Do not reuse a customer or `legacy-full` project.

The local production-shaped split-runtime acceptance record is `docs/acceptance/plugin-platform-local-split-runtime-2026-10-18.json`. It proves separate API and worker roles, shared TLS S3-compatible artifact storage, role health/readiness, exact database restore, and a clean production dependency audit. Its current-image revalidation boots both roles from the same Node 24.22.0 image digest against fresh PostgreSQL 16, proves that split production rejects local storage, and records cleanup of the disposable resources. It does not replace the required live Railway preflight.

### Railway infrastructure ownership migration

Railway ends support for legacy `railway.json` Config-as-Code on 2026-12-01. The exact live topology is exported in `.railway/railway.ts`; it declares `web`, `api`, `gateway`, PostgreSQL, and both persistent volumes, while every existing environment value is represented by `preserve()` so secrets are never committed. `tools/railway-iac-contract.test.js` enforces that invariant.

Before changing infrastructure, authenticate Railway CLI 5.42.1 or newer and run `railway config plan`. Railway SDK 3.12+ has a Windows path-detection issue when the CLI is installed through npm; on Windows, set the process-local `_` environment variable to the native `@railway/cli/bin/railway.exe` path before running the plan. The 2026-10-18 import produced a zero-change plan against production.

Do not run `railway config migrate --apply`, `railway config apply`, or delete the legacy JSON files as part of an application release. Moving resource ownership from legacy Config-as-Code to IaC is a separate production control-plane change: review a zero-change plan, capture approval, apply the pinned plan, confirm service/volume ownership, and only then remove the legacy files. Never perform that ownership migration in the live customer project as a substitute for the isolated certification drill.

## 5. Self-hosted VPS

- Use `docker-compose.core.yml` with digest-pinned API, web, gateway, and PostgreSQL images.
- Prefer `PROCESS_ROLE=combined`. For split containers, apply the same role contract as Railway.
- Mount absolute, application-private paths for plugins, plugin data, backups, update state, and Marketplace identity.
- Validate the rendered Compose configuration before deployment.
- Start the stack with Marketplace unavailable and verify login, settings, backup, restore, health, and already-installed licensed plugins remain usable.
- Reconnect Marketplace and verify discovery/update without rebuilding Customer School.

The disposable full-topology acceptance record is `docs/acceptance/plugin-platform-local-vps-2026-10-18.json`. It records digest-pinned PostgreSQL, API, web, and gateway images; public gateway/API readiness; the reported `core` distribution; and successful recovery-set creation plus isolated database/filesystem restore.

## 6. Backup and restore

1. Create one recovery set containing the database dump, installed plugin manifests/artifacts, required plugin file namespaces, installation identity, and checksums.
2. Restore into a new, isolated database and empty filesystem paths.
3. `restore-recovery-set.js` stages and verifies plugin artifacts before the database restore can touch live plugin directories.
4. Verify each operational contract. Organizing Management requires database coverage and preserves data on uninstall; it currently declares no required file namespace.
5. Run migrations, activation preflight, and diagnostics before enabling traffic.
6. Compare installed IDs, versions, package digests, migration ledgers, runtime roles, and health with the source recovery set.

## 7. Incident recovery

- Set `PLUGIN_SAFE_MODE=true` when a plugin prevents normal boot.
- Keep Marketplace and publisher signing keys separate from school runtime secrets.
- For artifact damage, rematerialize only from the digest-addressed signed archive.
- For a failed active update, inspect rollout generation/error and confirm the prior generation is active before reopening traffic.
- Do not purge retained plugin data during incident response. File removal and data purge are separate operations.

## 8. Release decision record

Record commit IDs, image digests, plugin package digests, test output, database drill target, backup ID, restore result, Railway preflight JSON (if authorized), VPS profile result, approver, timestamp, and any accepted exception. A release is not production-certified while a required external drill is omitted.

The application images use the maintained Node 24 runtime line. Keep the exact deployed image digest in the release record and rebuild regularly for Debian and Node security updates; a mutable `node:24-slim` build input is never a substitute for recording the resulting immutable application-image digest.
