# Provider-neutral platform architecture review — 2026-10-26

## Decision

The deleted Railway projects are treated as removed infrastructure, not as deleted application
state. The source architecture remains a three-part system:

1. Marketplace is the central control plane for catalog, signing metadata, commerce, entitlements,
   customer directory, and operator administration.
2. Customer School is the independently deployable tenant data plane. It owns school identities,
   operational data, plugin installation state, runtime policy, and backups.
3. Universal plugins are signed packages with declarative UI, namespaced migrations, permissioned
   routes, and versioned SDK contracts. Marketplace distributes them; Customer School executes them.

Railway is now an optional deployment adapter. Docker Compose is the provider-neutral reference for
local development and customer-owned VPS hosting. No plugin or host API may depend on Railway-specific
runtime data.

## Implemented in this review

- Repaired the stale Customer School Railway IaC contract test for the current SDK API.
- Added a Marketplace Docker Compose topology with private PostgreSQL, persistent artifacts, API
  readiness checks, and an independently deployed operator UI.
- Added a safe local bootstrap that creates distinct Ed25519 repository and entitlement keys plus
  ignored random credentials; it never overwrites an existing bundle.
- Upgraded Marketplace API and Platform Admin containers to Node 24.
- Upgraded Platform Admin to Tailwind 4 and retained reusable accessible component classes.
- Reworded the school connection workflow so Docker, VPS, cloud, and Railway installations use the
  same gateway-based adoption path. The legacy `railwayProjectId` field remains only as an optional
  compatibility identifier.
- Added architecture tests that reject a host-exposed database and obsolete Node runtime lines.

## Verified boundaries

- Marketplace does not receive a school database credential or installation private key.
- Customer School does not receive Marketplace signing private keys.
- Customer School validates signed repository metadata, artifact digests, compatibility, declared
  permissions, migrations, runtime quotas, and publisher revocation before activation.
- Academic Management and Organizing Management use the universal SDK 1.3 UI contract and pass the
  host schema and behavior suites.
- Platform Admin calls Marketplace through its same-origin server proxy; operator bearer tokens are
  not exposed to browser JavaScript.

## Remaining production risks

1. A new production environment still requires immutable image publication, TLS, DNS, backups,
   monitoring, and a restore drill. Passing source tests is not deployment evidence.
2. Marketplace production requires external immutable object storage. The Compose artifact volume is
   intentionally for local/VPS evaluation, not multi-replica production.
3. Customer School multi-replica production requires split API/worker database roles and shared
   S3-compatible plugin storage. The simple Compose topology is single-node.
4. Remote KMS/HSM custody, two-key overlap, and transactional email remain external-provider gates.
5. Third-party backend code remains fail-closed until the isolated execution-plane ADR is implemented
   and certified. Trusted first-party plugins may continue using the reviewed in-process profile.
6. The legacy `railwayProjectId` database/API field should eventually be migrated to a neutral
   `hostingProjectId`; rename only through a backward-compatible API and database migration.

## Required workflow

Every release must run repository tests, universal plugin validation, official plugin behavior tests,
Customer School host compatibility tests, API and UI production builds, signed beta publication,
digest-preserving stable promotion, disposable-host activation, and post-publication catalog
verification. Infrastructure deployment follows only after those gates and a reviewed zero-destroy
plan, regardless of provider.
