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
| Declared event/read-model compatibility | Implemented and CI-certified across host and Marketplace | SDK 1.3 manifests declare produced/consumed versions and a minimum deprecation window; runtime rejects undeclared use; Marketplace rejects consumers without a declared dependency or a compatible producer version |
| Least-privilege API/worker database identities | Implemented and certified in isolation | RC4 runs distinct `wattanam_api` and `wattanam_worker` identities; the migration owner is API-only; 19 plugin tables were transferred; hosted preflight passed |
| Schema-per-plugin isolation | Evaluated; namespaced-table compatibility profile retained | Moving existing installations would break immutable migration checksums and customer backups; restricted runtime identities, table-prefix validation, and bounded SQL are the safe production profile. A future remote-execution profile can opt into schemas without changing existing plugins. |
| Automated trust rotation | Implemented and certified end to end in isolation | `trust:rotate:railway` waits for exact API/worker deployments and rolls back on failure. Customer School promoted `repository-2026-10-20-cert` with the old public key retained, Marketplace promoted the matching private signer with the old signer retained, dual-signed repository metadata was verified, and the final hosted preflight passed. |
| Scheduled recovery and restore drill | Implemented and certified in isolation | Strict recovery-set v2 with four plugin contracts restored into `wattanam_recovery_drill`; evidence file `recovery-drill-1792472323263.json`; post-drill hosted preflight passed |
| Publisher review and key revocation | Implemented and catalog-wide CI gate added | Marketplace two-person review/quarantine distributes revoked keys in the signed index; Customer School persists and enforces them after every trust merge; every official signed package is now verified to fail closed under publisher-key revocation |
| Universal UI modularity and accessibility | Implemented and CI-certified | Declarative UI v2 supports bounded, cycle-safe reusable fragments; the scaffold uses them; CLI validation rejects non-universal UI before packaging; rendered pages expose named regions and sortable tables expose accessible sort state |
| Marketplace Railway IaC | Implemented in repository and zero-change planned in isolation | `.railway/railway.ts` imports the live control-plane topology with externally managed secrets; the certification environment is already detached from deprecated Config-as-Code |
| External KMS/HSM signing boundary | Implemented and locally verified | Marketplace supports a remote Ed25519 signing endpoint, stores only configured public keys, sends canonical payload bytes, applies a bounded timeout and verifies every returned signature before publication |
| Third-party backend isolation | Fail-closed boundary adopted | ADR-0008 defines declarative-only and trusted in-process profiles; third-party backend entries remain rejected until a separately deployed execution service is implemented and certified |

## Hosted certification snapshot (2026-10-20)

The isolated `plugin-certification-20261018` environment is healthy on signed release `0.1.0-rc.20261020.4`: core distribution, split API/worker services, identical backend digest `sha256:38eadf8d2c5e56a919e0326e62fe867e7b30b1ed510ceff2af9ccda2e9888416`, gateway health, completed installation, object storage, explicit quotas/timeouts, and Marketplace trust parity all passed.

The database cutover is complete in isolation. API and worker use different restricted logins, only API receives `MIGRATION_DATABASE_URL`, and Railway IaC preserves those identities rather than restoring the PostgreSQL owner URL. A strict recovery set containing four Organizing Management package contracts was restored into the separately named `wattanam_recovery_drill` database, followed by a passing hosted preflight. Production was not changed.

The coordinated repository-signing rotation was completed in the isolated environments after explicit approval. Customer School API and worker now share `repository-2026-10-20-cert` as their primary trust anchor and retain `repository-2026-10` as secondary trust. Marketplace deployment `184fd81f-0edc-4c35-a54b-4e4a06d543e1` promoted the matching primary signer while retaining the old signer for overlap. Its ready endpoint returned HTTP 200, its repository key document and signed index exposed both key IDs, and the final Customer School hosted preflight passed at `2026-10-20T05:38:54.673Z`. The temporary private key was never committed and was deleted after upload. Production was not changed.

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
