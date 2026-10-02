'use strict';

// End-to-end existing-school rehearsal for the first dependency-independent plugin. This command
// creates and mutates only explicitly approved disposable databases. It proves the operational
// sequence from a legacy source backup through isolated restore, additive plugin adoption and
// routing rollback while preserving both datasets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLE } = require('./document-designer-adoption-preflight');
const { adopt, dryRun } = require('./document-designer-adopt');
const { convertAssets } = require('./document-designer-convert-assets');
const { drill } = require('./document-designer-rollback-drill');

const pluginRoot = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.document-designer');
const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
const pluginRuntime = require(path.join(pluginRoot, 'backend', 'index.js'));

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'document-designer-only') {
    throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=document-designer-only is required');
  }
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must differ');
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  for (const url of [source, target]) {
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  }
  const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-document-school';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('REHEARSAL_SCHOOL_SLUG is invalid');
  return { sourceUrl, targetUrl, targetDatabase, backupDir, slug };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-2000)}`);
  return String(result.stdout || '').trim();
}

function createEmptyTarget(targetUrl, database) {
  const environment = postgresEnvironment(targetUrl);
  const admin = { ...environment, PGDATABASE: 'postgres' };
  const exists = run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { env: admin });
  if (exists === '1') throw new Error(`rehearsal target database ${database} already exists; refusing to replace it`);
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin, stdio: ['ignore', 'pipe', 'pipe'] });
}

function adapter(prisma) {
  return {
    readSourceChunk: ({ after, limit }) => prisma.cardTemplate.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit,
      select: { id: true, name: true, cardType: true, design: true, createdAt: true, updatedAt: true },
    }),
    targetExists: async () => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`))[0]?.exists === true,
    targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${TARGET_TABLE}`))[0]?.count || 0),
    readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id", "name", "documentType", "design", "isActive", "createdAt", "updatedAt" FROM ${TARGET_TABLE} WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
    ),
    writeTargetChunk: async (rows) => {
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${TARGET_TABLE} ("id", "name", "documentType", "design", "isActive", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT ("id") DO NOTHING`,
          row.id, row.name, row.cardType, JSON.stringify(row.design), row.name === '__active__', row.createdAt, row.updatedAt,
        );
      }
    },
    grantPermissions: async (matrix) => {
      for (const [permissionId, roles] of Object.entries(matrix)) {
        for (const role of roles) {
          await prisma.pluginPermissionGrant.upsert({
            where: { pluginId_permissionId_role: { pluginId: pluginManifest.id, permissionId, role } },
            create: { pluginId: pluginManifest.id, permissionId, role }, update: {},
          });
        }
      }
    },
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', schoolName: 'Restored Document School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' },
    update: { schoolName: 'Restored Document School', schoolSlug: slug },
  });
  // A valid one-pixel PNG exercises the real backup/restore/adoption path for legacy designs that
  // embed browser-generated image data rather than referring to plugin-scoped storage.
  const embeddedPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const rows = [
    { id: 'rehearsal-template-active', name: '__active__', cardType: 'student', design: { cardType: 'student', width: 340, height: 215, backgroundColor: '#eef2ff', frameColor: '#4f46e5', frameWidth: 2, logos: [{ id: 'school-logo', name: 'School logo', src: embeddedPng, x: 12, y: 12, width: 60, height: 60, opacity: 0.8, borderRadius: 4, zIndex: 3 }] } },
    { id: 'rehearsal-template-general', name: 'General certificate', cardType: 'general', design: { cardType: 'general', width: 794, height: 1123, logos: [{ id: 'school-logo-copy', name: 'School logo', src: embeddedPng, x: 20, y: 20, width: 80, height: 80 }] } },
  ];
  for (const row of rows) await prisma.cardTemplate.upsert({ where: { id: row.id }, create: row, update: row });
}

async function applyPluginMigrations(prisma) {
  for (const migration of pluginManifest.migrations) {
    const sql = fs.readFileSync(path.join(pluginRoot, migration.path), 'utf8');
    await prisma.$executeRawUnsafe(sql);
  }
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');

  run(process.execPath, ['scripts/deploy-migrations.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' },
  });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }

  const beforeBackups = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-rehearsal' },
  });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !beforeBackups.has(name));
  if (!backupName) throw new Error('rehearsal backup was not created');

  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' },
  });

  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await applyPluginMigrations(restored);
    const migrationAdapter = adapter(restored);
    const preflight = await inspect(migrationAdapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; '));
    assert.equal(preflight.assets.uniqueCount, 1, 'embedded legacy assets were not content-deduplicated');
    assert.equal(preflight.assets.referenceCount, 2, 'embedded legacy asset references were not inventoried');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const targetBeforeDryRun = await migrationAdapter.targetCount();
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal(await migrationAdapter.targetCount(), targetBeforeDryRun, 'dry-run changed the target');
    const journalPath = path.join(config.backupDir, `document-designer-${config.slug}.journal.json`);
    assert.equal(fs.existsSync(journalPath), false, 'dry-run created an adoption journal');

    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.sourceSha256, adopted.targetSha256);
    const convertedStorage = new Map();
    const converted = await convertAssets({
      confirmation,
      backup: { schoolSlug: config.slug, sourceSha256: preflight.source.sha256, stage: 'reconciled' },
      sourceAdapter: migrationAdapter,
      adapter: {
        readTargetChunk: ({ after, limit }) => restored.$queryRawUnsafe(
          `SELECT "id", "design", "updatedAt" FROM ${TARGET_TABLE} WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
        ),
        putAsset: async (asset) => {
          const prior = convertedStorage.get(asset.sha256);
          if (prior && prior !== asset.bytes.toString('base64')) throw new Error(`asset collision for ${asset.sha256}`);
          convertedStorage.set(asset.sha256, asset.bytes.toString('base64'));
        },
        updateTargetDesign: async (row, design) => (await restored.$executeRawUnsafe(
          `UPDATE ${TARGET_TABLE} SET "design"=$1::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "updatedAt"=$3`,
          JSON.stringify(design), row.id, row.updatedAt,
        )) === 1,
      },
    });
    assert.equal(converted.uniqueAssets, 1);
    assert.equal(converted.references, 2);
    assert.equal(convertedStorage.size, 1);
    const routes = [];
    await pluginRuntime.activate({
      pluginId: pluginManifest.id,
      logger: { log: () => undefined },
      permissions: { register: () => () => undefined },
      navigation: { register: () => () => undefined },
      routes: { register: (route) => { routes.push(route); return () => undefined; } },
      database: {
        query: (sql, params = []) => restored.$queryRawUnsafe(sql, ...params),
        execute: async () => { throw new Error('render verification must not mutate the database'); },
      },
      storage: {}, directory: {}, readModels: {},
    });
    const generate = routes.find((route) => route.method === 'POST' && route.path === 'templates/:id/generate');
    assert.ok(generate, 'Document Designer generation route was not registered');
    const rendered = await generate.handler({
      params: { id: 'rehearsal-template-active' },
      body: { records: [{ id: 'render-record-1' }] },
    });
    assert.deepEqual(rendered.documents[0].page, { width: 340, height: 215, background: '#eef2ff', frameColor: '#4f46e5', frameWidth: 2, borderRadius: 12 });
    const renderedLogo = rendered.documents[0].elements.find((element) => element.id === 'school-logo');
    assert.match(renderedLogo?.assetId || '', /^[0-9a-f-]{36}$/, 'converted scoped asset was absent from rendered output');
    assert.deepEqual(
      { x: renderedLogo.x, y: renderedLogo.y, width: renderedLogo.width, height: renderedLogo.height, opacity: renderedLogo.opacity, borderRadius: renderedLogo.borderRadius, zIndex: renderedLogo.zIndex },
      { x: 12, y: 12, width: 60, height: 60, opacity: 0.8, borderRadius: 4, zIndex: 3 },
      'adopted legacy geometry/style changed in the plugin render model',
    );
    const rolled = await drill({ adapter: migrationAdapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);

    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy source changed during adoption or rollback');
    assert.equal(after.source.rowCount, preflight.source.rowCount);
    assert.deepEqual(after.assets, preflight.assets, 'legacy asset inventory changed during adoption or rollback');
    assert.equal(await migrationAdapter.targetCount(), preflight.source.rowCount, 'plugin data was lost during rollback');
    const permissions = Number((await restored.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "PluginPermissionGrant" WHERE "pluginId" = $1`, pluginManifest.id))[0]?.count || 0);
    assert.ok(permissions > 0, 'adoption did not grant plugin permissions');

    return {
      format: 'wattanam-existing-school-document-designer-rehearsal-v1', passed: true,
      sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase,
      schoolSlug: config.slug, backupFile: backupName, sourceRows: preflight.source.rowCount,
      sourceSha256: preflight.source.sha256, targetSha256: adopted.targetSha256,
      dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true,
      pluginDataPreserved: true, permissionGrants: permissions,
      renderedOutputVerified: true,
      legacyAssets: { unique: preflight.assets.uniqueCount, references: preflight.assets.referenceCount, bytes: preflight.assets.totalBytes, convertedToScopedStorage: converted.uniqueAssets, preserved: true },
    };
  } finally { await restored.$disconnect(); }
}

async function main() {
  const result = await certify();
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) {
    const output = process.argv[outIndex + 1];
    if (!output) throw new Error('--out requires a report path');
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Existing-school Document Designer rehearsal failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { adapter, applyPluginMigrations, certify, configuration, createEmptyTarget, seedLegacy };
