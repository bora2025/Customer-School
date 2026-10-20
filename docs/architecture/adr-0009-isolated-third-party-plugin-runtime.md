# ADR-0009: Isolated third-party plugin execution runtime

Status: **Proposed; implementation intentionally blocked until remote signing is operational**  
Decision date: 2026-10-20

## Context

Universal plugin packages may include declarative UI, migrations, jobs and backend handlers. A package signature proves publisher identity and artifact integrity, but it does not make arbitrary Node.js code safe to execute inside the Customer School API or worker. The current host therefore permits backend execution only for explicitly trusted in-process publishers and rejects third-party backend entries.

## Decision

Third-party backend code will run in a separately deployed execution plane. The Customer School API and worker will never import an isolated plugin module. They will communicate with the execution plane through a versioned, mutually authenticated protocol.

Each execution request will contain an installation ID, plugin/version digest, declared capability, idempotency key, deadline, trace ID and a bounded payload. The runtime will verify the signed artifact and active publisher key, mount a read-only package image, start an unprivileged process with a read-only root filesystem, no host filesystem mount, no inherited environment, a private temporary directory, bounded CPU/memory/process count, and a hard wall-clock timeout.

Network access is denied by default. Approved integrations use explicit egress destinations through a policy proxy; database access is never provided. Data access occurs only through short-lived, audience-bound host capability tokens. Tokens authorize one declared operation, installation and tenant, expire within minutes, and cannot be exchanged for broader credentials.

## Control plane

- Marketplace records the execution profile, required capabilities, artifact digest and publisher review state in signed metadata.
- Customer School installs the artifact but schedules isolated work only after compatibility, entitlement, revocation and policy checks pass.
- The execution plane pulls artifacts from immutable object storage by digest and verifies package and repository signatures independently.
- Results are schema-validated, size-limited and persisted by the host. Plugins cannot write host or plugin tables directly.
- Jobs are at-least-once. Idempotency keys and bounded retries are mandatory; poison work moves to a per-plugin dead-letter queue.
- Audit events include tenant, installation, digest, capability, resource limits, result, duration and termination reason, but never secret values or unrestricted payloads.

## Failure and rollout model

The runtime fails closed if signing, revocation, policy, token exchange, resource isolation or audit delivery is unavailable. Rollout begins with a disposable environment and malicious-package test corpus, then a single allow-listed third-party publisher, then limited tenants. The trusted in-process path remains restricted to the official publisher and is not an automatic fallback.

Exit criteria include container-escape and SSRF tests, denial of direct database and metadata-service access, quota and timeout enforcement, key-revocation propagation, disaster recovery, signed runtime images, SBOM/provenance verification, and an operator rollback drill.

## Dependencies

Implementation may begin only after production uses immutable artifact storage, split runtime database identities, Railway IaC ownership, visible release metadata, and a remote KMS/HSM-backed repository signer with a tested overlap rotation. As of 2026-10-20, all prerequisites except the external KMS/HSM signer and its production rotation are complete.
