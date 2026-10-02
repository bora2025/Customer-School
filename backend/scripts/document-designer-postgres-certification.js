'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.document-designer');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const table = 'plugin_wattanam_document_designer_template';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.DOCUMENT_DESIGNER_CERTIFY_ALLOW_DROP !== 'document-designer-only') throw new Error('DOCUMENT_DESIGNER_CERTIFY_ALLOW_DROP=document-designer-only is required');
}
async function exists(prisma) { const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); return rows[0]?.exists === true; }
async function cleanup(prisma) { await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`); }
async function migrate(prisma) {
  const migration = manifest.migrations[0], sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
  if (crypto.createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('Document Designer migration checksum mismatch');
  if (!sql.includes(`wattanam-plugin-migration: ${migration.id}`)) throw new Error('Document Designer migration identity header is missing');
  await prisma.$executeRawUnsafe(sql);
}
function runtime(prisma) {
  const routes = new Map(), files = new Map();
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({ query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params), execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }), publish: async () => {} })),
  };
  const context = {
    logger: { log() {} }, permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } }, database,
    directory: { lookupUsers: async (ids) => ids.map((id) => ({ id, name: id, role: 'TEACHER' })) },
    readModels: { read: async () => [] },
    storage: {
      list: async (prefix = '') => [...files.keys()].filter((name) => name.startsWith(prefix)),
      readText: async (name) => files.get(name) ?? null, readBinary: async (name) => files.get(name) ?? null,
      writeText: async (name, value) => { files.set(name, value); }, writeBinary: async (name, value) => { files.set(name, value); },
      delete: async (name) => { files.delete(name); },
    },
  };
  return { context, routes, files };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma); assert.equal(await exists(prisma), true);
  const { context, routes, files } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const found = routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  const design = { page: { width: 856, height: 540, background: '#ffffff' }, elements: [{ id: 'name', type: 'text', x: 20, y: 20, width: 300, height: 40, binding: 'person.name' }] };
  const first = await route('POST', 'templates').handler({ body: { name: 'First card', documentType: 'student', design } });
  const second = await route('POST', 'templates').handler({ body: { name: 'Second card', documentType: 'student', design } });
  await Promise.all([first, second].map((entry) => route('PATCH', 'templates/:id/active').handler({ params: { id: entry.id } })));
  const active = await prisma.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "documentType"='student' AND "isActive"=TRUE`);
  assert.equal(active.length, 1, 'concurrent activation must preserve one active template per document type');
  const generated = await route('POST', 'templates/:id/generate').handler({ params: { id: active[0].id }, body: { records: [{ id: 'student-1', person: { name: 'Student One' } }] } });
  assert.equal(generated.documents[0].elements[0].value, 'Student One');
  assert.equal(JSON.stringify(generated).includes('__proto__'), false);

  const png = Buffer.from('certification-image').toString('base64');
  const asset = await route('POST', 'assets').handler({ body: { fileName: 'badge.png', mimeType: 'image/png', dataBase64: png } });
  const loaded = await route('GET', 'assets/:id').handler({ params: { id: asset.id } }); assert.equal(loaded.dataBase64, png);
  await route('DELETE', 'assets/:id').handler({ params: { id: asset.id } }); assert.equal(files.size, 0);
  await assert.rejects(() => route('POST', 'assets').handler({ body: { fileName: '../escape.png', mimeType: 'image/png', dataBase64: png } }), /fileName is invalid/);

  const result = { format: 'wattanam-document-designer-postgres-certification-v1', postgres: true, templates: 2, activeInvariant: true, assetLifecycle: true, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Document Designer PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard };
