# Full-stack plugin architecture certification roadmap

The target is a WordPress-style boundary: Marketplace owns plugin source and publishing; Customer School owns only the generic signed-package runtime, host APIs, universal UI renderer, and customer data. Installing a new compliant plugin must never require a Customer School code change or redeployment.

## Exit gates

1. **Package ownership:** every official plugin is built, tested, signed, and published from the Marketplace repository. Customer School has no test or runtime import of an official plugin source tree.
2. **Universal UI:** every official plugin declares the current universal UI SDK and passes schema, component, route-parameter, permission, accessibility, and responsive-render checks.
3. **Lifecycle:** a clean host can discover, buy or activate, download, verify, install, migrate, activate, update while active, roll back, deactivate, remove code, reinstall, and recover data without host code changes.
4. **Data safety:** migrations are immutable, single-statement, plugin-namespaced, transactional, and restore-tested. Deactivation and code removal retain customer data unless an explicit destructive uninstall is separately authorized.
5. **Contracts:** dependencies, host contracts, events, read models, navigation, and global search are versioned and fail closed when unavailable or incompatible.
6. **Operations:** Railway and VPS deployments use identical immutable API/worker artifacts, shared object storage, health checks, structured logs, metrics, backups, and tested restore procedures.
7. **Security:** publisher trust, artifact signatures, entitlement checks, tenant isolation, SSRF/path traversal/zip-bomb defenses, least-privilege capabilities, audit logs, and secret scans pass.
8. **Production-shaped proof:** the isolated Railway certification environment completes the entire signed lifecycle and recovery drill after the final code revision.

## Ordered work

- Completed 2026-10-19: all fourteen official plugins now declare SDK 1.3 universal UI and pass both the Marketplace package gate and Customer School renderer schema.
- Completed 2026-10-19: moved plugin-owned behavior suites into Marketplace (167 tests), removed all implicit Customer School filesystem access to official plugin source, changed catalog lifecycle/schema/browser acceptance to an explicit `PLUGIN_SOURCE_CATALOG` boundary, and verified 21 responsive browser flows.
- P1: add one catalog-wide CI job that checks, packs, signs, verifies, installs, activates, updates, rolls back, deactivates, removes, and reinstalls every official plugin against a clean host harness.
- P1: repeat the hosted Railway lifecycle, backup, and restore drill after all migrations and record immutable evidence hashes.
- P2: remove legacy-full host routes only after existing-customer adoption and rollback evidence proves data parity.

The current evidence and open gaps are recorded in `docs/acceptance/full-stack-architecture-audit-2026-10-19.json`.
