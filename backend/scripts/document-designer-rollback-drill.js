'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLE } = require('./document-designer-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');

function parseInput(env) {
  const slug = env.DOCUMENT_DESIGNER_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('DOCUMENT_DESIGNER_SCHOOL_SLUG is invalid');
  if (env.DOCUMENT_DESIGNER_ROLLBACK_DRILL !== 'true') throw new Error('DOCUMENT_DESIGNER_ROLLBACK_DRILL=true is required');
  return { slug };
}

function routingRegistry(owner = process.env.DOCUMENT_DESIGNER_ROUTE_OWNER) {
  const routeOwner = String(owner || 'legacy').trim().toLowerCase();
  if (!['legacy', 'plugin'].includes(routeOwner)) throw new Error('DOCUMENT_DESIGNER_ROUTE_OWNER must be legacy or plugin');
  return { routeOwner, pluginEnabled: routeOwner === 'plugin' };
}

async function drill({ adapter, directory, backupName, slug, registry = routingRegistry() }) {
  const backup = verifyRecoveryBackup(directory, backupName, slug);
  const preflight = await inspect(adapter);
  const blockers = preflight.blockers.filter((item) => !item.includes('is not empty'));
  if (blockers.length) throw new Error(`document-designer rollback drill is blocked: ${blockers.join('; ')}`);
  const identity = `document-designer:${slug}:${preflight.source.sha256}:${backup.sha256}`;
  const journalFile = path.join(path.resolve(directory), `document-designer-${slug}.journal.json`);
  if (!fs.existsSync(journalFile)) throw new Error('document-designer adoption journal is absent');
  const journal = loadJournal(journalFile, identity);
  if (journal.stage !== 'reconciled' || journal.backupSha256 !== backup.sha256) throw new Error('document-designer journal is not reconciled against the verified backup');
  const rolled = rollbackRouting({ journalFile, registry, identity, legacyOwner: 'legacy' });
  return { format: 'wattanam-document-designer-rollback-drill-v1', rolledBack: true, schoolSlug: slug, registry, backup: { file: path.basename(backup.archive), sha256: backup.sha256 }, journal: { stage: rolled.stage, rolledBackAt: rolled.rolledBackAt }, warning: 'Both legacy and plugin template datasets are preserved' };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('absolute BACKUP_DIR is required');
  const { slug } = parseInput(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const result = await drill({ adapter: {
      readSourceChunk: ({ after, limit }) => prisma.cardTemplate.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, name: true, cardType: true, design: true, createdAt: true, updatedAt: true } }),
      targetExists: async () => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`))[0]?.exists === true,
      targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${TARGET_TABLE}`))[0]?.count || 0),
    }, directory, backupName: process.env.DOCUMENT_DESIGNER_BACKUP_FILE, slug, registry: routingRegistry() });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Document Designer rollback drill failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { drill, parseInput, routingRegistry };
