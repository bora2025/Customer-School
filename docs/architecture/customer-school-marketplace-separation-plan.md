# Customer School and Marketplace Separation Plan

Status: **implementation in progress**  
Updated: **2026-10-02**

## 1. Decision

Wattanam uses two independently deployable products:

- **Customer School (data plane):** a single-school application and database that can be installed on Railway, a VPS, Kubernetes, or another container host. It must install, start, authenticate, configure, back up, restore, and upgrade without a Marketplace connection.
- **Wattanam Marketplace (control plane):** a separately deployed catalog, publisher, commerce, entitlement, and platform-administration service. It never shares a database, filesystem, session secret, or private network with a school.

Marketplace connection is optional and explicitly approved by the school owner. It adds signed-plugin discovery, acquisition, entitlement synchronization, and platform billing; it is not a prerequisite for operating the school core.

## 2. Clean customer-school installation

A new school is provisioned with `WATTANAM_DISTRIBUTION=core`. `legacy-full` is permitted only as an explicit temporary compatibility mode for an existing-school migration or rollback.

### Included in core

- installation wizard and school identity;
- owner profile, generic login accounts, password recovery, MFA, sessions, roles, and audit;
- school profile, locale, timezone, currency, branding, theme, and appearance;
- backup, restore validation, recovery status, and scheduled-backup configuration;
- Plugin Manager and generic plugin UI/navigation/dashboard hosts;
- optional Marketplace claim/link/unlink and licensing status;
- core update, health, diagnostics, notifications, storage, and background-job infrastructure;
- platform subscription notices and a recovery-safe suspension surface when the installation opted into managed service.

### Excluded from core

The clean installation contains no academic, class, study-year, attendance, timetable, examination, learning, finance, payroll, HR, parent, transport, communication/content, document-design, or domain-reporting module. Those capabilities must arrive only from installed plugins. Hiding a menu is insufficient: business controllers, jobs, tables, seed data, and compiled pages must also be absent from the physical core release.

## 3. Deployment boundary

```text
School browser -> Customer School gateway -> school web/API -> school PostgreSQL + /data
                                             |
                                             | outbound HTTPS only, optional
                                             v
                                      Marketplace public API
                                      -> marketplace PostgreSQL/artifacts
```

Required rules:

1. Each school owns one database and one persistent data directory; Marketplace credentials cannot read either.
2. Marketplace never connects inbound to a school database or internal service.
3. The school initiates all Marketplace traffic over HTTPS. No Marketplace URL means standalone mode, not startup failure.
4. School backups exclude Marketplace operator secrets. Marketplace backups exclude school operational records.
5. School and Marketplace releases, migrations, scaling, incidents, and restores are independent.
6. The public gateway is the only school ingress. API, web, database, and volumes remain private to that deployment.

## 4. Secure Marketplace connection

### Trust establishment

1. The school generates an Ed25519 installation key pair locally. The private key is stored in its persistent secret directory and never leaves the school.
2. An owner enters a short-lived, one-use claim token issued by Platform Admin or starts an authenticated owner approval flow.
3. The school sends its installation ID, public key, public origin, nonce, timestamp, and requested scopes to the configured Marketplace HTTPS origin.
4. Marketplace validates token expiry, single use, origin policy, replay nonce, and owner authority before registering the installation.
5. Marketplace returns a narrowly scoped delegated credential. The school encrypts it at rest and can revoke it locally; the account owner can revoke it centrally.

### Ongoing rules

- Accept one normalized HTTPS origin in production; reject embedded credentials, paths, insecure HTTP, unexpected redirects, and private/link-local targets.
- Sign requests with installation identity, timestamp, nonce, and body digest; reject replays and excessive clock skew.
- Use separate scopes for catalog read, entitlement read, order creation, and artifact download. Never grant operator, publisher, customer-password, or school-data scopes.
- Catalog metadata and release envelopes are repository-signed. Plugin packages are immutable, checksum-verified, publisher-signed, and capability-reviewed before execution.
- Download grants are short-lived and bound to installation, plugin, version, and artifact digest.
- Capability changes require a new disclosure and explicit approval. Updates cannot silently acquire permissions.
- Log claim, link, unlink, purchase, entitlement, download, install, activation, update, disable, and removal events on both sides without logging secrets.
- Key and credential rotation must support overlap, revocation, and an auditable recovery procedure.

### Failure behavior

- Marketplace outage must not block login, profile, settings, backup, restore, health, or already-authorized local core work.
- An unlinked school shows a connection action and no catalog; it does not show an internal-server error.
- Cached signed entitlements use an explicit expiry and grace policy. A network error is not equivalent to revocation.
- A managed-service billing lock may occur only after the school opted into that contract. The lock must preserve billing, backup/export, owner security, diagnostics, and recovery access; it must never delete plugin data.

## 5. Plugin full-control foundation

The reform is complete only when a plugin can own a vertical feature without calling legacy business code. The host must provide:

- immutable signed package install and retained-data reinstall;
- plugin-scoped migrations, transactions, storage, settings, secrets, jobs, health, and quotas;
- activation/deactivation dependency ordering and atomic registration;
- capability consent and permission enforcement at backend, UI, job, and realtime boundaries;
- dynamic navigation, pages, dashboard cards, settings panels, search, notifications, and translations;
- versioned contracts/events instead of cross-plugin table reads;
- entitlement enforcement without sending school records to Marketplace;
- backup/restore participation and data-retention/purge workflows;
- safe update checkpoint, compatibility check, post-update health gate, and rollback;
- audit and observability with plugin identity on every action.

## 6. Acceptance gates

### Gate A — standalone clean install

- Install on a non-Railway container host with no `MARKETPLACE_URL`.
- Confirm only core modules are booted and only core routes/menus are compiled.
- Complete setup, owner MFA, profile/branding, backup, restore validation, and core update checks.
- Restart with Marketplace unreachable and confirm core remains usable.

### Gate B — secure connection

- Claim using a one-use token, verify the local public key registration, then revoke and relink.
- Prove the school accepts only its configured HTTPS Marketplace origin and signed responses.
- Prove replay, expired token, altered body, wrong artifact digest, wrong publisher, excessive redirect, and capability drift are rejected.
- Verify no school database credential or installation private key appears in Marketplace data or logs.

### Gate C — zero-module baseline

- Inspect the physical core image: no business module backend, frontend page, migration, job, or seed fixture is present.
- Confirm profile, appearance, settings, backup, Plugin Manager, licensing, system health, and audit remain available.
- Confirm a fresh database contains no optional-domain tables.

### Gate D — plugin control

- Install one foundation plugin and one dependent plugin from signed packages.
- Exercise UI, API, jobs, permissions, navigation, backup/restore, update, disable, retained-data uninstall, reinstall, and dependency protection.
- Remove the packages and confirm core starts cleanly with no legacy fallback.

### Gate E — existing-school cutover

- Back up and rehearse migration on restored production-like data.
- Reconcile every record and workflow before switching ownership from legacy module to plugin.
- Keep a timed rollback path; delete legacy code only after hosted acceptance evidence exists for every affected school.

## 7. Current implementation status

Implemented foundation:

- backend module composition supports `core` versus explicit `legacy-full`;
- frontend route and navigation policy rejects legacy business surfaces in core mode;
- physical core release rendering and verification exist;
- Marketplace identity is disabled when unconfigured and requires a strict HTTPS origin in production;
- signed packages, checksums, publisher trust, capability approval, dependencies, migrations, and lifecycle controls exist;
- new Railway school provisioning now defaults to `core`;
- hosted core preflight now supports standalone mode and an explicit `--require-marketplace` connected mode;
- profile, licensing, and appearance are admitted as core administration surfaces.
- Marketplace sign-in, customer commerce, link approval, publisher, reviewer, and website-content routes are excluded from the physical school core. Plugin Manager uses the school's backend connector, and owner approval opens only an exact URL validated against the configured Marketplace origin.

Not yet grounds for deleting all legacy modules:

- every target vertical plugin still needs hosted functional and restored-backup cutover evidence;
- Marketplace web pages still share source with the legacy combined frontend and must be packaged as their own control-plane web artifact; they are no longer included in the physical school-core build;
- physical core artifact inspection must prove business code and schema are absent, not merely disabled;
- the complete standalone non-Railway installation drill and adversarial Marketplace-link test matrix must pass;
- existing schools need signed migration acceptance or an approved temporary `legacy-full` exception.

## 8. Required implementation order

1. Certify a clean standalone `core` installation with Marketplace omitted.
2. Certify secure claim/link/revoke and signed catalog/package acquisition.
3. Complete the plugin host acceptance matrix and physical artifact audit.
4. Finish each vertical plugin and migrate existing data one plugin at a time.
5. Switch production schools to `core` after reconciliation and rollback drills.
6. Delete a legacy module only after its plugin owns UI, APIs, data, jobs, permissions, reports, and recovery end to end.

