# Wattanam WordPress-Style Core and Plugin Directory Reform Plan

Status: **proposed execution plan**  
Created: **2026-09-25**  
Applies to: new customer schools, existing-school upgrades, Wattanam Marketplace, official and third-party plugins

Related documents:

- [Lean-core architecture plan](./wattanam-lean-core-plugin-first-plan.md)
- [Module-to-plugin migration plan](./module-to-plugin-migration-plan.md)
- [Module migration progress](./module-to-plugin-progress-checklist.md)
- [Reform completion TODO](./reform-completion-todo.md)
- [All modules production cutover plan](./all-modules-production-cutover-plan.md)

## 1. Product goal

Wattanam will use a **lean-core, plugin-first architecture** similar to WordPress:

1. A newly created school receives a small, secure, usable platform core.
2. Optional school-management functions are absent until installed as plugins.
3. School owners browse a central plugin directory from Plugin Manager.
4. Plugins can be free, paid once, subscription-based, private, beta, or stable.
5. Installation, activation, update, suspension and removal happen without rebuilding the school.
6. Marketplace entitlements decide whether a school may download and activate paid software.
7. Disabling or uninstalling a plugin does not damage the core or silently delete school data.
8. Existing schools migrate one vertical module at a time with backup, reconciliation and rollback.

This is not only a navigation change. Optional code, pages, APIs, tables, jobs and business rules must be removable from the core distribution.

## 2. Technical name for the architecture

Use these terms consistently:

- **Lean core**: the permanently installed platform kernel.
- **Plugin-first modular platform**: business capabilities are independently installable vertical plugins.
- **Extension marketplace** or **plugin directory**: the central catalog and commerce service.
- **Single-tenant school installation**: each customer school has its own deployed application and database.
- **Control plane**: platform admin, marketplace, licensing, billing and provisioning services.
- **Data plane**: an individual customer-school installation and its installed plugins.
- **Vertical plugin**: one complete capability containing its data, backend, UI, permissions, jobs and reports.

## 3. What a new school receives by default

The default installation must remain useful for platform administration but contain no optional school business module.

### 3.1 Required lean-core features

| Core capability | Included behavior |
|---|---|
| Installation and school profile | School name, logo, locale, timezone, currency, contact details and installation identity |
| Accounts and security | Owner account, users as login identities, password recovery, MFA, sessions and security policies |
| Access control | Roles, permission grants and generic policy evaluation |
| Core administration shell | Dashboard shell, settings, account page, navigation host and global search host |
| Plugin Manager | Browse, install, activate, deactivate, update and remove eligible plugins |
| Marketplace connection | Claim/link installation, account connection, catalog and entitlement synchronization |
| Licensing | Core licence status, plugin entitlements, offline grace state and signed licence verification |
| Platform billing | School subscription status, billing notices, grace period, suspension and recovery |
| Backup and recovery | Full installation backup, restore validation, scheduled backup settings and recovery status |
| Core updater | Signed core release discovery, compatibility checks, migration and rollback coordination |
| Shared infrastructure | Storage, email/SMS adapter, realtime transport, job scheduler and audit logging |
| Operations | Health checks, logs, metrics, maintenance mode, diagnostics and support export |
| Generic UI extension points | Plugin navigation, pages, dashboard widgets, settings panels and notification surfaces |

### 3.2 Features that must not be bundled in a clean core

A new school without plugins must not expose business menus, compiled business pages, business APIs, domain tables, scheduled business jobs or sample business data for:

- academic management;
- study years and attendance;
- timetables;
- examinations and scoring;
- courses and learning;
- announcements and communication;
- finance, fees and accounting;
- staff management and payroll;
- parent portal;
- transportation;
- cards, certificates and document design;
- cross-domain operational reporting.

The core may show an empty-state dashboard with **Browse plugins**, **Connect marketplace**, **Configure school**, **Back up now** and **System health** actions.

## 4. Target plugin directory

| Plugin | Type | Primary scope | Required dependencies |
|---|---|---|---|
| Academic Management | Foundation | Student profiles, admissions, classes, enrollment, departments and subjects | Core Directory |
| Attendance Manager | Business | Study years, sessions, holidays, student attendance, scanning, corrections, alerts and attendance reports | Academic Management |
| Timetable | Business | Rooms, periods, schedules, generation, teacher schedules and lesson attendance | Academic Management |
| Examination | Business | Exams, question banks, attempts, scores, gradebooks, printing and exports | Academic Management |
| Learning | Business | Courses, lessons, assignments, quizzes, submissions, grading and engagement | Academic Management |
| Communication | Business | Announcements, posts, messages, recipient rules and multi-channel delivery | Core notifications; optional Academic Management |
| Finance | Business | Fees, discounts, payments, receipts, accounting views and finance reports | Academic Management |
| Human Resources | Business | Employee profiles, CV, payroll, staff attendance and staff reports | Core Directory |
| Parent Portal | Composition | Parent linking and permitted views from installed plugins | Academic Management; optional domain plugins |
| Transportation | Business | Routes, stops, vehicles, riders, location updates and transport reports | Academic Management |
| Document Designer | Utility | Cards, certificates, templates, assets, previews, generation and printing | Core storage; optional Academic/HR sources |
| Reporting | Composition | Cross-plugin dashboards, exports and read-model reports | Only plugins whose read models it consumes |

Each plugin is a complete vertical package. It owns its schema, migrations, backend handlers, UI descriptors/pages, permissions, navigation, settings, jobs, events, reports, tests and documentation.

## 5. Plugin package contract

Every `.wtp` package must contain or declare:

- immutable plugin ID, semantic version and publisher identity;
- signed manifest and artifact checksum;
- compatible core version range;
- required and optional plugin dependencies with version ranges;
- database namespace and ordered immutable migrations;
- requested capabilities and granular permissions;
- backend routes/commands and idempotency requirements;
- UI pages, navigation entries, dashboard widgets and settings;
- event subscriptions/publications, jobs, notifications and realtime topics;
- health checks, data classification and backup participation;
- install, update, disable, uninstall and data-retention behavior;
- support URL, privacy policy, licence and pricing metadata.

Plugins must never directly query another plugin's tables. They communicate through versioned contracts, read models, commands and events exposed by the host SDK.

## 6. Marketplace and Plugin Manager experience

### 6.1 Catalog states

A release moves through:

`Draft -> Uploaded -> Automated checks -> Security review -> Functional review -> Approved -> Beta -> Stable -> Withdrawn`

Only signed, approved releases appear to customer schools. Compatibility is evaluated before the Install button is enabled.

### 6.2 Free plugin flow

1. School owner opens Plugin Manager.
2. Core requests the catalog using the installation identity.
3. Marketplace returns compatible approved releases.
4. Owner selects **Install** and approves requested capabilities.
5. Marketplace issues a free entitlement and short-lived download authorization.
6. Core verifies repository signature, publisher signature and checksum.
7. Core checks disk, database, dependencies, core compatibility and maintenance state.
8. Core installs files, runs migrations transactionally and activates the plugin.
9. Navigation and permissions refresh without a core rebuild.
10. The lifecycle and actor are written to both school and marketplace audit logs.

### 6.3 Paid plugin flow

The paid flow adds:

1. price, billing period, tax and refund terms are shown before purchase;
2. the marketplace creates an order and processes payment through its payment adapter;
3. a signed entitlement is issued only after verified payment/webhook processing;
4. the school synchronizes entitlement state and installs the same immutable artifact;
5. renewal failure enters a documented grace period before feature suspension;
6. suspension blocks paid operations but preserves plugin data and access to billing/recovery paths;
7. renewal or manual finance resolution restores access without reinstalling the plugin.

School billing and plugin billing are separate ledgers even if presented on one invoice.

### 6.4 Plugin lifecycle

| Action | Required behavior |
|---|---|
| Install | Verify signatures, entitlement, compatibility, dependencies, storage and migrations |
| Activate | Register routes, UI, jobs and contracts atomically |
| Disable | Stop routes/jobs/realtime safely; preserve all data |
| Update | Backup/checkpoint, run immutable migrations, health-check and support rollback |
| Uninstall | Remove executable package; retain data by default |
| Purge data | Separate privileged action with explicit typed confirmation and recovery warning |
| Reinstall | Detect retained schema and resume without duplicate data |
| Withdraw | Prevent new installs, warn affected schools and enforce the advisory action |

## 7. Core extension points required before final cutover

The core must provide stable versioned APIs for:

- identity and role lookup without exposing credential data;
- school and installation settings;
- plugin-scoped SQL transactions and advisory locks;
- storage objects and signed downloads;
- notifications and recipient resolution;
- background jobs and leader leases;
- realtime publication;
- audit events;
- navigation, pages, forms, tables, scanners, previews and dashboard widgets;
- print, CSV and PDF export;
- marketplace entitlement checks;
- backup/export registration and restore hooks;
- plugin health, diagnostics and lifecycle hooks.

No plugin extraction is accepted by adding a new private shortcut into core.

## 8. Migration strategy for existing schools

Use a **strangler migration** per plugin:

1. Inventory current pages, APIs, models, jobs, files, permissions and reports.
2. Assign one owner to every field and relationship.
3. Define versioned contracts for dependencies.
4. Create additive namespaced plugin schema.
5. Implement the complete plugin vertical slice.
6. Add a read-only preflight with counts and privacy-safe hashes.
7. Take and verify a restorable backup.
8. Run zero-write dry-run and record expected reconciliation.
9. Copy data through resumable, idempotent, journaled adoption tooling.
10. Shadow-read or dual-write only where a documented temporary bridge is necessary.
11. Compare legacy and plugin results for API, UI, report, print and export parity.
12. Switch ownership behind a reversible compatibility flag.
13. Test disable, update, restore, rollback and reinstall.
14. Run a controlled customer pilot.
15. Retain legacy data for the approved rollback window.
16. Remove legacy code/tables only after sign-off and a final backup.

Do not migrate all modules in one release. A failure in one plugin must not prevent other plugins or core administration from operating.

## 9. Recommended implementation order

Required hosted PR validation is green at commit `e0464ca` (run `36527087291`), including all
official-plugin PostgreSQL certifications, every restored-school rehearsal, the clean-core artifact,
source-built deployment smoke, S3 artifact compatibility, frontend production build, Platform Admin
browser/accessibility coverage and secret scanning
([evidence](../acceptance/lean-core/wordpress-style-required-pr-validation-2026-09-29.md)). This closes
the shared CI execution gap; it does **not** substitute for the persistent Railway clean-school,
customer pilot or organizational approval gates described below.

### Phase 0 — Freeze architecture rules

- Approve this core boundary and the plugin ownership map.
- Decide pricing, entitlement, data-retention and third-party publisher policies.
- Freeze Plugin SDK 1.x contracts and supported core-version rules.
- Add CI rules that reject optional business ownership in core.

### Phase 1 — Complete the platform kernel

- [~] Finish marketplace-only installation and remove customer local-package upload. Customer-side
  package ingestion is removed and CI-enforced; clean hosted fresh-install certification remains.
- [x] Complete capability consent, dependencies, update/rollback and data-retention UX. Initial
  Marketplace installs now disclose signed capabilities, permissions, required/optional
  dependencies, migration risk and retention behavior; a server-validated consent digest prevents
  stale or bypassed approval, and missing active dependencies disable installation. Updates use the
  same server-bound disclosure, and rollback appears only when a previous healthy artifact
  generati on exists
  ([ins tall evidence](../acceptance/lean-core/wordpress-style-install-consent-2026-09-25.md),
  [lifecycle evidence](../acceptance/lean-core/wordpress-style-update-rollback-ux-2026-09-25.md)).
- [~] Complete signed entitlements, grace periods and nonpayment behavior. Per-plugin runtime
  enforcement, signed status/generation, online/offline anti-replay, five-minute skew handling and
  legacy-token upgrade, and signed/generated whole-school control decisions are implemented and
  focused-test verified
  ([evidence](../acceptance/lean-core/wordpress-style-plugin-entitlement-enforcement-2026-09-26.md));
  hosted expiry/revocation/replay/clock-skew/outage drills remain.
- [~] Complete plugin-aware backup/restore and diagnostics. Recovery sets now bind database,
  plugin code and mutable plugin data; restore pre-stages and verifies archives before guarded
  replacement, the status API reports coverage, and Plugin Manager exposes aggregate registry/
  artifact/runtime/licence/contract/job diagnostics
  ([evidence](../acceptance/lean-core/wordpress-style-plugin-recovery-diagnostics-2026-09-26.md)).
  The current-schema GitHub-hosted quarterly drill now restores 91 managed tables plus plugin code
  and mutable plugin data with exact identity and a 0.844-second measured RTO
  ([evidence](../acceptance/gate-b008-scheduled-backups-and-restore-drills-2026-08-29.md)). Clean
  Railway and production-shaped self-hosted plugin restore/reconciliation drills remain.
- [x] Make navigation and dashboard entirely extension-driven. Optional business links and cards
  now come from active permission-filtered plugin extensions, all desktop/mobile surfaces compose
  the same runtime registry, and plugins can provide bounded dashboard title, description,
  priority or opt out ([evidence](../acceptance/lean-core/wordpress-style-extension-driven-navigation-dashboard-2026-09-26.md)).

### Phase 2 — Finish foundation plugins

1. [~] Academic Management. A guarded real-PostgreSQL migration/runtime certification now runs in
   the PR backend job and covers immutable migrations plus department/subject lifecycle contracts
   ([evidence](../acceptance/lean-core/wordpress-style-academic-postgres-certification-2026-09-26.md)).
   Restored-backup CI rehearsals now cover departments/memberships, student profiles, enrollment
   intervals, classes, canonical subjects, and the three admissions datasets. Subject rollback was corrected to preserve plugin
   rows and switch routing metadata only; its local PostgreSQL 16 execution passes with exact parity
   ([subject gate status](../acceptance/lean-core/wordpress-style-existing-school-academic-subjects-rehearsal-2026-09-28.md)).
   Admissions now has the same backup/restore, zero-write dry-run, exact reconciliation, and
   non-destructive rollback gate; its PostgreSQL 16 run passes all three dataset reconciliations
   ([admissions gate status](../acceptance/lean-core/wordpress-style-existing-school-academic-admissions-rehearsal-2026-09-28.md)).
   Legacy Study Years now have an equivalent restored-backup gate into Attendance Manager; its
   PostgreSQL 16 result passes exact row/current-year parity and preservation checks
   ([Study Year gate status](../acceptance/lean-core/wordpress-style-existing-school-attendance-study-years-rehearsal-2026-09-28.md)).
   The aggregate read-only cutover gate now composes departments/memberships, profiles, enrollment,
   classes, subjects, admissions, and Attendance-owned Study Years, including every backup-bound
   reconciled journal. Academic Management no longer registers duplicate Study Year routes and
   consumes Attendance Manager's versioned read model for class responses; its previously published
   migration remains immutable but dormant. Hosted green-run, browser parity and pilot evidence remain.
2. [~] Human Resources identity boundary where staff data is required. Payroll approval/payment is
   now transaction-locked and a guarded PostgreSQL certification covering migrations, normalized
   CV, concurrent payroll segregation, attendance upsert and privacy-minimized projections runs in
   CI ([evidence](../acceptance/lean-core/wordpress-style-human-resources-postgres-certification-2026-09-26.md)).
   Its six-dataset restored-school gate passes backup, zero-write dry run, exact-only USD adoption,
   reconciliation and rollback on PostgreSQL 16 while explicitly withholding specialist approval
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-human-resources-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup lifecycle, specialist approval and pilot evidence remain.
3. [~] Communication shared delivery capability where domain plugins need alerts. Communication
   and Transportation now use the actual SDK `notifyUser` contract with explicit, permission-safe
   recipients rather than a mock-only broadcast method
   ([SDK evidence](../acceptance/lean-core/wordpress-style-realtime-sdk-alignment-2026-09-26.md)).
   A guarded PostgreSQL certification now proves atomic message/outbox storage, authorization,
   privacy-minimized projections, delivery state and published posts in CI
   ([database evidence](../acceptance/lean-core/wordpress-style-communication-postgres-certification-2026-09-26.md)).
   Its representative restored-school gate passes backup, zero-write dry run, exact message/post
   adoption, reconciliation and rollback on PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-communication-rehearsal-2026-09-28.md)).
   Hosted green-run/outage, hosted-backup execution, WebSocket reconnect, browser/mobile lifecycle
   certification and pilot evidence remain.

Dependent plugins cannot be certified until their foundation contracts are stable.

All official data-bearing/read-model plugin runtime certifications now pass locally against an
isolated PostgreSQL 16.14 database. Live execution found and corrected timestamp, bigint,
advisory-lock and migration-runner defects; affected plugins were patch-bumped and re-certified
([evidence](../acceptance/lean-core/wordpress-style-official-plugin-postgres-runtime-certification-2026-09-28.md)).

### Phase 3 — Migrate independent vertical modules

1. [~] Document Designer. Its real runtime, immutable migration, active-template database
   invariant, bounded generation model and plugin-scoped asset lifecycle now have a guarded
   PostgreSQL certification in CI
   ([evidence](../acceptance/lean-core/wordpress-style-document-designer-postgres-certification-2026-09-26.md)).
   Hosted green-run, restored-backup adoption/rollback, browser print/export parity,
   object-storage provider certification and pilot evidence remain.
2. [~] Attendance Manager. The immutable published migration lineage now has an exact
   checksum-pinned installer compatibility path, and guarded PostgreSQL certification covers
   Study Year concurrency, student-domain enforcement, correction audit, reporting, minimized
   projections and absence-alert delivery
   ([evidence](../acceptance/lean-core/wordpress-style-attendance-postgres-certification-2026-09-26.md)).
   A complete restored-school PostgreSQL 16 gate now proves zero-write preflight, adoption,
   fingerprint reconciliation and rollback preservation for all six legacy datasets
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-attendance-manager-rehearsal-2026-09-28.md)).
   Hosted green-run, legacy client cutover, browser/device parity, hosted-backup execution and
   pilot evidence remain.
3. [~] Timetable. Release `0.1.4` now declares its Academic Management dependency, contributes
   extension-driven dashboard metadata, persists period configuration during fresh creation, and
   has guarded PostgreSQL certification for its immutable lineage, directory references,
   non-mutating preview, collision constraints, atomic generation and teacher lesson attendance
   ([evidence](../acceptance/lean-core/wordpress-style-timetable-postgres-certification-2026-09-26.md)).
   Its complete eight-dataset restored-school gate passes backup, zero-write dry run, adoption,
   exact reconciliation and rollback on PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-timetable-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, legacy cutover, rich browser/device parity and
   pilot evidence remain.
4. [~] Examination. Release `0.1.5` now serializes first-attempt creation, contributes
   extension-driven dashboard metadata, and has guarded PostgreSQL certification covering its
   immutable lineage, answer-key redaction, concurrent attempt start/submit, automatic grading,
   Academic-bound gradebooks, reports and minimized student projections
   ([evidence](../acceptance/lean-core/wordpress-style-examination-postgres-certification-2026-09-26.md)).
   Its complete eight-dataset restored-school gate passes backup, zero-write dry run, adoption,
   exact reconciliation and rollback on PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-examination-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, legacy cutover, rich-question/report browser
   parity, accessibility and pilot evidence remain.
5. [~] Learning. Release `0.1.3` contributes extension-driven dashboard metadata and has an
   explicit approval-bound PostgreSQL certification covering its fourteen-migration lineage,
   destructive multi-attempt identity, course lifecycle, roster enrollment, answer-key-safe
   playback, concurrent lesson attempts/completion and course attendance
   ([evidence](../acceptance/lean-core/wordpress-style-learning-postgres-certification-2026-09-26.md)).
   Its complete thirteen-dataset restored-school gate passes explicit destructive-migration
   approval, backup, zero-write dry run, adoption, exact reconciliation and rollback on
   PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-learning-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, legacy cutover, full browser/accessibility,
   notification delivery and pilot evidence remain.
6. [~] Transportation. Release `0.1.3` contributes extension-driven dashboard metadata and has
   guarded PostgreSQL certification covering its five-migration lineage, Directory-validated
   vehicles, Academic-roster rider assignment, transactional location capture, privacy-minimized
   student projections and recipient-scoped parent/student realtime delivery
   ([evidence](../acceptance/lean-core/wordpress-style-transportation-postgres-certification-2026-09-26.md)).
   Its complete legacy Bus restored-school gate passes backup, zero-write dry run, adoption,
   exact reconciliation and rollback on PostgreSQL 16; rider assignment is correctly classified
   as plugin-only rather than fabricated legacy data
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-transportation-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, legacy Bus cutover, real GPS/device ingestion,
   browser/map accessibility, lifecycle and pilot evidence remain.
7. [~] Finance. Release `0.1.1` adds a permission-separated immutable compensating reversal
   ledger and extension-driven dashboard metadata. Guarded PostgreSQL certification covers its
   immutable migration lineage, Academic enrollment enforcement, minor-unit money, concurrent
   overpayment prevention, receipt immutability, one-time reversal and balance projection
   ([evidence](../acceptance/lean-core/wordpress-style-finance-postgres-certification-2026-09-26.md)).
   Its representative restored-school gate passes backup, zero-write dry run, exact-only USD
   minor-unit adoption, reconciliation and rollback on PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-finance-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, historical currency approval, receipt/report
   browser parity, specialist approvals, lifecycle and pilot evidence remain.

Complete and certify one plugin before beginning its production cutover.

### Phase 4 — Migrate composition plugins

1. [~] Parent Portal. Release `0.1.2` serializes request resolution before account mutation,
   contributes extension-driven dashboard metadata, and has guarded PostgreSQL certification for
   concurrent approval, roster row scope, keyed read-model access and graceful mixed-provider
   degradation
   ([evidence](../acceptance/lean-core/wordpress-style-parent-portal-postgres-certification-2026-09-26.md)).
   Its representative restored-school gate passes backup, zero-write dry run, directory-identity
   adoption, exact reconciliation and rollback on PostgreSQL 16
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-parent-portal-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, password-reset onboarding, browser/accessibility,
   lifecycle and parent/school pilot evidence remain.
2. [~] Reporting. Release `0.1.2` adds spreadsheet-formula-safe CSV output and extension-driven
   dashboard metadata. Guarded PostgreSQL certification exercises the real core read-model table,
   administrator authorization, Academic roster key scope, mixed-provider degradation, privacy
   minimization and staff/student exports
   ([evidence](../acceptance/lean-core/wordpress-style-reporting-postgres-certification-2026-09-26.md)).
   Its stateless restored-school gate preserves the legacy roster hash, verifies approved totals,
   keyed reads, privacy and CSV safety, and leaves no Reporting table or read-model residue
   ([upgrade evidence](../acceptance/lean-core/wordpress-style-existing-school-reporting-rehearsal-2026-09-28.md)).
   Hosted green-run, hosted-backup execution, browser/print/PDF accessibility, lifecycle,
   cutover approval and pilot evidence remain.

These plugins consume only permission-filtered, versioned read models from installed providers and must degrade gracefully when an optional provider is absent.

### Phase 5 — Make lean core the default

- [~] Produce a core artifact containing no optional business pages or server modules. Physical
  artifacts pass the clean-core gate, and the beta release workflow now explicitly publishes only
  `backend/Dockerfile.core` and `frontend/Dockerfile.core` after rebuilding and rescanning them
  ([release evidence](../acceptance/lean-core/wordpress-style-core-release-image-enforcement-2026-09-26.md)).
  Signed beta `0.2.0` is now published with immutable API/web/gateway digests after all three
  vulnerability gates, keyless signing and blueprint verification passed
  ([release evidence](../acceptance/lean-core/wordpress-style-core-release-image-enforcement-2026-09-26.md));
  runtime boot of those exact released digests remains pending.
- Provision a completely new school with only the default features in section 3.
- [~] Railway and self-hosted deployment blueprints now bind API/web explicitly to `core`; the
  self-hosted blueprint requires externally supplied digest-pinned images and persists database and
  complete API state. Contract tests render and verify the Railway blueprint
  ([evidence](../acceptance/lean-core/wordpress-style-core-deployment-blueprints-2026-09-26.md)).
  A PR acceptance job now builds the physical core images, boots the complete self-hosted topology,
  performs a fresh HTTP installation, rejects representative legacy pages/tables and creates a
  recovery artifact
  ([automation evidence](../acceptance/lean-core/wordpress-style-core-deployment-smoke-automation-2026-09-26.md)).
  Hosted CI run `36521359176` now passes the complete source-built topology, fresh installation,
  core-only schema, recovery-set and isolated restore/reconciliation sequence
  ([automation evidence](../acceptance/lean-core/wordpress-style-core-deployment-smoke-automation-2026-09-26.md)).
  Required validation run `36527087291` re-certified that complete source-built deployment smoke
  together with every plugin runtime and restored-school rehearsal at commit `e0464ca`
  ([validation evidence](../acceptance/lean-core/wordpress-style-required-pr-validation-2026-09-29.md)).
  Released-image workflow run `36521972883` also verifies the retained blueprint and Cosign
  signatures, boots the exact `0.2.0` API/web/gateway digests without rebuilding, completes fresh
  installation and reconciles a full restore in hosted Docker. A persistent operator-controlled
  host and clean Railway released-image drill remain pending.
  A fail-closed Railway preflight now verifies the linked API deployment, gateway health,
  installation state, public/marketplace hosts, image digest and exact `core` distribution without
  exposing service secrets. Its first run correctly rejected the currently linked customer school
  because it is healthy but still configured as `legacy-full`
  ([preflight evidence](../acceptance/lean-core/wordpress-style-railway-core-hosted-preflight-2026-09-28.md)).
  The Railway provisioner now accepts an explicit `--distribution core`, requires that choice to
  match the digest-pinned release blueprint, applies it consistently to API and web, and keeps
  `legacy-full` as the unapproved default. It therefore supports an isolated certification school
  without silently converting existing production schools
  ([provisioning evidence](../acceptance/lean-core/wordpress-style-railway-core-provisioning-guard-2026-09-28.md)).
  Release evidence now binds the repository and exact `core-release.yml@refs/heads/main` identity;
  the release workflow and Railway provisioner independently verify all three keyless GHCR digest
  signatures with `cosign`, and provisioning fails before mutation for an absent signature, wrong
  workflow identity, non-GHCR artifact or missing verifier
  ([signature evidence](../acceptance/lean-core/wordpress-style-core-image-signature-verification-2026-09-28.md)).
- Link the marketplace and install one free and one paid plugin.
- Prove update, disable, uninstall, reinstall, backup and restore.
- Change new-school provisioning from `legacy-full` to `core` only after approval.

### Phase 6 — Retire compatibility code

- Migrate every supported existing school.
- Complete the rollback retention period.
- Archive final legacy backups.
- Remove old controllers, tables, static pages and compatibility flags.
- Keep migration readers only in controlled offline recovery tooling where legally required.

## 10. Delivery checklist for every plugin

A plugin is complete only when all boxes are satisfied:

- [ ] Ownership inventory covers backend, database, UI, mobile, jobs, files and reports.
- [ ] Manifest and package validate against the supported Plugin SDK.
- [ ] Schema is namespaced and migrations are immutable, ordered and retry-safe.
- [ ] Routes enforce granular permissions and row scope.
- [ ] UI and navigation appear only while the plugin is active and entitled.
- [ ] Dependencies use versioned contracts and fail with actionable messages.
- [ ] Marketplace installation works on a clean lean-core school.
- [ ] Free or paid entitlement flow works as declared.
- [ ] Disable drains jobs/realtime and preserves data.
- [ ] Update and rollback are proven against PostgreSQL.
- [ ] Uninstall and reinstall preserve data; purge is a separate action.
- [ ] Backup and restore include the plugin and pass reconciliation.
- [ ] Existing-school adoption is backup-bound, resumable and reversible.
- [ ] Reports, print, CSV/PDF and device workflows meet parity requirements.
- [ ] Security, privacy and accessibility reviews pass.
- [ ] Browser and real-device tests pass where applicable.
- [ ] Beta pilot completes before Stable publication.
- [ ] Support, documentation, telemetry and incident runbooks exist.

## 11. Architecture enforcement in CI

Add mandatory checks that fail when:

- core imports a plugin implementation;
- a plugin reads another plugin or core-owned private table;
- plugin SQL uses an unapproved namespace;
- a clean-core build contains a registered optional business route or page;
- a manifest requests undeclared capabilities;
- a package is unsigned or a published artifact changes bytes;
- a migration lacks identity/checksum metadata;
- navigation exposes an inactive or unentitled plugin;
- uninstall deletes business data without an explicit purge operation;
- compatibility or dependency ranges are invalid;
- backup coverage is missing for a stateful plugin.

## 12. New-school acceptance scenario

A release candidate passes only if this complete scenario succeeds:

1. Platform admin creates a school installation.
2. Railway or self-hosted provisioning deploys only core, web, gateway and database.
3. Owner completes setup and MFA.
4. Dashboard shows core administration actions and no business-module menus.
5. Owner claims/connects the installation to a marketplace account.
6. Plugin Manager shows compatible free and paid plugins.
7. Owner installs Academic Management and Attendance Manager.
8. Their menus, permissions and setup flows appear immediately.
9. Owner purchases and installs one paid plugin.
10. Entitlement renewal, grace and recovery are exercised.
11. A plugin is disabled, updated, uninstalled and reinstalled with data preserved.
12. The school backup is restored into a clean environment and reconciles all plugin data.
13. Core is upgraded without rebuilding or losing installed plugins.

## 13. Existing-school acceptance scenario

For each production school:

1. confirm supported source version and available storage;
2. take and restore-test a backup;
3. install required foundation plugins;
4. run each migration preflight and dry-run;
5. migrate and reconcile modules in dependency order;
6. certify administrators, teachers, students and parents as applicable;
7. keep the reversible legacy route during the rollback window;
8. monitor errors, latency, jobs, storage and entitlement state;
9. obtain school-owner acceptance;
10. remove legacy ownership only after central release approval.

## 14. Key risks and controls

| Risk | Required control |
|---|---|
| Core is visually empty but still ships legacy code | Build a separate core distribution and scan compiled routes/modules |
| Plugins become tightly coupled | Enforce contract-only communication and dependency ranges |
| Existing data is lost | Verified backup, additive schema, journaled copy, exact reconciliation and rollback window |
| Paid customer is incorrectly blocked | Signed cached entitlement, webhook idempotency, grace period and operator recovery |
| Unpaid customer continues using paid code | Server-side entitlement enforcement, not menu hiding |
| Marketplace outage disables schools | Cached signed entitlement and bounded offline grace period |
| Malicious or broken plugin harms the school | Signature verification, capability consent, namespace isolation, review and kill switch |
| Update breaks dependencies | Resolver simulation, compatibility matrix, staged rollout and rollback |
| Plugin removal deletes records | Retain-by-default uninstall and separately authorized purge |
| Cross-plugin reports leak data | Permission-filtered versioned read models and row-scope tests |
| Third-party support becomes unclear | Publisher identity, support ownership, SLA and incident policy in catalog metadata |

## 15. Definition of reform completion

The WordPress-style reform is complete only when:

- clean installations contain only the lean-core capabilities in section 3;
- every optional module in section 4 is installable from the plugin directory;
- no optional module must be compiled into or deployed with core;
- free and paid entitlement workflows pass end to end;
- new and existing schools pass their acceptance scenarios;
- all stateful plugins pass backup, restore, update and rollback certification;
- inactive/unentitled plugins expose no operational business routes or jobs;
- legacy business ownership is removed after approved rollback windows;
- Railway and self-hosted distributions produce the same supported behavior;
- security, privacy, legal, finance, operations and release owners approve production default.

Until every condition is evidenced, describe the reform as **in progress**, even when local plugin source and tests exist.

## 16. Immediate next actions

1. Approve the exact lean-core feature list in section 3.
2. [Complete: LCF-005] The strict `npm run architecture:clean-core:gate` verifier rejects compiled
   optional backend modules, bundled module symbols, static business pages and hard-coded plugin
   pages. Fresh backend and frontend core artifacts pass with zero violations, and required PR
   validation rebuilds and checks them. Hosted runtime certification is tracked separately
   ([evidence](../acceptance/lean-core/wordpress-style-physical-core-artifacts-2026-09-25.md)).
- [x] Prove the core starts no optional business runtime. The artifact gate now rejects every
  decorated optional provider, controller, scheduled job, queue processor, resolver and gateway,
  and CI boots the verified physical bundle
  ([evidence](../acceptance/lean-core/wordpress-style-no-optional-runtime-2026-09-28.md)).
- [x] Prove the fresh core database contains exactly the migration-derived core table allowlist.
  The fail-closed verifier, image wiring and required CI step pass contract tests and a disposable
  PostgreSQL 16 core deployment. Both the newly installed and recovery-restored databases contained
  exactly 29 canonical tables and zero unexpected tables
  ([evidence](../acceptance/lean-core/wordpress-style-no-optional-schema-2026-09-28.md)).
- [~] Offer optional starter bundles strictly as Marketplace metadata that expands into ordinary
  multi-line commerce and independently signed/consented plugin installs. The schema, APIs, school
  UI, Platform Admin governance and retry-safe orchestrator are implemented. A required isolated
  PostgreSQL lifecycle drill and a two-database signed install/retry/remove/reinstall drill are
  wired into CI. The isolated Marketplace lifecycle drill passes locally, and hosted Phase E run
  `36525681934` passes the complete 75-check two-database Marketplace-to-school drill, the
  cross-service entitlement/offline matrix, the real school entitlement boundary and the final
  production build. Required hosted run `36524572802` also passes the real-stack Platform Admin
  bundle-governance browser journeys. A browser-driven install on a persistent newly provisioned
  clean school remains
  ([evidence](../acceptance/lean-core/wordpress-style-starter-bundles-2026-09-28.md)).
3. Finish and certify Academic Management because most plugins depend on it.
4. Complete the production-shaped artifact-store drill and plugin backup/restore gate.
5. Certify Attendance Manager as the first full dependent vertical plugin.
6. Repeat the same pipeline for Timetable, Examination, Learning, Communication, Transportation, Finance and HR.
7. Complete Parent Portal and Reporting after their provider contracts stabilize.
8. Run the full new-school scenario before changing the provisioning default.

The next external action is item 8 on a new, isolated Railway `core` project. Do not repurpose an
existing `legacy-full` customer school. Because the certification project may incur Railway cost,
create it only after explicit operator approval for that billable resource.
