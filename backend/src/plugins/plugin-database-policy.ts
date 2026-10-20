import { Prisma } from '@prisma/client';

type PluginDatabaseClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;
type PolicyKind = 'runtime' | 'migration';

function boundedMilliseconds(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 100 || value > maximum) {
    throw new Error(`${name} must be an integer between 100 and ${maximum}`);
  }
  return value;
}

export function pluginDatabasePolicy(kind: PolicyKind) {
  const prefix = kind === 'migration' ? 'PLUGIN_MIGRATION' : 'PLUGIN_SQL';
  const statementTimeoutMs = boundedMilliseconds(`${prefix}_STATEMENT_TIMEOUT_MS`, kind === 'migration' ? 30_000 : 5_000, 15 * 60_000);
  const lockTimeoutMs = boundedMilliseconds(`${prefix}_LOCK_TIMEOUT_MS`, kind === 'migration' ? 5_000 : 1_000, 60_000);
  return { statementTimeoutMs, lockTimeoutMs };
}

/** Applies transaction-local PostgreSQL limits, so pooled connections cannot retain plugin policy. */
export async function applyPluginDatabasePolicy(client: PluginDatabaseClient, kind: PolicyKind) {
  const policy = pluginDatabasePolicy(kind);
  await client.$queryRawUnsafe(
    "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)",
    `${policy.statementTimeoutMs}ms`, `${policy.lockTimeoutMs}ms`,
  );
  return policy;
}
