# Architecture recommendations implementation

This program advances the certified universal plugin architecture without weakening existing-school compatibility or deleting customer data.

## Delivery order

1. **Database containment** — bound plugin runtime SQL and migrations, introduce least-privilege API/worker database identities, and evaluate schema-per-plugin enforcement behind a compatibility mode.
2. **Operational automation** — make trust rotation atomic, schedule recovery sets, continuously test isolated restores, and alert on worker, migration, signature, and dead-letter failures.
3. **Contract governance** — publish versioned event/read-model compatibility rules, deprecation windows, and automated consumer compatibility checks.
4. **Marketplace governance** — add publisher review states, key revocation, package quarantine, and installation denial for revoked publishers or artifacts.
5. **Developer and UI tooling** — add plugin scaffolding/validation commands, reusable UI fragments, schema-version migration tools, and automated accessibility gates.
6. **Advanced isolation** — offer PostgreSQL schema-per-plugin and remote integration execution profiles while preserving the current namespaced-table compatibility path.

## Implementation status

| Work item | Status | Evidence |
| --- | --- | --- |
| Runtime SQL statement and lock timeout | Implemented, local verification passed | `plugin-database-policy.ts`; focused Jest coverage |
| Migration statement and lock timeout | Implemented, local verification passed | Transaction-local policy applied before plugin migrations |
| Namespaced-table SQL validation | Existing and verified | Shared install/runtime SQL guard |
| Request, SQL, job, storage and notification quotas | Existing and verified | Plugin quota services and tests |
| Durable versioned events and read models | Existing and verified | Transactional outbox, idempotent consumers and dead letters |
| Declared event/read-model compatibility | Implemented and catalog-certified locally | SDK 1.3 manifests declare produced/consumed versions and a minimum deprecation window; runtime rejects undeclared use; Marketplace rejects consumers without a declared dependency or a compatible producer version |
| Least-privilege API/worker database identities | Implementation ready; isolated rehearsal pending | Worker skips core migrations; API supports `MIGRATION_DATABASE_URL`; additive role provisioning CLI is guarded and tested |
| Schema-per-plugin isolation | Evaluated; namespaced-table compatibility profile retained | Moving existing installations would break immutable migration checksums and customer backups; restricted runtime identities, table-prefix validation, and bounded SQL are the safe production profile. A future remote-execution profile can opt into schemas without changing existing plugins. |
| Automated trust rotation | Implemented; hosted drill pending | `trust:rotate:railway` stages an overlap bundle on both roles, redeploys, and runs hosted preflight |
| Scheduled recovery and restore drill | Implemented; hosted execution pending | Worker cron creates recovery-set v2 from local or S3 storage; monthly workflow restores into a separately named rehearsal database and runs hosted preflight |
| Publisher review and key revocation | Implemented across Marketplace and host; hosted drill pending | Marketplace two-person review/quarantine exists and now distributes revoked keys in the signed index; Customer School persists and enforces them after every trust merge |
| Universal UI modularity and accessibility | Implemented locally | Declarative UI v2 supports bounded, cycle-safe reusable fragments; the scaffold uses them; CLI validation rejects non-universal UI before packaging; rendered pages expose named regions and sortable tables expose accessible sort state |

## Hosted certification snapshot (2026-10-20)

The isolated `plugin-certification-20261018` environment is healthy: core distribution, split API/worker services, identical image digests, gateway health, completed installation, object storage, and Marketplace trust parity all passed. Explicit quota, timeout, payload-size, and publisher-revocation controls were staged on both runtime services without triggering a deployment and are now owned by Railway IaC and the new-school provisioner.

Certification intentionally remains failed closed on two database controls: API and worker still share one database identity, and the API has no separate `MIGRATION_DATABASE_URL`. These credentials must be created and rehearsed against an isolated restored database before switching service URLs. No production or customer database credentials were changed during this implementation pass.

## Implemented controls

- Plugin SQL uses bounded, transaction-local statement and lock timeouts. Migrations use a separately bounded policy.
- Worker startup no longer runs core migrations. `MIGRATION_DATABASE_URL` is scoped to the API migration subprocess, and the runtime-role provisioning command creates separate restricted API and worker PostgreSQL identities.
- Publisher package-signing keys have an emergency deny-list (`PLUGIN_REVOKED_PUBLISHER_KEYS_JSON`). Revocation is applied after static, database, legacy-file, and signed-marketplace-release trust merges, so a catalog response cannot reintroduce a revoked key.
- Hosted preflight compares the revocation deny-list fingerprint between API and worker to prevent split-runtime trust drift.
- Prometheus metrics and alert rules cover database/migration health, stale or unverifiable recovery sets, failed plugin installations/jobs, unreplayed event dead letters, and stalled split-runtime rollouts.
- The guarded recovery drill accepts only a distinct PostgreSQL database whose name explicitly identifies it as a rehearsal target, selects the newest strict recovery-set v2 journal, restores into temporary plugin directories, and records evidence without exposing database credentials.
- Runtime quotas are explicit in the environment contract for requests, SQL, realtime events, concurrent jobs, durable notifications, object storage, event payloads and read models. PostgreSQL statement/lock timeouts remain the final database backstop.
- Universal UI fragments are expanded and validated by the host before rendering. Unknown references, cycles, excessive nesting, duplicate expanded IDs, and more than 100 expanded components fail closed. The plugin CLI performs an earlier portability check for developer feedback.
- Database transactions have their own `database.transaction` capability. They are no longer incorrectly coupled to durable events; existing packages that used `events.durable` for transactions remain compatible, while current official plugins declare the narrower grant. Durable publishers still require signed event/version declarations.
- Every official read-model producer and consumer declares its supported versions. The Marketplace catalog gate resolves owners, verifies dependency declarations, and requires a producer/consumer version intersection before a package set can pass certification.

## Operator rollout sequence

1. Release and deploy the same digest-pinned backend image to API and worker.
2. In an isolated restored environment, provision `wattanam_api` and `wattanam_worker` with `npm --prefix backend run db:runtime-roles:provision -- --execute --confirm-database <database>`.
   On Railway, use the guarded end-to-end command after deploying this release: `npm run db:runtime-roles:cutover:railway -- --environment <isolated-environment> --confirm-database <database> --execute --confirm-environment <isolated-environment>`. It generates credentials in memory, sends them to the API container over stdin, stages secrets without printing them, redeploys both roles, runs hosted preflight, and restores the shared runtime URLs if the cutover fails.
3. Set API `DATABASE_URL` to the restricted API identity, worker `DATABASE_URL` to the restricted worker identity, and API `MIGRATION_DATABASE_URL` to the migration owner. Never expose the migration URL to the worker.
4. Apply identical `PLUGIN_REVOKED_PUBLISHER_KEYS_JSON` values to API and worker in one maintenance change. Keep the previous signing key trusted during normal rotation; deny-list a key only for compromise or publisher removal.
5. Redeploy both roles and run hosted preflight. Activation must fail with `Publisher key is revoked` for a package signed by a denied key.

## Safety rules

- Every database change is additive until a verified restored-backup rehearsal passes.
- Existing plugin migrations and checksums remain immutable.
- Production changes require a recovery point, a pinned zero-destroy plan, and post-deploy health checks.
- No Marketplace-specific plugin source is added to Customer School.
- New plugin capabilities fail closed when the host does not understand their contract version.
