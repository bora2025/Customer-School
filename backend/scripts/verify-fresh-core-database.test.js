const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  compareTables,
  expectedCoreTables,
  extractCreatedTables,
  verifyFreshCoreDatabase,
} = require('./verify-fresh-core-database');

test('extracts quoted public tables from migration SQL', () => {
  assert.deepEqual(
    extractCreatedTables('CREATE TABLE "User" (); CREATE TABLE IF NOT EXISTS "public"."Installation" ();'),
    ['User', 'Installation'],
  );
});

test('derives the complete canonical table allowlist from core migrations', () => {
  const tables = expectedCoreTables(path.resolve(__dirname, '..', 'prisma', 'core', 'migrations'));
  assert.ok(tables.includes('_prisma_migrations'));
  assert.ok(tables.includes('_wattanam_schema_lineage'));
  assert.ok(tables.includes('Installation'));
  assert.ok(tables.includes('PluginReadModel'));
  assert.ok(tables.includes('PluginArtifactGeneration'));
  assert.equal(tables.includes('Attendance'), false);
  assert.equal(tables.includes('Timetable'), false);
});

test('reports both unexpected optional tables and missing core tables', () => {
  assert.deepEqual(compareTables(['Installation', 'User'], ['Attendance', 'User']), {
    unexpected: ['Attendance'],
    missing: ['Installation'],
  });
});

test('rejects a fresh database containing an optional business table', async () => {
  const prisma = {
    $queryRawUnsafe: async () => [
      ...expectedCoreTables(path.resolve(__dirname, '..', 'prisma', 'core', 'migrations')).map((tablename) => ({ tablename })),
      { tablename: 'Attendance' },
    ],
  };
  await assert.rejects(
    verifyFreshCoreDatabase({ prisma, migrationsDirectory: path.resolve(__dirname, '..', 'prisma', 'core', 'migrations') }),
    /unexpected tables: Attendance/,
  );
});
