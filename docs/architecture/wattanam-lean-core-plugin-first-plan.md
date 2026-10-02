# Wattanam Lean Core and Plugin-First Architecture Plan

Status: **architecture reviewed; conditionally recommended; blocking ADRs remain; planning only**  
Written: 2026-09-11  
Reviewed: 2026-09-11 against the current SDK/runtime, frontend host, marketplace, Railway topology,
backup/update model, and school billing enforcement.  
Applies to: new customer-school installations, upgrades of existing schools, official plugins, the marketplace, and platform administration.

## 1. Decision summary

Wattanam will use a **lean core, plugin-first modular-monolith architecture**. A new school receives only the platform foundation. School business features are installed later as signed plugins from the Wattanam Marketplace.

This is the same product idea users recognize from WordPress: the initial installation is useful and manageable, but optional capabilities are progressively added through plugins. It does **not** mean an empty application. Authentication, administration, security, plugin management, recovery, billing enforcement, and other platform foundations must always remain available.

This plan changes the earlier proposed DEC-004 boundary. `docs/architecture/module-boundaries.md` currently classifies attendance and academic structure as core because DEC-004 proposed that scope. After this plan is approved, DEC-004 and that classification must be amended before feature extraction begins.

## 2. Product goals

- Make a fresh school installation small, understandable, and fast to operate.
- Let each school install only the features it needs.
- Require customer schools to obtain and install plugins through the connected Wattanam Marketplace; do not expose local package upload.
- Allow free, paid, official, and eventually third-party plugins.
- Keep customer operational data inside that customer's school installation.
- Give the marketplace authority over catalog, releases, purchases, entitlements, and pricing without making it the runtime owner of school data.
- Preserve existing schools and their data while built-in features are moved to plugins.
- Ensure disabling one optional feature cannot break authentication, administration, backup, billing recovery, or plugin management.

## 3. Non-goals

- Wattanam will not execute arbitrary unsigned code.
- The first release will not provide unrestricted public plugin publishing.
- Plugins will not directly modify another plugin's tables.
- The central marketplace will not store student, grade, attendance, payroll, or fee records.
- Existing business modules will not be deleted in a single migration.
- A plugin will not be allowed to replace or disable the security, installation, billing-control, backup, update, or plugin-runtime foundations.

## 4. Terminology

| Term | Meaning in Wattanam |
|---|---|
| Lean core | The permanent platform foundation required by every school. |
| Plugin-first | New business features are delivered as plugins by default. |
| Modular monolith | One school application/process with enforced module boundaries, rather than independent business microservices. |
| Official plugin | A Wattanam-published, signed, reviewed plugin. |
| Progressive feature installation | A school starts small and adds capabilities when needed. |
| Feature unbundling | Moving an existing built-in business feature from core to a plugin. |
| Core-plugin separation | Core exposes stable contracts; plugins depend on those contracts; core does not import plugin business code. |

## 5. Target architecture

```text
Platform Admin
  -> manages schools, plans, invoices, releases, publishers and operations

Marketplace API
  -> catalog, pricing, orders, entitlements, signed artifacts and advisories

Customer School Installation
  -> Lean Core
       -> Plugin Runtime + SDK contracts
            -> Installed Official/Third-party Plugins
  -> School PostgreSQL database
  -> School file storage
```

The required dependency direction is:

```text
Plugin -> versioned Plugin SDK -> capability-gated Core services
```

The following directions are forbidden:

```text
Core -> business plugin implementation
Plugin A -> Plugin B database tables
Plugin -> unscoped Prisma/database access
Marketplace -> customer operational records
```

This is the logical architecture. Deployment must not assume that separate Railway services can
mount the same filesystem volume. See the artifact-distribution decision in section 12.

## 6. Permanent lean-core scope

The following capabilities remain installed and enabled for every school:

### 6.1 Installation and school identity

- First-run installer and unattended installer.
- Installation ID, school name, locale, timezone, currency, and owner setup.
- Installation registration and secure marketplace linking.
- Environment validation and installation preflight.

### 6.2 Identity and access

- Authentication, password recovery, MFA where applicable, and session management.
- Users, roles, permissions, and policy evaluation.
- A minimal person/account and organization-membership directory required to administer the installation.
- Platform billing lock and recovery access for authorized school administrators.

### 6.3 Plugin platform

- Signed package inspection and verification.
- Marketplace-controlled install, activate, disable, update, rollback, and uninstall lifecycle.
- Plugin registry, dependency resolution, compatibility checks, and advisory enforcement.
- Capability grants, audit records, quotas, health, and cleanup hooks.
- SDK 1.0 contracts for routes, database, directory, events, jobs, navigation, notifications, permissions, real-time delivery, settings, storage, and UI pages.

### 6.4 Operations and safety

- Core and plugin migrations.
- Backup, restore, recovery drills, and update orchestration.
- Health, structured logs, metrics, audit retention, and security controls.
- File-storage abstraction and database-backed background jobs.
- Notification infrastructure; provider-specific or business-specific messaging may be plugins.
- Maintenance mode and failure recovery.

### 6.5 Commercial connection

- Marketplace account connection.
- Installation identity, entitlement cache, purchase authorization, and artifact download.
- School subscription/billing status and suspension enforcement.
- A safe offline/outage policy as defined by the nonpayment-lock plan.

## 7. Core-only installation experience

Immediately after a fresh installation, the school administrator sees only:

- Overview.
- Users and access.
- Plugins.
- Marketplace.
- School settings.
- Backup and restore.
- Updates and health.
- Platform billing.
- Audit/security administration where authorized.

There must be no empty navigation entries, API endpoints, scheduled jobs, or business tables for attendance, exams, finance, transport, learning, or other optional features.

The setup wizard may recommend a starter bundle, but it must default to **core only**. Selecting a bundle creates normal, auditable plugin-install operations; it must not silently compile the modules into core.

Customer administrators must not upload `.wtp` or ZIP files. The school API exposes no public package-inspection or package-install endpoint. Marketplace installs and trusted repository updates download immutable artifacts server-to-server and then invoke the internal verifier/lifecycle service. Local package inspection remains a developer CLI and CI function, not a production customer-school function.

## 8. Recommended official plugin catalog

| Plugin | Initial feature ownership | Typical dependencies |
|---|---|---|
| Academic Management | Classes, study years, departments, subjects, enrollment/roster structure | Core directory only |
| Attendance | Student attendance, staff attendance if retained together, sessions, holidays, card aliases | Academic Management |
| Timetable | Schedules, rooms, teacher timetables | Academic Management |
| Examination | Exams, question banks, attempts, scoring and grade sheets | Academic Management |
| Learning | Courses, lessons, assignments, quizzes, H5P integration | Academic Management |
| Communication | Announcements, posts, parent-teacher messages, optional channel providers | Core notifications/directory/realtime |
| Finance | School fees, receipts, discounts, accounting and budget workflows | Academic Management for student billing |
| Human Resources | Staff CV, payroll/salary and related HR workflows | Core directory |
| Parent Portal | Parent-facing academic, attendance, fee and messaging views | Explicit optional dependencies on source plugins |
| Transportation | Bus routes, stops, assignments and live locations | Core directory; optional Academic Management |
| Document Designer | Card templates, certificates, printable documents and QR assets | Core storage |
| Reporting | Cross-feature reports and exports | Declared optional/required plugin contracts |

`plugins/announcements/` is the existing extraction precedent. It should be evolved into the Communication plugin or retained as a smaller standalone plugin through an explicit product decision; it must not be duplicated.

## 9. Plugin contract and ownership rules

Every plugin must have:

- An immutable ID, publisher, semantic version, compatible core range, SDK version, and release channel.
- A declared list of capabilities and permissions.
- Namespaced migrations and exclusive ownership of its database objects.
- Declared routes, navigation, UI pages, jobs, events, settings, storage, and notification usage.
- A health check, upgrade path, disable behavior, cleanup policy, and support metadata.
- A signed artifact whose digest matches the marketplace release.
- An entitlement rule: free, included in a plan, trial, or separately paid.

Core must deny undeclared capability use. A plugin may read shared school-directory data only through the scoped `directory.read` contract. Cross-plugin integration must use versioned events or explicit SDK contracts, never imported implementation code or direct SQL against another namespace.

Disabling a plugin must also unregister its runtime routes and UI, stop new job leases, wait for or
expire in-flight work, and publish a versioned lifecycle event. A dependent plugin must either stop
cleanly or declare a tested degraded mode; silently returning partial business results is forbidden.

## 10. Data lifecycle policy

| Operation | Required behavior |
|---|---|
| Install | Accept only a marketplace/repository-authorized server-side artifact; verify signature, publisher, compatibility, dependency graph and entitlement; back up; apply namespaced migrations; register disabled until health succeeds. |
| Activate | Verify grants and dependencies, register extensions, start allowed jobs, then expose navigation/routes. |
| Disable | Stop routes, pages, navigation, subscriptions and jobs; preserve data by default; keep core healthy. |
| Update | Take lock and backup, verify immutable artifact, migrate forward, health-check, then commit or roll back. |
| Uninstall | Require explicit typed confirmation and a fresh backup; default to preserving/archive data unless the manifest has an approved deletion policy. |
| Reinstall | Detect preserved data, validate its schema version, and offer safe adoption/migration. |

Plugin data must be included in school backup and restore. A restore must rebuild the matching registry, artifacts, grants, migrations, settings, and data, or clearly report an unavailable artifact before making the installation active.

## 11. Existing-school compatibility strategy

Fresh installations and upgraded installations follow different paths during the transition:

- **Fresh school:** creates only lean-core tables and presents an empty plugin registry.
- **Existing school:** continues using its current feature until that feature's cutover is verified.
- **Cutover:** back up, install the corresponding official plugin, copy/adopt legacy data, reconcile counts and totals, switch API/UI ownership, and preserve the legacy tables for the rollback window.
- **Rollback:** restore routing and registry state without destroying either legacy or plugin data.
- **Cleanup:** remove legacy tables and compatibility proxies only in a later release after the rollback window and evidence approval.

No extraction is complete merely because files were moved. Data, permissions, routes, UI, scheduled work, notifications, exports, backup/restore, upgrades, and operational evidence must all move to the plugin owner.

## 12. Architecture review findings and required decisions

The overall direction is sound, but the current code cannot safely support the complete target by
module extraction alone. The following decisions are **blocking**. LC-0 is not complete until each
has an accepted ADR and a testable implementation contract.

### 12.1 Browser UI extension model — critical blocker

Today `ui.pages` renders only a declarative `json-settings` page, and `api.routes` supports exact
paths rather than parameterized routes. That is appropriate for settings but cannot express the
existing timetable, examination, finance, transport, learning, reporting, or designer interfaces.
Moving their backend code while leaving their real pages compiled into the core frontend would be
feature flagging, not independent plugin installation.

Recommended decision for the first ecosystem release:

- Evolve the declarative UI contract to a versioned, core-rendered component schema supporting
  forms, tables, filters, detail views, dashboards, actions, file fields, print views, and
  accessible validation.
- Do not inject plugin JavaScript into the core origin.
- Keep a complex feature in core until the declarative contract can represent it; do not claim the
  extraction is complete while compiled feature pages remain in `frontend/`.
- If arbitrary third-party UI is later required, design a separate-origin sandboxed iframe plus a
  narrow, permissioned message/RPC bridge, CSP, origin checks, size/time quotas, and revocation.
  This requires a separate security ADR and is not part of SDK 1.x by implication.

Required proof: install a packaged plugin without rebuilding the frontend and exercise its complete
mobile-responsive UI, authorization, localization, accessibility, print/export, and removal flow.

### 12.2 Server runtime trust and isolation — critical blocker for third parties

The current runtime loads plugin JavaScript in the NestJS process. Capability checks protect the
supported context API, but they are not an operating-system sandbox: plugin code can attempt to read
environment variables, use the filesystem, open network connections, or consume process resources.
A valid signature proves who signed the bytes; it does not prove the code is safe.

Therefore:

- Phase 1 permits only reviewed Wattanam official plugins and explicitly approved publishers.
- Public third-party server plugins remain closed while execution is in-process.
- Opening the ecosystem requires either a formally accepted trusted-publisher governance model or
  isolated execution with separate identity, filesystem, network policy, CPU/memory/time limits,
  IPC capability mediation, crash containment, and an emergency kill switch.
- Static analysis, dependency/SBOM scanning, malware review, reproducible packaging, human review,
  signing-key custody, rotation and revocation are mandatory even if isolation is added.

Required proof: a hostile certification fixture cannot obtain school/core secrets or another
plugin's data, create an uncontrolled network connection, escape storage, fork a process, or deny
service beyond its assigned quota. Until that is true, documentation must say “trusted in-process
code,” never “sandboxed.”

### 12.3 Core identity versus academic data — critical boundary decision

The existing `directory.read` adapter resolves `User`, `Class`, and `Student` data from core tables.
The proposed Academic Management plugin would own classes and academic student profiles, creating a
dependency inversion if the adapter remains unchanged.

Recommended ownership:

- Core owns person identity, login account, contact endpoints, organization membership and generic
  role assignments.
- Academic Management owns student academic profiles, admissions/enrollment, classes, study years,
  departments and class membership.
- Core exposes no academic `Class`/`Student` model after cutover.
- Plugins obtain academic audiences through a versioned Academic Management service/event contract,
  not by extending core's generic directory with academic tables.

Required proof: core-only user administration works with Academic Management absent, and dependent
plugins resolve rosters only when a compatible Academic Management version is active.

### 12.4 API and event contract limitations

Exact-path plugin routes and fire-and-forget events are insufficient for many business workflows.
Before high-coupling extraction, define:

- Parameterized route/query validation without permitting namespace escape.
- Versioned request/response schemas and stable error codes.
- Event ownership, schema compatibility, idempotency keys, retry/dead-letter behavior, ordering and
  maximum payload sizes.
- A read-model/query contract for reporting; Reporting must never query another plugin's tables.
- Transaction boundaries: no distributed transaction spans plugins. Use an outbox and compensating
  actions for cross-plugin workflows.

Required proof: duplicate, delayed and out-of-order events do not duplicate fees, attendance,
notifications, or other irreversible records.

### 12.5 API/worker artifact distribution on Railway

The API installs plugin files under `PLUGIN_DIR`, while plugin jobs execute in the worker process.
Separate Railway services cannot be designed around a shared local volume. A database row saying a
plugin is active is not enough if the worker does not possess the identical verified artifact.

Recommended deployment contract:

- Store immutable plugin artifacts in central/object storage addressed by SHA-256.
- Each API/worker instance downloads to a local read-only cache, verifies signature and digest, and
  activates only after matching the registry generation.
- Promote registry state only after all required runtime roles report artifact readiness, or use a
  rollout generation that keeps the previous version active until readiness succeeds.
- Plugin-owned mutable files use an S3-compatible shared storage adapter in multi-service hosting;
  local volumes are supported only for a documented single-runtime topology.

Required proof: restart, horizontal scale, API/worker skew, cache loss and rollback all load the same
artifact version without losing mutable plugin data.

### 12.6 Migration duration, locks and zero/low downtime

The existing 30-second lifecycle transaction is a safe bound for small migrations but is not a
realistic cutover window for large attendance, file, finance, or reporting histories.

- Separate schema migration from chunked, journaled data backfill.
- Make backfill resumable and idempotent with progress visible to operators.
- Use maintenance mode or dual-read/dual-write only where an explicit reconciliation design exists.
- Define maximum supported dataset sizes and migration time budgets.
- Never hold a database transaction or advisory lock across object download, full backup, or a long
  data copy.

Required proof: terminate the process at every cutover checkpoint and show that retry or rollback
produces one authoritative, reconciled dataset.

### 12.7 Backup, restore and artifact retention

A portable recovery set must include database data, plugin mutable storage, registry/grants,
artifact digests, key/revocation metadata and a bill of materials. Marketplace withdrawal must not
make a customer's legitimate backup unrestorable.

- Retain entitled artifact versions for the contractual recovery period in a protected archive.
- Restore into quarantine, verify every artifact, migrate only after operator approval, then expose
  traffic.
- Define recovery behavior if a publisher disappears or its key is revoked after the backup date.
- Test recovery without access to the original Railway project or volume.

### 12.8 Commerce and enforcement boundaries

School-platform subscription billing and individual plugin entitlements are separate state
machines. The platform nonpayment lock may restrict the whole school under its approved policy;
an expired plugin entitlement may disable only that plugin and must preserve/export its customer
data. Marketplace outage, payment-provider outage and revoked ownership must not be confused.

Every entitlement decision needs a signed version/generation, issued/expiry time, offline grace,
server clock-skew rule, last-known-good state and auditable reason. Downgrade/replay of older signed
metadata must be rejected.

### 12.9 Resource governance and noisy plugins

Add per-plugin limits for request concurrency/time, job runtime/frequency, database statement time,
rows/payload size, storage, notifications, real-time events and outbound integrations. Define
circuit-breaker behavior and health-based automatic disable without preventing core recovery.
Database queries need indexes and query-budget review; namespace isolation alone does not prevent a
plugin from exhausting the shared PostgreSQL instance.

### 12.10 Supply-chain and release governance

The marketplace release chain needs:

- Offline root trust and online delegated signing keys with rotation and revocation.
- Anti-rollback metadata versions and expiry.
- Artifact SBOM, dependency vulnerability and license scanning.
- Reproducible build provenance where practical.
- Two-person approval for publisher trust, paid release, destructive migration, withdrawal and
  critical advisory actions.
- Immutable audit evidence from submission through customer installation.

### 12.11 Privacy, localization and accessibility

Because schools process children's data, each plugin must declare data categories, purposes,
retention, export/deletion behavior, subprocessors, external destinations and age-related privacy
impact. Capability approval must show meaningful descriptions rather than internal permission IDs.
Every official UI must support the installation's locale/timezone/currency, Khmer and launch
languages, keyboard navigation, screen readers, responsive layouts, and WCAG acceptance criteria.

### 12.12 Release topology and compatibility

Define and test the supported matrix of core, SDK/runtime, plugin, PostgreSQL, Node, browser and
mobile-app versions. Mobile cannot assume that a newly installed plugin screen exists in an older
signed app build; plugin mobile capability must be declarative, web-hosted under an approved model,
or gated by a minimum mobile version. Rollout needs canary schools, percentage waves, pause/rollback,
and telemetry that does not expose school records.

## 13. Delivery phases

### Phase LC-0 — Approve the boundary

- [ ] Accept this lean-core decision and supersede/amend DEC-004.
- [ ] Update `module-boundaries.md` so attendance and academic structure are plugin-owned.
- [ ] Decide whether minimal users include student/parent records or only login identities. Recommended: core owns generic identities and relationships; domain-specific profiles belong to plugins.
- [ ] Decide whether Communication is one plugin or separate Announcements and Messaging plugins.
- [ ] Approve default preservation of data on uninstall.
- [ ] Freeze new business functionality in `backend/src`; new optional features start as plugins.
- [ ] Accept ADRs for UI delivery, server isolation/trust, identity ownership, event consistency,
  artifact distribution, entitlement semantics and supported compatibility windows.

Gate: product owner has signed the boundary, and every existing module has exactly one future owner.

### Phase LC-1 — Inventory and dependency map

- [ ] Inventory backend modules, Prisma models, routes, frontend pages/navigation, mobile screens, jobs, events, notifications, files, exports and tests.
- [ ] Build a module dependency graph and identify forbidden core-to-feature imports.
- [ ] Map every database table to core or one plugin.
- [ ] Map legacy URLs that require temporary compatibility proxies.
- [ ] Record plugin dependency and entitlement rules.
- [ ] Record API-versus-worker execution ownership and every mutable/immutable storage location.
- [ ] Classify personal/financial/child data and external data flows for every plugin.

Gate: no unowned table, route, page, job, event or file collection remains.

### Phase LC-2 — Harden the plugin foundation

- [ ] Keep SDK 1.0 backward compatible; introduce new contracts only through reviewed versioning.
- [ ] Complete frontend page/navigation permission enforcement and per-plugin notification quota if still open.
- [ ] Add contract tests for cross-plugin events, dependency state changes, preserved-data reinstall and full restore.
- [ ] Ensure the core boots on a clean database without querying optional feature tables.
- [ ] Add a core-only installation profile to CI.
- [ ] Add policy checks that reject business module imports from permanent core.
- [ ] Implement the accepted UI, artifact-distribution, event/outbox and resource-governance contracts
  required by the first extraction candidate.

Gate: a clean core-only build, install, boot, backup, restore and update succeeds with zero optional plugins.

### Phase LC-3 — Establish plugin templates and certification

- [ ] Create one supported official-plugin template using the real SDK and CLI.
- [ ] Standardize migration, seed, test, health, cleanup, adoption and rollback scripts.
- [ ] Define UI extension design rules and accessible empty/error/loading states.
- [ ] Define marketplace metadata, screenshots, pricing, support and privacy requirements.
- [ ] Create a certification suite runnable against every packaged artifact.

Gate: an independently packed sample plugin passes install-to-uninstall certification without source-tree shortcuts.

### Phase LC-4 — Extract low-coupling features

- [ ] Confirm the announcements precedent against the current certification suite.
- [ ] Extract Document Designer.
- [ ] Extract Transportation.
- [ ] Extract standalone content/posts where it does not depend on academic data.
- [ ] Validate legacy adoption and rollback on disposable copies of real-shaped data.

Gate: each plugin can be absent on a fresh install and disabled on an upgraded install without breaking core.

### Phase LC-5 — Extract academic foundation and dependants

- [ ] Extract Academic Management first.
- [ ] Extract Timetable.
- [ ] Extract Examination and Scoring.
- [ ] Extract Learning, Assignments and H5P.
- [ ] Extract Attendance only after its session, holiday, card and realtime dependencies are explicitly owned.

Gate: dependency install order, refusal to disable a required dependency, upgrade ordering, and rollback are tested end to end.

### Phase LC-6 — Extract high-risk business features

- [ ] Extract Finance with amount/currency reconciliation and immutable payment evidence.
- [ ] Extract Human Resources/payroll with strict permissions and audit coverage.
- [ ] Complete Communication and Parent Portal boundaries.
- [ ] Extract Reporting last so its source-plugin contracts are stable.

Gate: financial totals, payroll access, messaging privacy, and cross-plugin reports pass domain-specific reconciliation and authorization tests.

### Phase LC-7 — Make lean core the installation default

- [ ] Remove optional modules from new-install bootstrap and seed paths.
- [ ] Hide all plugin-owned UI and APIs when the plugin is absent.
- [ ] Offer optional starter bundles as marketplace transactions.
- [ ] Publish a core-only Docker/Railway deployment drill.
- [ ] Verify that platform billing notice, final notice, suspension, admin recovery, data export, and reactivation work without any plugin.

Gate: a new Railway school reaches the core-only dashboard, can link its marketplace account, install a plugin, disable it, restore it, and survive a core upgrade.

### Phase LC-8 — Production migration and rollout

- [ ] Pilot with an internal school, then a controlled customer cohort.
- [ ] Measure install failures, migration duration, plugin health, rollback use and support volume.
- [ ] Keep legacy compatibility paths for the published support window.
- [ ] Roll out by feature wave with a kill switch for each cutover.
- [ ] Remove legacy schemas and proxies only after the rollback window is formally closed.

Gate: production evidence is attached, support runbooks are approved, and no unresolved critical migration or security issue remains.

## 14. Acceptance and test matrix

Each phase must produce durable evidence for these scenarios:

1. Install core on a clean PostgreSQL database with no plugin artifacts present.
2. Confirm optional business tables, routes, jobs and navigation do not exist or register.
3. Link and unlink a marketplace account without exposing marketplace credentials to the school.
4. Install a free plugin and a paid/entitled plugin from immutable signed artifacts.
   Confirm both installations originate through marketplace/repository authorization and that direct package-upload endpoints return 404.
5. Reject revoked signatures, incompatible core ranges, missing dependencies and missing entitlements.
6. Enforce capability and user permissions on backend routes and frontend pages.
7. Disable a plugin while preserving data and keeping core operational.
8. Prevent disabling a dependency while an active dependent plugin requires it.
9. Upgrade core and plugins in supported orders, including failed-migration rollback.
10. Back up and restore core plus multiple plugins onto a clean installation.
11. Adopt legacy data and reconcile row counts, money totals, relationships and files.
12. Uninstall with preservation and deletion policies, then test reinstall/adoption.
13. Continue safe operation during marketplace outage according to cached-entitlement policy.
14. Apply security advisories, forced disable/withdrawal rules and audit every action.
15. Enforce school nonpayment suspension and reactivation while core-only.
16. Verify tenant/installation isolation, rate limits, notification quotas and storage namespaces.
17. Run browser E2E for install, marketplace purchase, activation, navigation and removal.
18. Run Railway and Docker deployment drills using production-equivalent configuration.
19. Verify API and worker restart/scale/rollback with an identical digest-addressed artifact.
20. Run hostile-plugin and resource-exhaustion fixtures appropriate to the accepted trust model.
21. Verify event idempotency, retry, dead-letter recovery and cross-plugin degraded modes.
22. Verify UI installation without rebuilding the core frontend.
23. Restore a withdrawn-but-entitled plugin from a portable recovery set under the approved policy.

## 15. Operational and commercial requirements

- Platform Admin must show each school's installed plugins, versions, health, entitlements and last contact without receiving its operational records.
- Marketplace pricing remains centrally controlled; the school caches signed entitlements for the approved offline grace period.
- Free and paid plugins use the same package-verification and lifecycle pipeline.
- A withdrawn or vulnerable release must carry a signed advisory and an auditable response policy.
- Plugin logs and metrics must include installation ID, plugin ID and version, but exclude secrets and sensitive school records.
- Support bundles must redact credentials and require school-owner authorization.
- Every official plugin must publish ownership, support, privacy, data-retention and end-of-life information.

## 16. Target repository ownership

```text
backend/src/                 permanent lean core and shared capability adapters
frontend/                    core shell plus plugin extension rendering
packages/plugin-sdk/         framework-independent public SDK contracts
packages/plugin-cli/         plugin creation, validation and packaging tools
plugins/<plugin-id>/         official business plugins
apps/marketplace-api/        central catalog, commerce, entitlement and release authority
apps/platform-admin/         operator control plane
docs/plugins/                developer and publisher documentation
docs/acceptance/             release and migration evidence
```

Business-domain code must not move into `packages/`; packages remain publishable developer tooling. Temporary compatibility proxies may remain in core during migration, but they must be Prisma-free, marked with an owner/removal release, and delegate entirely through the plugin runtime.

## 17. Risks and controls

| Risk | Control |
|---|---|
| Excessive plugin fragmentation | Ship coherent business packages, not one plugin per screen. |
| Circular dependencies | Maintain an acyclic dependency graph and reject cycles during inspection. |
| Existing-school data loss | Backup, journaled adoption, reconciliation, rollback window and delayed legacy cleanup. |
| Core becomes large again | Architecture check blocks new optional business modules in core. |
| Plugin can bypass boundaries | Signed packages, explicit capabilities, namespaced storage/database, audits and quotas. |
| Marketplace outage blocks school | Signed cached entitlements and documented offline grace behavior. |
| Paid plugin removed unexpectedly | Preserve data, retain entitlement evidence, and separate disable from uninstall. |
| Cross-plugin reports become brittle | Stable versioned read models/events rather than direct table access. |
| Upgrade incompatibility | Core compatibility ranges, staged rollout, health gates and rollback artifacts. |
| In-process plugin compromise | Official/reviewed publishers only until isolation or an accepted trust-governance ADR; kill switch and incident response. |
| Plugin UI cannot represent real features | Complete a versioned declarative UI contract before extracting each interface; no core-compiled false extraction. |
| API and worker load different files | Digest-addressed artifact store, per-process verification and generation-based rollout. |
| Academic data leaks back into core | Separate generic identity from plugin-owned academic profile/roster contracts. |
| Long migrations exceed lifecycle timeout | Chunked journaled backfill, maintenance/dual-write design, reconciliation and crash drills. |
| One plugin exhausts shared resources | Per-plugin quotas, statement/job timeouts, circuit breakers and operator telemetry. |
| Old signed entitlement is replayed | Monotonic generations, expiry, clock-skew rules and last-known-good audit state. |

## 18. Definition of done

The lean-core transition is complete only when:

- A fresh installation contains and exposes only the permanent core scope.
- Every optional business feature is a signed, independently versioned plugin.
- Core has no runtime import or database dependency on an optional plugin.
- Existing schools can migrate without losing data and can roll back during the support window.
- Install, disable, update, backup, restore, uninstall and reinstall are certified for every official plugin.
- Marketplace pricing and entitlements work for free and paid plugins.
- Platform Admin can support plugin operations without accessing school business records.
- Nonpayment suspension, recovery, security, audit and backup work with zero plugins installed.
- Hosted Railway and Docker evidence, browser E2E, security review, operational runbooks and product-owner approval are attached to the release gate.
- Independently installed plugin UI requires no core frontend rebuild.
- API and worker instances retrieve and verify the same immutable artifact generation.
- The accepted third-party trust/isolation model is accurately documented and adversarially tested.

## 19. Recommended first implementation increment

Do not begin by deleting existing modules. Start with **LC-0 and LC-1**:

1. Accept the new core boundary and update DEC-004.
2. Decide the declarative UI v2 model and prove one real list/form/detail workflow can install without
   rebuilding the frontend.
3. Decide digest-addressed artifact distribution and prove API plus worker load the same generation
   on Railway.
4. Refactor the core identity/directory contract so it does not require future academic-plugin data.
5. Generate the complete table/route/page/job/dependency/data-classification ownership inventory.
6. Add a CI test that boots and installs a core-only profile on a clean database.
7. Choose Document Designer or Transportation as the first extraction candidate only after its UI,
   storage and runtime needs fit the accepted contracts.
8. Run it through the announcements-style backup, adoption, verification and rollback process.

This first increment proves the architecture safely while existing customer schools continue to operate.
