import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * Per-plugin PostgreSQL roles: the database-enforced boundary behind the SQL text guard.
 *
 * Every plugin statement runs inside a transaction after `SET LOCAL ROLE <plugin role>`. The role is
 * a plain NOLOGIN, non-superuser role that holds SELECT/INSERT/UPDATE/DELETE only on the plugin's own
 * `plugin_<id>_*` relations. Whatever the connection's own user may do (on hosted PostgreSQL it is
 * often the superuser), the plugin's statement may not read core tables (users, sessions, audit),
 * other plugins' tables, or server files. The text guard (plugin-sql-guard.ts) still runs first; it
 * is now a fast early error, not the only line of defence.
 *
 * Roles are reconciled (created if missing, grants refreshed) whenever a plugin loads, so tables
 * created by later migrations and databases restored without ACLs are covered automatically.
 * PostgreSQL roles are cluster-wide; grants are per database, so one role name per plugin is safe on
 * a cluster that hosts several schools.
 */

type RoleClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

const MAX_IDENTIFIER = 63;

export function pluginTableNamespace(pluginId: string) {
  return `plugin_${pluginId.replace(/[^a-z0-9]/g, '_')}_`;
}

/** Deterministic role name, always a valid unquoted-safe identifier of at most 63 bytes. */
export function pluginDatabaseRole(pluginId: string) {
  const slug = pluginId.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const name = `wtp_${slug}`;
  if (name.length <= MAX_IDENTIFIER) return name;
  const digest = createHash('sha256').update(pluginId).digest('hex').slice(0, 10);
  return `${name.slice(0, MAX_IDENTIFIER - 11)}_${digest}`;
}

/** PLUGIN_DATABASE_ROLES=off disables the boundary (explicit operator opt-out, logged by the caller). */
export function pluginDatabaseRolesEnforced(env: NodeJS.ProcessEnv = process.env) {
  return (env.PLUGIN_DATABASE_ROLES || 'enforce').trim().toLowerCase() !== 'off';
}

export function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

/** LIKE pattern that matches the namespace prefix literally (underscores are LIKE wildcards). */
function namespacePattern(pluginId: string) {
  return `${pluginTableNamespace(pluginId).replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Creates the plugin's role if needed and grants it exactly its own relations. Idempotent and safe to
 * run concurrently from several API replicas (a lost CREATE ROLE race is ignored).
 */
export async function ensurePluginDatabaseRole(client: RoleClient, pluginId: string) {
  const role = pluginDatabaseRole(pluginId);
  const quotedRole = quoteIdentifier(role);
  const existing = await client.$queryRawUnsafe<Array<{ rolname: string }>>('SELECT rolname FROM pg_roles WHERE rolname = $1', role);
  if (!existing.length) {
    try {
      await client.$executeRawUnsafe(`CREATE ROLE ${quotedRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    } catch (error) {
      if (!/already exists|42710/.test(String((error as Error)?.message || error))) throw error;
    }
  }
  const [self] = await client.$queryRawUnsafe<Array<{ superuser: boolean }>>('SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user');
  if (self?.superuser) {
    // Re-assert the attributes every time: a role edited by hand must not keep extra powers.
    await client.$executeRawUnsafe(`ALTER ROLE ${quotedRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  } else {
    // A hardened non-superuser host (CREATEROLE) may not touch REPLICATION/BYPASSRLS at all, and could
    // never have granted them; verify instead of re-asserting, and refuse a role someone widened.
    const [attributes] = await client.$queryRawUnsafe<Array<Record<string, boolean>>>(
      'SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1', role);
    const widened = Object.entries(attributes || {}).filter(([, value]) => value).map(([name]) => name);
    if (widened.length) throw new Error(`Plugin database role ${role} has unexpected attributes (${widened.join(', ')}); a superuser must reset it`);
    // Membership is what lets the host SET ROLE into the plugin role.
    await client.$executeRawUnsafe(`GRANT ${quotedRole} TO CURRENT_USER`);
  }

  await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  await client.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${quotedRole}`);
  const relations = await client.$queryRawUnsafe<Array<{ name: string; kind: string }>>(
    `SELECT c.relname AS name, c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND c.relname LIKE $1 ESCAPE '\\'
      ORDER BY c.relname`,
    namespacePattern(pluginId),
  );
  for (const relation of relations) {
    const target = `public.${quoteIdentifier(relation.name)}`;
    if (relation.kind === 'S') await client.$executeRawUnsafe(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${target} TO ${quotedRole}`);
    else await client.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${target} TO ${quotedRole}`);
  }
  return { role, relations: relations.length };
}

/** Switch the current transaction to the plugin's role. Transaction-local: COMMIT/ROLLBACK resets it. */
export async function enterPluginDatabaseRole(client: RoleClient, pluginId: string) {
  await client.$executeRawUnsafe(`SET LOCAL ROLE ${quoteIdentifier(pluginDatabaseRole(pluginId))}`);
}

/** Return the current transaction to the connection's own role (for host work in the same transaction). */
export async function leavePluginDatabaseRole(client: RoleClient) {
  await client.$executeRawUnsafe('SET LOCAL ROLE NONE');
}
