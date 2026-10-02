'use strict';

// Guarded, non-destructive rollback drill for legacy-derived canonical subjects. It verifies the
// adopted rows, switches routing back to legacy, and preserves both datasets for the rollback window.
const path = require('node:path');
const { collect, TARGET_TABLE } = require('./academic-subjects-adoption-preflight');
const { journalPath, parseConfirmation } = require('./academic-subjects-adopt');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');
const { verifyRecoveryBackup } = require('./document-designer-adopt');

function routingRegistry(owner = process.env.ACADEMIC_SUBJECTS_ROUTE_OWNER) {
  const value = String(owner || 'legacy').trim().toLowerCase();
  if (!['legacy', 'plugin'].includes(value)) throw new Error('ACADEMIC_SUBJECTS_ROUTE_OWNER must be legacy or plugin');
  return { routeOwner: value, pluginEnabled: value === 'plugin' };
}

async function rollback({ adapter, directory, backupName, confirmation, registry = routingRegistry() }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const source = await collect(adapter);
  if (source.sha256 !== confirmation.sourceSha256) throw new Error('legacy subject fingerprint changed; rollback refused');
  const identity = `academic-subjects:${confirmation.slug}:${source.sha256}:${backup.sha256}`;
  const journal = loadJournal(journalPath(directory, confirmation.slug), identity);
  if (journal.stage !== 'reconciled') throw new Error('a reconciled subject adoption journal is required');
  const ids = source.subjects.map((subject) => subject.id);
  const retained = await adapter.findSubjects(ids);
  if (retained.length !== ids.length) throw new Error('subject rollback requires every adopted row to remain present');
  const rolled = rollbackRouting({ journalFile: journalPath(directory, confirmation.slug), registry, identity, legacyOwner: 'legacy' });
  return {
    stage: 'rolled-back', rolledBack: rolled.stage === 'rolled_back', retained: ids.length,
    sourceSha256: source.sha256, backupSha256: backup.sha256, registry,
    legacyPreserved: true, pluginDataPreserved: true,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const adapter = {
    readClassSubjectChunk: ({ after, limit }) => prisma.class.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, subject: true } }),
    findSubjects: (ids) => ids.length ? prisma.$queryRawUnsafe(`SELECT "id" FROM "${TARGET_TABLE}" WHERE "id" = ANY($1::text[])`, ids) : Promise.resolve([]),
  };
  try { process.stdout.write(`${JSON.stringify(await rollback({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation, registry: routingRegistry() }), null, 2)}\n`); }
  finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Academic subject rollback failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { rollback, routingRegistry };
