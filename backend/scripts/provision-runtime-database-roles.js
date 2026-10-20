'use strict';

const { PrismaClient } = require('@prisma/client');

const API_ROLE = 'wattanam_api';
const WORKER_ROLE = 'wattanam_worker';

function configuration(env = process.env, argv = process.argv.slice(2)) {
  if (argv.includes('--help')) return { help: true };
  const adminUrl = env.MIGRATION_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!adminUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  const parsed = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Database URL must use PostgreSQL');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(database)) throw new Error('Database name is unsafe');
  const execute = argv.includes('--execute');
  if (execute && argv[argv.indexOf('--confirm-database') + 1] !== database) throw new Error('--confirm-database must exactly match the target database');
  const apiPassword = env.RUNTIME_API_DATABASE_PASSWORD;
  const workerPassword = env.RUNTIME_WORKER_DATABASE_PASSWORD;
  if (execute && (!apiPassword || apiPassword.length < 32 || !workerPassword || workerPassword.length < 32)) {
    throw new Error('Runtime database passwords must each contain at least 32 characters');
  }
  return { adminUrl, database, execute, apiPassword, workerPassword };
}

function identifier(value) { return `"${String(value).replace(/"/g, '""')}"`; }
function literal(value) { return `'${String(value).replace(/'/g, "''")}'`; }

function roleStatements(config) {
  const database = identifier(config.database);
  const statements = [];
  for (const [role, password] of [[API_ROLE, config.apiPassword], [WORKER_ROLE, config.workerPassword]]) {
    statements.push(`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)}; ELSE ALTER ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)}; END IF; END $role$`);
    statements.push(`ALTER ROLE ${identifier(role)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    statements.push(`GRANT CONNECT ON DATABASE ${database} TO ${identifier(role)}`);
    statements.push(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
    statements.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(role)}`);
    statements.push(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${identifier(role)}`);
  }
  statements.push(`GRANT CREATE ON SCHEMA public TO ${identifier(API_ROLE)}`);
  statements.push(`REVOKE CREATE ON SCHEMA public FROM ${identifier(WORKER_ROLE)}`);
  statements.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier(API_ROLE)}, ${identifier(WORKER_ROLE)}`);
  statements.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${identifier(API_ROLE)}, ${identifier(WORKER_ROLE)}`);
  statements.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(API_ROLE)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier(WORKER_ROLE)}`);
  statements.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(API_ROLE)} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${identifier(WORKER_ROLE)}`);
  statements.push(`ALTER ROLE ${identifier(API_ROLE)} SET statement_timeout = '10s'`);
  statements.push(`ALTER ROLE ${identifier(API_ROLE)} SET lock_timeout = '2s'`);
  statements.push(`ALTER ROLE ${identifier(WORKER_ROLE)} SET statement_timeout = '10s'`);
  statements.push(`ALTER ROLE ${identifier(WORKER_ROLE)} SET lock_timeout = '2s'`);
  return statements;
}

async function provision(config) {
  if (config.help) return { usage: 'npm run db:runtime-roles:provision -- [--execute --confirm-database <database>]', requiredEnvironment: ['MIGRATION_DATABASE_URL', 'RUNTIME_API_DATABASE_PASSWORD (execute)', 'RUNTIME_WORKER_DATABASE_PASSWORD (execute)'] };
  if (!config.execute) return { mode: 'dry-run', database: config.database, roles: [API_ROLE, WORKER_ROLE], ownershipTransfer: 'plugin tables and sequences to api', workerCreatePrivilege: false };
  const prisma = new PrismaClient({ datasources: { db: { url: config.adminUrl } } });
  try {
    return await prisma.$transaction(async (tx) => {
      for (const statement of roleStatements(config)) await tx.$executeRawUnsafe(statement);
      const relations = await tx.$queryRawUnsafe(`SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'plugin\\_%' ESCAPE '\\' ORDER BY tablename`);
      for (const row of relations) await tx.$executeRawUnsafe(`ALTER TABLE ${row.name} OWNER TO ${identifier(API_ROLE)}`);
      const sequences = await tx.$queryRawUnsafe(`SELECT format('%I.%I', sequence_schema, sequence_name) AS name FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name LIKE 'plugin\\_%' ESCAPE '\\' ORDER BY sequence_name`);
      for (const row of sequences) await tx.$executeRawUnsafe(`ALTER SEQUENCE ${row.name} OWNER TO ${identifier(API_ROLE)}`);
      await tx.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(WORKER_ROLE)}`);
      await tx.$executeRawUnsafe(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${identifier(WORKER_ROLE)}`);
      return { mode: 'executed', database: config.database, roles: [API_ROLE, WORKER_ROLE], pluginTablesTransferred: relations.length, pluginSequencesTransferred: sequences.length, workerCreatePrivilege: false };
    }, { timeout: 5 * 60_000, maxWait: 10_000 });
  } finally {
    await prisma.$disconnect();
  }
}

async function readCredentialsFromStdin(input = process.stdin) {
  let value = '';
  for await (const chunk of input) value += chunk;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('credential input must be a JSON object');
  return parsed;
}

async function main() {
  const argv = process.argv.slice(2);
  const supplied = argv.includes('--credentials-stdin') ? await readCredentialsFromStdin() : {};
  const result = await provision(configuration({ ...process.env, ...supplied }, argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

module.exports = { API_ROLE, WORKER_ROLE, configuration, provision, readCredentialsFromStdin, roleStatements };
