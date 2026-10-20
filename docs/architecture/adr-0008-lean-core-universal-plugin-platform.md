# ADR-0008: Lean core and universal plugin platform

Status: **Accepted and certified in isolation**  
Decision date: 2026-10-20  
Supersedes: the business-module boundary proposed by DEC-004

## Decision

Wattanam Customer School is a lean-core, plugin-first modular monolith. Authentication, authorization, installation identity, Marketplace linking, billing enforcement, plugin lifecycle, recovery, updates, audit and operational health remain in core. Academic, workforce and other business capabilities are distributed as signed universal plugins.

Plugins depend on versioned SDK contracts and capability-gated host services. Core must not import an official plugin's implementation, plugins must not query another plugin's tables, and Marketplace must not store customer operational records.

## Runtime profiles

- `declarative-only`: portable UI and host-declared data sources; no plugin JavaScript executes in the host process.
- `trusted-in-process`: permitted only for explicitly allow-listed publishers, currently official `wattanam` packages.
- `isolated`: reserved for a future separately deployed execution service. Until that service and protocol are certified, third-party packages with a backend entry fail closed.

A package signature proves provenance, not confinement. Capability checks do not turn native Node.js code into a sandbox.

## Persistence profile

Existing installations retain namespaced plugin tables because converting immutable historical migrations to PostgreSQL schemas would jeopardize restore compatibility. Runtime database roles, table-prefix validation, statement/lock timeouts and quotas provide the certified compatibility boundary. Schema-per-plugin may be introduced only for new installations or a separately rehearsed migration profile.

## Operational requirements

- API and worker use distinct restricted PostgreSQL identities.
- Only the migration subprocess receives migration-owner credentials.
- API and worker run the same digest-pinned backend image.
- Plugin artifacts and repository metadata are signed and revocable.
- Repository signing supports a remote KMS/HSM adapter; private keys need not reside in the Marketplace API.
- Railway infrastructure is defined through `.railway/railway.ts`; service secrets remain externally managed.
- Every production rollout requires a recovery point, zero-destroy plan, staged health checks and rollback evidence.

## Consequences

This model provides WordPress-like installation and lifecycle UX with stricter signing, compatibility and permission controls. It intentionally provides less freedom than arbitrary WordPress PHP execution. Official backend plugins may run in-process; unreviewed third-party backend code remains unsupported until real process or container isolation exists.

Certification evidence is recorded in `docs/acceptance/architecture-recommendations-certification-2026-10-20.json`.
