const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const PRISMA_MIGRATION_TABLE = '_prisma_migrations';

function extractCreatedTables(sql) {
  const tables = [];
  const createTable = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"([^"]+)"/gi;
  let match;
  while ((match = createTable.exec(sql)) !== null) tables.push(match[1]);
  return tables;
}

function expectedCoreTables(migrationsDirectory) {
  const expected = new Set([PRISMA_MIGRATION_TABLE]);
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const migrationPath = path.join(migrationsDirectory, entry.name, 'migration.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    for (const table of extractCreatedTables(sql)) expected.add(table);
  }
  return [...expected].sort();
}

function compareTables(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    unexpected: [...actualSet].filter((table) => !expectedSet.has(table)).sort(),
    missing: [...expectedSet].filter((table) => !actualSet.has(table)).sort(),
  };
}

async function verifyFreshCoreDatabase({ prisma, migrationsDirectory }) {
  const expected = expectedCoreTables(migrationsDirectory);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const actual = rows.map((row) => row.tablename);
  const result = compareTables(expected, actual);
  if (result.unexpected.length || result.missing.length) {
    const details = [];
    if (result.unexpected.length) details.push(`unexpected tables: ${result.unexpected.join(', ')}`);
    if (result.missing.length) details.push(`missing tables: ${result.missing.join(', ')}`);
    throw new Error(`Fresh core database schema is not canonical (${details.join('; ')})`);
  }
  return { expected, actual };
}

async function main() {
  if ((process.env.WATTANAM_DISTRIBUTION || '').trim().toLowerCase() !== 'core') {
    throw new Error('WATTANAM_DISTRIBUTION=core is required; this verifier must not run against a plugin-bearing or legacy database');
  }
  const { PrismaClient } = require('../generated/core-client');
  const prisma = new PrismaClient();
  try {
    const result = await verifyFreshCoreDatabase({
      prisma,
      migrationsDirectory: path.resolve(__dirname, '..', 'prisma', 'core', 'migrations'),
    });
    console.log(`Fresh core database schema verified: ${result.actual.length} canonical tables, 0 unexpected tables.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  PRISMA_MIGRATION_TABLE,
  compareTables,
  expectedCoreTables,
  extractCreatedTables,
  verifyFreshCoreDatabase,
};
