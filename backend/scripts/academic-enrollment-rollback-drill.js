'use strict';

// Non-destructive rollback for Academic enrollment read ownership. Both legacy Student.classId and
// plugin interval rows are preserved; only routing metadata and the adoption journal are changed.
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('./academic-enrollment-adopt');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');

function parseInput(env) {
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  if (env.ACADEMIC_ENROLLMENT_ROLLBACK_DRILL !== 'true') throw new Error('ACADEMIC_ENROLLMENT_ROLLBACK_DRILL=true is required');
  return { slug };
}

function routingRegistry(owner = process.env.ACADEMIC_ROSTER_READ_OWNER) {
  const value = String(owner || 'legacy').trim().toLowerCase();
  if (!['legacy', 'plugin'].includes(value)) throw new Error('ACADEMIC_ROSTER_READ_OWNER must be legacy or plugin');
  return { routeOwner: value, pluginEnabled: value === 'plugin' };
}

function journalPath(directory, slug) {
  return path.join(path.resolve(directory), `academic-${slug}-enrollments.journal.json`);
}

async function drill({ adapter, directory, backupName, slug, registry = routingRegistry() }) {
  const backup = verifyRecoveryBackup(directory, backupName, slug);
  const preflight = await inspect(adapter);
  const blockers = preflight.blockers.filter((item) => !item.endsWith('is not empty'));
  if (blockers.length) throw new Error(`enrollment rollback drill is blocked: ${blockers.join('; ')}`);
  const identity = `academic-enrollment:${slug}:${preflight.source.sha256}:${backup.sha256}`;
  const file = journalPath(directory, slug);
  if (!fs.existsSync(file)) throw new Error('enrollment adoption journal is absent');
  const journal = loadJournal(file, identity);
  if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') throw new Error('enrollment journal is not reconciled against the verified backup');
  const rolled = rollbackRouting({ journalFile: file, registry, identity, legacyOwner: 'legacy' });
  return {
    format: 'wattanam-academic-enrollment-rollback-drill-v1', rolledBack: rolled.stage === 'rolled_back', schoolSlug: slug,
    source: preflight.source, backup: { file: path.basename(backup.archive), sha256: backup.sha256 }, registry,
    journal: { stage: rolled.stage, rolledBackAt: rolled.rolledBackAt },
    warning: 'Rollback updates routing metadata and journal state only; legacy and plugin enrollment data are preserved',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('absolute BACKUP_DIR is required');
  const { slug } = parseInput(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const sourceSelect = { id: true, classId: true, createdAt: true };
  try {
    const report = await drill({
      adapter: {
        readAllSource: () => prisma.student.findMany({ where: { classId: { not: null } }, orderBy: { id: 'asc' }, select: sourceSelect }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
        targetState: async () => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.plugin_wattanam_academic_management_enrollment_interval') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "plugin_wattanam_academic_management_enrollment_interval"`) : []; return { table: 'plugin_wattanam_academic_management_enrollment_interval', exists, rowCount: Number(counts[0]?.count || 0) }; },
      }, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, slug, registry: routingRegistry(),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Academic enrollment rollback drill failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { drill, journalPath, parseInput, routingRegistry };

