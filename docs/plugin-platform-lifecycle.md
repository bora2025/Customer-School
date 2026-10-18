# Wattanam portable plugin lifecycle

## Architectural rule

A published plugin must not require plugin-specific source code in Customer School. The host owns a bounded SDK and universal declarative UI primitives. A plugin owns its signed backend module, UI descriptor, isolated migrations, permissions, navigation, health check, and business data.

Older packages may continue to use legacy host components for compatibility. New packages must declare `"portability": "universal"` in `frontend/page.json`; the marketplace CLI and Customer School installer enforce the universal component allow-list.

## Package and trust boundary

Every package contains:

- `plugin.json`, including semantic version, compatible core range, capabilities, permissions, dependencies, operational contract, entries, and migration checksums;
- `checksums.json`, covering every payload file exactly;
- `signature.json`, an Ed25519 signature over `checksums.json` tied to a trusted publisher key;
- an optional backend lifecycle module;
- an optional universal declarative UI descriptor;
- append-only, plugin-namespaced migrations.

Customer School verifies archive limits, paths, exact file inventory, hashes, signature, publisher identity, core range, entry presence, migration hashes, and manifest schema before extracting code. Runtime loading re-verifies the installed directory, so disk tampering or partial VPS copies fail closed.

### Backend execution policy

A valid signature establishes provenance; it does not sandbox JavaScript. Customer School therefore permits native in-process backend execution only for publishers named in `PLUGIN_IN_PROCESS_PUBLISHERS` (default: `wattanam`). Packages from other trusted signers may use the universal declarative UI without backend code, but packages containing a backend entry fail inspection, installation, activation preflight, and runtime loading unless the operator explicitly approves that publisher. Third-party backend execution requires a future supported isolated worker/container runtime; it must not be silently treated as capability-sandboxed in the core process.

## Lifecycle

1. **Discover** — Marketplace returns releases compatible with the requesting core and installation channel.
2. **Review** — Customer School shows publisher, price/ownership, requested capabilities and permissions, required/optional dependencies, migration summary, data-retention policy, and package digest.
3. **Inspect** — The signed package is downloaded and inspected without installing. The response includes signature, compatibility, dependency, UI portability, page-count, and component-type checks.
4. **Install/update** — Files are written to a private staging directory. A per-plugin advisory lock prevents concurrent lifecycle mutations. A recovery point is created before migrations. Migrations execute only against the plugin table namespace and are recorded with immutable checksums. The staged version becomes authoritative only after the registry transaction succeeds.
5. **Activation preflight** — Customer School re-verifies installed signature and hashes, registry identity/version, UI contract, dependencies, migration ledger, entitlement, safe mode, and runtime state. Failures are returned as individual actionable checks and activation is not attempted.
6. **Activate** — The runtime registers only declared permissions, navigation, routes, jobs, events, read models, and universal pages. Capability adapters enforce least privilege. The plugin health check must report ready before registry status becomes active.
7. **Operate** — Diagnostics compare registry, artifact, runtime, entitlement, contracts, jobs, and activation state. Route errors must use stable public plugin error codes; unexpected failures remain internal and are audit logged.
8. **Deactivate** — New plugin work stops and runtime registrations are disposed. Settings, migration ledger, and business data remain preserved. Active dependents block deactivation.
9. **Update** — An active plugin may update without manual deactivation. The old runtime is briefly unloaded, the new signed version is staged and migrated, then health checked and restored to active. Migration, load, health, or rollout failure marks the staged generation failed and atomically restores the previous authoritative registry/runtime generation. If restoration itself fails, the combined failure is persisted for safe-mode recovery.
10. **Rollback** — The prior verified artifact generation is reactivated. Database changes are forward-only; migrations must therefore be backward-compatible across the supported rollback window.
11. **Remove files** — Runtime files and the registry record are removed only while inactive. Plugin-owned data, migration history, and settings are retained for later adoption/reinstall unless a future explicit, separately confirmed purge workflow is used.

## Universal UI contract

Universal pages are JSON, not downloaded browser JavaScript. This prevents plugins from escaping CSP or receiving unrestricted access to authentication state. The current reusable primitives are headings, text, workflow navigation, status, cards, metrics, tables, forms, details, charts, files, print/export, documents, designers, scanners, filters, actions, and ID-card management.

The host resolves declared data sources only inside the plugin API namespace and checks the declared permission on every request. Route parameters, paths, query filters, upload limits, field types, external URLs, executable HTML, and event subscriptions are schema validated.

## Plugin dependencies

Dependencies are package metadata, not Customer School source changes. A publisher declares semantic-version ranges in the signed manifest:

```json
{
  "dependencies": { "wattanam.academic-management": ">=0.1.0 <1.0.0" },
  "optionalDependencies": { "wattanam.communication": "^0.1.0" }
}
```

The generic Plugin Manager resolves this metadata against the local registry and displays whether each dependency is missing, inactive, compatible, or version-incompatible. Installed-plugin cards also show optional integrations and reverse dependents. Installation and activation remain blocked server-side until every required dependency is active and satisfies its range; deactivation is blocked while an active dependent requires the plugin. No host migration or plugin-specific Customer School component is needed when a new plugin declares dependencies.

## Deployment parity

Managed cloud and self-hosted VPS use the same package verifier and lifecycle services. Each process records the version and digest it actually loaded; rollout readiness cannot be satisfied merely because an older copy of the same plugin ID is already in memory. A role-side candidate load failure terminates the staged generation, restores the previously authoritative registry generation, and all roles reconcile their local runtime back to that digest.

- The plugin directory must be persistent, private to the application user, and included in filesystem backup when the operational contract requires it.
- PostgreSQL is authoritative for the registry, migration ledger, settings, jobs, and plugin business tables.
- All application replicas must share an immutable artifact cache or persistent plugin volume. Distributed rollout generations prevent mixed versions from being reported healthy.
- Publisher public keys, marketplace control keys, encryption keys, and database credentials must be supplied through deployment secrets, never embedded in an image or package.
- `PLUGIN_SAFE_MODE` starts core without activating plugins for recovery.
- A restored VPS must restore the database and plugin artifacts from the same recovery point, then run activation preflight before enabling traffic.

The Plugin Manager diagnostics now reports a separate **Host readiness** checklist. It detects managed cloud versus self-hosted VPS and verifies writable plugin code/data paths, publisher trust, Marketplace configuration, persistent installation identity storage, and the API/worker rollout-role contract. An installed plugin may be healthy while this checklist warns that future discovery or disaster recovery is unavailable; hard storage or split-runtime errors mark the host failed.

### Deployment profiles

| Profile | Required runtime shape | Required durable state | Plugin acquisition |
| --- | --- | --- | --- |
| Railway / managed cloud | `combined`, or both `api` and `worker` with `PLUGIN_REQUIRED_RUNTIME_ROLES=api,worker` | PostgreSQL plus explicit persistent `PLUGIN_DIR`, `PLUGIN_DATA_DIR`, backup and installation-identity mounts | Linked HTTPS Marketplace; each process verifies/materializes the same digest-addressed package |
| Self-hosted VPS | Prefer `combined`; split services use the same role rule | PostgreSQL plus absolute, application-private plugin, plugin-data, backup and identity paths included in one recovery set | Linked HTTPS Marketplace for normal install/update/recovery; offline packages remain developer/CI-only |

This keeps customer deployments updateable without copying new plugin source into Customer School. A new plugin is accepted only through its signed package, universal UI, SDK capabilities and namespaced migrations.

## Publisher gate

New plugins are scaffolded with universal portability. Before publishing, run:

```text
wattanam-plugin check <plugin-directory> --require-universal-ui
```

The marketplace publication pipeline must also run this gate. Organizing Management is the reference package and must pass package checking, install/update, activation preflight, activate, route/UI smoke tests, deactivate, reactivate, rollback, removal with data preservation, and reinstall/adoption.

## Remaining completion gates

- [x] Stable SDK 1.3 error contract maps expected plugin validation failures to safe 4xx responses; Organizing attendance uses the contract.
- [x] Marketplace publication runs the universal UI package checker before signing or publishing.
- [x] Host diagnostics certify the storage, trust, identity and runtime-role requirements for managed-cloud and filesystem-backed VPS deployments.
- [x] The signed catalog lifecycle exercises Organizing rollback to a prior generation and verifies data retention through remove/reinstall.
- [x] Every existing official plugin is packed, signature-verified, installed, activated, updated, deactivated, removed with retained data, and reinstalled; legacy UI is adapted during migration.
- [x] Active updates automatically restore the previous healthy registry/runtime generation after candidate activation failure.
- [x] In-process backend execution is restricted by publisher policy; declarative-only third-party packages remain portable without native execution.
- [x] Physical backend and frontend core artifacts pass the clean-core gate with zero optional business modules/pages.
- [x] Recovery-set staging/verification and every official restored-backup guard pass in the split-repository layout; Organizing Management participates through its operational contract.
- [x] Run the disposable PostgreSQL backup/restore rehearsal and the full local self-hosted VPS topology with digest-pinned core images.
- [x] Run Organizing Management 0.17.0 against disposable PostgreSQL 16, verifying all 56 migration checksums, 18 namespaced tables, 57 routes, QR scan/report/payroll workflows, and clean namespace teardown.
- [x] Re-certify all 13 official plugins from the separate publisher checkout against disposable PostgreSQL 16 and the current clean-core schema; all workflow certifications and 26 migration-contract tests pass with zero plugin tables/functions left behind.
- [x] Run the final live Railway certification in the operator-approved isolated `plugin-certification-20261018` environment: matching digest-pinned API/worker roles, signed Organizing Management install, active update, manual and induced-failure rollback, S3 artifact verification, and recovery-set restore all pass. Production remained untouched; the evidence is recorded in `docs/acceptance/plugin-platform-security-release-audit-2026-10-18.json`.

## Certification commands

```powershell
# Customer School: every official signed package and Organizing rollback
$env:PLUGIN_SOURCE_CATALOG='C:\Users\borax\wattanam-v2\plugins'
npm --prefix backend test -- --runInBand all-plugin-package-lifecycle.spec.ts
npm run build:core
npm run verify:core
node --test backend/scripts/plugin-recovery-contract.test.js backend/scripts/restore-recovery-set.test.js

# Marketplace: SDK, universal package gate, publication tools, and Organizing route contract
npm --prefix C:\Users\borax\wattanam-v2 test
node C:\Users\borax\wattanam-v2\packages\plugin-cli\bin\cli.js check C:\Users\borax\wattanam-v2\plugins\wattanam.organizing-management --require-universal-ui
```
