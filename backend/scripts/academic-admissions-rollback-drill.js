'use strict';

// Controlled rollback drill for admissions compatibility routing. Does not delete
// source or target rows; only flips route ownership metadata and journals the drill.
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('./academic-admissions-adoption-preflight');
const { journalPath } = require('./academic-admissions-adopt');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');

function parseInput(env) {
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) {
    throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  }
  if (env.ACADEMIC_ADMISSIONS_ROLLBACK_DRILL !== 'true') {
    throw new Error('ACADEMIC_ADMISSIONS_ROLLBACK_DRILL=true is required');
  }
  return { slug };
}

function routingRegistry(owner = process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER) {
  const value = String(owner || 'legacy').trim().toLowerCase();
  if (value !== 'legacy' && value !== 'plugin') {
    throw new Error('ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER must be legacy or plugin');
  }
  return {
    routeOwner: value,
    pluginEnabled: value === 'plugin',
  };
}

async function drill({ adapter, directory, backupName, slug, registry = routingRegistry() }) {
  const backup = verifyRecoveryBackup(directory, backupName, slug);
  const preflight = await inspect(adapter);
  const blockers = preflight.blockers.filter((item) => !item.endsWith('is not empty'));
  if (blockers.length > 0) {
    throw new Error(`admissions rollback drill is blocked: ${blockers.join('; ')}`);
  }

  const identity = `academic-admissions:${slug}:${preflight.source.sha256}:${backup.sha256}`;
  const file = journalPath(directory, slug);
  if (!fs.existsSync(file)) throw new Error('admissions adoption journal is absent');
  const journal = loadJournal(file, identity);
  if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
    throw new Error('admissions journal is not reconciled against the verified backup');
  }

  const rolled = rollbackRouting({
    journalFile: file,
    registry,
    identity,
    legacyOwner: 'legacy',
  });

  return {
    format: 'wattanam-academic-admissions-rollback-drill-v1',
    rolledBack: rolled.stage === 'rolled_back',
    schoolSlug: slug,
    source: preflight.source,
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    registry,
    journal: { stage: rolled.stage, rolledBackAt: rolled.rolledBackAt },
    warning: 'Rollback drill updates only routing metadata and journal state; datasets are preserved',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('absolute BACKUP_DIR is required');
  const { slug } = parseInput(process.env);

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await drill({
      adapter: {
        readRegistrationChunk: ({ after, limit }) => prisma.classRegistration.findMany({
          ...(after ? { cursor: { id: after }, skip: 1 } : {}),
          orderBy: { id: 'asc' },
          take: limit,
          select: {
            id: true,
            classId: true,
            nameKh: true,
            nameEn: true,
            email: true,
            phone: true,
            passwordHash: true,
            generatedPassword: true,
            photo: true,
            sex: true,
            dateOfBirth: true,
            address: true,
            generation: true,
            customFieldValues: true,
            status: true,
            rejectReason: true,
            studentId: true,
            createdAt: true,
            resolvedAt: true,
            resolvedBy: true,
          },
        }),
        readSettingsSingleton: () => prisma.classRegistrationSettings.findUnique({
          where: { id: 'singleton' },
          select: {
            id: true,
            khmerNameMode: true,
            phoneMode: true,
            emailMode: true,
            photoMode: true,
            passwordMode: true,
            sexMode: true,
            dateOfBirthMode: true,
            addressMode: true,
            generationMode: true,
            updatedAt: true,
          },
        }),
        readFieldChunk: ({ after, limit }) => prisma.classRegistrationField.findMany({
          ...(after ? { cursor: { id: after }, skip: 1 } : {}),
          orderBy: { id: 'asc' },
          take: limit,
          select: {
            id: true,
            key: true,
            label: true,
            fieldType: true,
            options: true,
            required: true,
            order: true,
            enabled: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        targetState: async (table) => {
          const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
          const exists = found[0]?.exists === true;
          const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
          return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
        },
      },
      directory,
      backupName: process.env.ACADEMIC_BACKUP_FILE,
      slug,
      registry: routingRegistry(),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Academic admissions rollback drill failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { drill, parseInput, routingRegistry };
