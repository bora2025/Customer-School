'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fingerprint, inspect } = require('./examination-adoption-preflight');
const { journalPath, productionAdapter } = require('./examination-adopt');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');

function parseInput(env) {
  const slug = env.EXAMINATION_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('EXAMINATION_SCHOOL_SLUG is invalid');
  if (env.EXAMINATION_ROLLBACK_DRILL !== 'true') throw new Error('EXAMINATION_ROLLBACK_DRILL=true is required');
  return { slug };
}
function routingRegistry(owner = process.env.EXAMINATION_ROUTE_OWNER) { const value = String(owner || 'legacy').trim().toLowerCase(); if (!['legacy','plugin'].includes(value)) throw new Error('EXAMINATION_ROUTE_OWNER must be legacy or plugin'); return { routeOwner: value, pluginEnabled: value === 'plugin' }; }
async function drill({ adapter, directory, backupName, slug, registry = routingRegistry() }) {
  const backup = verifyRecoveryBackup(directory, backupName, slug);
  const preflight = await inspect(adapter);
  const blockers = preflight.blockers.filter((item) => !item.endsWith('target table is not empty'));
  if (blockers.length) throw new Error(`Examination rollback drill is blocked: ${blockers.join('; ')}`);
  const target = await fingerprint(adapter.readTargetChunk);
  if (target.blockers.length || target.sha256 !== preflight.source.sha256) throw new Error('Examination rollback drill requires exactly reconciled source and target datasets');
  const identity = `examination:${slug}:${preflight.source.sha256}:${backup.sha256}`;
  const file = journalPath(directory, slug);
  if (!fs.existsSync(file)) throw new Error('Examination adoption journal is absent');
  const journal = loadJournal(file, identity);
  if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled' || journal.targetSha256 !== target.sha256) throw new Error('Examination journal is not reconciled against the verified backup and target');
  const rolled = rollbackRouting({ journalFile: file, registry, identity, legacyOwner: 'legacy' });
  return { format: 'wattanam-examination-rollback-drill-v1', rolledBack: rolled.stage === 'rolled_back', schoolSlug: slug, sourceSha256: preflight.source.sha256, targetSha256: target.sha256, backup: { file: path.basename(backup.archive), sha256: backup.sha256 }, registry, warning: 'Rollback changes routing metadata only; both legacy and plugin datasets remain preserved' };
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR is required');
  const { slug } = parseInput(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try { process.stdout.write(`${JSON.stringify(await drill({ adapter: productionAdapter(prisma), directory, backupName: process.env.EXAMINATION_BACKUP_FILE, slug, registry: routingRegistry() }), null, 2)}\n`); } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Examination rollback drill failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { drill, parseInput, routingRegistry };
