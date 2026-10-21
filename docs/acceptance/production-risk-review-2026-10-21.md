# Production architecture risk review — 2026-10-21

This review supersedes the pasted 8.7/10 assessment. It distinguishes verified production state,
repository controls, accepted compatibility boundaries, and controls that still require an external
provider. A repository feature is not described as operational until production evidence exists.

## Executive result

The core platform, Marketplace, and universal-plugin delivery path are production-capable for trusted
first-party plugins. New Customer School installations are core-first. Production now rejects an
unset distribution, and `legacy-full` requires an explicit reason and a non-expired approval date.
The frontend also defaults to the smaller core surface when its distribution setting is absent.

The remaining high-risk item is external custody of the Marketplace signing key. Transactional email
delivery also remains unavailable until provider credentials and a verified sender are supplied.
Those two external dependencies prevent a claim of complete production hardening.

## Risk disposition

| Risk | Disposition | Evidence / control |
| --- | --- | --- |
| Shared API/worker database identity | Closed | Production preflight verifies distinct API, worker, and migration identities. |
| Missing plugin quotas/timeouts/revocations | Closed | Hosted preflight requires matching resource controls and revoked-key policy. |
| Local Marketplace artifact storage | Closed | Immutable S3-compatible storage is active; production concurrency and digest checks passed. |
| Development installation version | Closed | Production installation reports `0.1.0-7c2e6ab`; preflight rejects development versions and mismatches. |
| Missing release metadata | Closed | Customer School and Marketplace expose release and commit metadata. |
| Railway IaC ownership | Closed | Both projects are owned by Railway IaC and obsolete Config-as-Code roots were removed. |
| SDK release bookkeeping | Closed in repository | Plugin SDK changes are recorded under release `1.3.0`, not `Unreleased`. |
| Silent legacy-mode admission | Closed in repository | Production requires `WATTANAM_DISTRIBUTION`; legacy mode requires `LEGACY_FULL_APPROVAL_REASON` and future `LEGACY_FULL_APPROVED_UNTIL`. Provisioning enforces the same policy. |
| Prefix-based database isolation | Accepted compatibility risk | Restricted identities, prefix validation, single-statement migrations, quotas, and SQL timeouts are enforced. Existing immutable migrations are not rewritten. |
| Multiple lockfiles | Not a defect | Root orchestration, backend, frontend, SDK, and CLI have independent build/publish boundaries and use their own lockfiles. |
| Scratch paths | Controlled | Generated and user-owned scratch paths are ignored; automated cleanup does not delete unknown user data. |
| Remote KMS/HSM repository signing | Open — external dependency | Remote signing adapter is implemented and tested, but no non-AWS provider endpoint, credential, or HSM-held Ed25519 key is available. Local production key must remain until cutover succeeds. |
| Two-key production overlap | Open — coupled to signer | Rotation support exists, but the primary/secondary remote keys cannot be certified before the external signer is provisioned. |
| Transactional email delivery | Open — external dependency | Durable encrypted outbox, claiming, retry, stale-claim recovery, and dead-letter behavior are implemented. Provider credential and verified sender are absent. |
| Isolated third-party backend runtime | Deliberately gated | Third-party backend execution remains fail-closed. ADR-0009 requires signer and email gates to pass before implementation. |

## Legacy compatibility policy

- New installations default to `core` in self-hosted, container, and Railway provisioning paths.
- Production cannot infer a distribution from a missing variable.
- `legacy-full` is permitted only for a documented migration or rollback window.
- The approval date is checked at every API and worker startup, so an expired exception cannot silently
  survive a restart or redeploy.
- Removal of legacy code remains conditional on inventorying and migrating every existing legacy
  installation with verified backup and rollback evidence.

## External completion gates

### Remote signing

Supply a non-AWS KMS/HSM-compatible Ed25519 signing endpoint, service authentication credential,
primary public-key document, and secondary overlap key. Then run the repository rotation runbook,
verify dual signatures from Customer School, revoke the local signer only after the overlap window,
and retain the signed evidence.

### Transactional email

Supply a supported provider credential and verified production sender. Then test verification,
password recovery, rate limiting, provider rejection, retry, dead-letter handling, and multi-replica
claiming before disabling MFA-only recovery mode.

## Verification performed

- Backend environment/startup tests: 21 passed.
- Core distribution, frontend boundary, and Railway provisioner tests: 19 passed.
- The complete Customer School core suite must remain the merge/deploy gate.
- Marketplace API and email-outbox tests previously passed; the external signer/provider gates remain
  intentionally red until real credentials are configured.

## Release decision

Safe to continue operating trusted first-party universal plugins on the certified core architecture.
Do not advertise HSM-backed signing, transactional recovery email, or isolated third-party backend
execution until their respective external gates produce production evidence.
