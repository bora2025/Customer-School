'use strict';

// Additive-only admissions copy. Legacy admissions rows/routes remain authoritative
// until a separately approved cutover; this script never mutates legacy rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect, TARGET_TABLES } = require('./academic-admissions-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, enterMaintenance, leaveMaintenance, loadJournal } = require('./plugin-adoption-toolkit');

const [REGISTRATION_TABLE, SETTINGS_TABLE, FIELD_TABLE] = TARGET_TABLES;

function parseConfirmation(env) {
  if (env.ACADEMIC_ADMISSIONS_NON_INTERACTIVE !== 'true') {
    throw new Error('ACADEMIC_ADMISSIONS_NON_INTERACTIVE=true is required');
  }
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) {
    throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  }
  if (env.ACADEMIC_CONFIRM_SLUG !== slug) {
    throw new Error('ACADEMIC_CONFIRM_SLUG must exactly match the school slug');
  }
  if (!/^[a-f0-9]{64}$/.test(env.ACADEMIC_ADMISSIONS_SOURCE_SHA256 || '')) {
    throw new Error('ACADEMIC_ADMISSIONS_SOURCE_SHA256 must match the preflight fingerprint');
  }
  return { slug, sourceSha256: env.ACADEMIC_ADMISSIONS_SOURCE_SHA256 };
}

function journalPath(directory, slug) {
  return path.join(path.resolve(directory), `academic-${slug}-admissions.journal.json`);
}

function chunkKey(identity, phase, rows) {
  return crypto.createHash('sha256').update(`${identity}:${phase}:${JSON.stringify(rows.map((row) => row.id))}`).digest('hex');
}

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) {
    blockers.push('source fingerprint changed after approval');
  }
  return {
    format: 'wattanam-academic-admissions-adoption-dry-run-v1',
    dryRun: true,
    zeroWriteGuarantee: true,
    ready: blockers.length === 0,
    blockers,
    schoolSlug: confirmation.slug,
    source: report.source,
    target: report.target,
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    plannedSteps: [
      'create backup-bound admissions adoption journal',
      'copy class registrations idempotently in bounded chunks',
      'copy singleton admissions settings row once',
      'copy admissions custom fields idempotently in bounded chunks',
      'verify legacy admissions source fingerprint remained unchanged',
      'reconcile exact source/target fingerprints and row counts',
      'leave legacy admissions storage and route ownership unchanged',
    ],
  };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const before = await inspect(adapter);
  const journalFile = journalPath(directory, confirmation.slug);
  const resumed = fs.existsSync(journalFile);
  const activeBlockers = resumed
    ? before.blockers.filter((blocker) => !blocker.endsWith('is not empty'))
    : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) {
    throw new Error('admissions preflight is blocked or fingerprint changed');
  }

  const maintenanceFile = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock');
  const identity = `academic-admissions:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;

  if (!resumed) {
    const targetCounts = await adapter.targetCounts();
    for (const table of TARGET_TABLES) {
      const count = Number(targetCounts?.[table]);
      if (!Number.isInteger(count) || count < 0) throw new Error(`admissions target count is invalid for ${table}`);
      if (count !== 0) throw new Error('admissions target tables must be empty without a matching journal');
    }
    atomicJson(journalFile, {
      format: 'wattanam-plugin-adoption-v1',
      identity,
      stage: 'prepared',
      phase: 'registrations',
      registrationCursor: null,
      fieldCursor: null,
      settingsCopied: false,
      processed: { registrations: 0, fields: 0, settings: 0 },
      chunks: [],
      backupSha256: backup.sha256,
    });
  } else {
    const existing = loadJournal(journalFile, identity);
    if (existing.backupSha256 !== backup.sha256) throw new Error('admissions adoption journal backup mismatch');
  }

  let journal = loadJournal(journalFile, identity);
  enterMaintenance(maintenanceFile, identity);
  try {
    while (journal.stage !== 'backfilled') {
      if (journal.phase === 'registrations') {
        const rows = await adapter.readRegistrationSourceChunk({ after: journal.registrationCursor, limit: chunkSize });
        if (!Array.isArray(rows) || rows.length > chunkSize) throw new Error('registration source adapter returned an invalid chunk');
        if (!rows.length) {
          journal = { ...journal, phase: 'settings', updatedAt: new Date().toISOString() };
          atomicJson(journalFile, journal);
          continue;
        }
        const idempotencyKey = chunkKey(identity, 'registrations', rows);
        await adapter.writeRegistrationTargetChunk(rows, { idempotencyKey });
        journal = {
          ...journal,
          stage: 'backfilling',
          registrationCursor: rows.at(-1).id,
          processed: { ...journal.processed, registrations: journal.processed.registrations + rows.length },
          chunks: journal.chunks.includes(idempotencyKey) ? journal.chunks : [...journal.chunks, idempotencyKey],
          updatedAt: new Date().toISOString(),
        };
        atomicJson(journalFile, journal);
        continue;
      }

      if (journal.phase === 'settings') {
        if (!journal.settingsCopied) {
          const row = await adapter.readSettingsSingleton();
          if (!row) throw new Error('legacy class-registration settings singleton is missing');
          const idempotencyKey = chunkKey(identity, 'settings', [{ id: row.id }]);
          await adapter.writeSettingsTarget(row, { idempotencyKey });
          journal = {
            ...journal,
            stage: 'backfilling',
            settingsCopied: true,
            processed: { ...journal.processed, settings: 1 },
            chunks: journal.chunks.includes(idempotencyKey) ? journal.chunks : [...journal.chunks, idempotencyKey],
            updatedAt: new Date().toISOString(),
          };
          atomicJson(journalFile, journal);
        }
        journal = { ...journal, phase: 'fields', updatedAt: new Date().toISOString() };
        atomicJson(journalFile, journal);
        continue;
      }

      if (journal.phase === 'fields') {
        const rows = await adapter.readFieldSourceChunk({ after: journal.fieldCursor, limit: chunkSize });
        if (!Array.isArray(rows) || rows.length > chunkSize) throw new Error('field source adapter returned an invalid chunk');
        if (!rows.length) {
          journal = {
            ...journal,
            stage: 'backfilled',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          atomicJson(journalFile, journal);
          continue;
        }
        const idempotencyKey = chunkKey(identity, 'fields', rows);
        await adapter.writeFieldTargetChunk(rows, { idempotencyKey });
        journal = {
          ...journal,
          stage: 'backfilling',
          fieldCursor: rows.at(-1).id,
          processed: { ...journal.processed, fields: journal.processed.fields + rows.length },
          chunks: journal.chunks.includes(idempotencyKey) ? journal.chunks : [...journal.chunks, idempotencyKey],
          updatedAt: new Date().toISOString(),
        };
        atomicJson(journalFile, journal);
        continue;
      }

      throw new Error(`unknown admissions backfill phase: ${journal.phase}`);
    }
  } finally {
    leaveMaintenance(maintenanceFile, identity);
  }

  const unchanged = await inspect({
    ...adapter,
    targetState: async (table) => ({ table, exists: true, rowCount: 0 }),
  });
  if (unchanged.source.sha256 !== before.source.sha256) {
    throw new Error('legacy admissions source changed during copy; do not cut over');
  }

  const target = await inspect({
    readRegistrationChunk: adapter.readRegistrationTargetChunk,
    readSettingsSingleton: adapter.readSettingsTargetSingleton,
    readFieldChunk: adapter.readFieldTargetChunk,
    targetState: async (table) => ({ table, exists: true, rowCount: 0 }),
  });

  if (!target.ready ||
      target.source.registrationCount !== before.source.registrationCount ||
      target.source.fieldCount !== before.source.fieldCount ||
      target.source.settingsPresent !== before.source.settingsPresent ||
      target.source.sha256 !== before.source.sha256) {
    throw new Error('admissions target reconciliation failed; legacy remains authoritative');
  }

  atomicJson(journalFile, {
    ...loadJournal(journalFile, identity),
    stage: 'reconciled',
    reconciledAt: new Date().toISOString(),
  });

  return {
    stage: 'reconciled',
    ...before.source,
    targetSha256: target.source.sha256,
    backupSha256: backup.sha256,
    journalFile,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  }
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const registrationSelect = {
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
  };

  const fieldSelect = {
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
  };

  const settingsSelect = {
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
  };

  const adapter = {
    readRegistrationChunk: ({ after, limit }) => prisma.classRegistration.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: limit,
      select: registrationSelect,
    }),
    readSettingsSingleton: () => prisma.classRegistrationSettings.findUnique({ where: { id: 'singleton' }, select: settingsSelect }),
    readFieldChunk: ({ after, limit }) => prisma.classRegistrationField.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: limit,
      select: fieldSelect,
    }),
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(count[0]?.count || 0) : 0 };
    },
    targetCounts: async () => {
      const entries = await Promise.all(TARGET_TABLES.map(async (table) => {
        const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`);
        return [table, Number(rows[0]?.count || 0)];
      }));
      return Object.fromEntries(entries);
    },

    readRegistrationSourceChunk: ({ after, limit }) => prisma.classRegistration.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: limit,
      select: registrationSelect,
    }),
    writeRegistrationTargetChunk: async (rows) => {
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${REGISTRATION_TABLE}" ("id","classId","nameKh","nameEn","email","phone","passwordHash","generatedPassword","photo","sex","dateOfBirth","address","generation","customFieldValues","status","rejectReason","studentId","createdAt","resolvedAt","resolvedBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20) ON CONFLICT ("id") DO NOTHING`,
          row.id,
          row.classId,
          row.nameKh,
          row.nameEn,
          row.email,
          row.phone,
          row.passwordHash,
          row.generatedPassword,
          row.photo,
          row.sex,
          row.dateOfBirth,
          row.address,
          row.generation,
          row.customFieldValues ? JSON.stringify(row.customFieldValues) : null,
          row.status,
          row.rejectReason,
          row.studentId,
          row.createdAt,
          row.resolvedAt,
          row.resolvedBy,
        );
      }
    },
    writeSettingsTarget: async (row) => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${SETTINGS_TABLE}" ("id","khmerNameMode","phoneMode","emailMode","photoMode","passwordMode","sexMode","dateOfBirthMode","addressMode","generationMode","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT ("id") DO NOTHING`,
        row.id,
        row.khmerNameMode,
        row.phoneMode,
        row.emailMode,
        row.photoMode,
        row.passwordMode,
        row.sexMode,
        row.dateOfBirthMode,
        row.addressMode,
        row.generationMode,
        row.updatedAt,
      );
    },
    readFieldSourceChunk: ({ after, limit }) => prisma.classRegistrationField.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: limit,
      select: fieldSelect,
    }),
    writeFieldTargetChunk: async (rows) => {
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${FIELD_TABLE}" ("id","key","label","fieldType","options","required","order","enabled","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) ON CONFLICT ("id") DO NOTHING`,
          row.id,
          row.key,
          row.label,
          row.fieldType,
          row.options ? JSON.stringify(row.options) : null,
          row.required,
          row.order,
          row.enabled,
          row.createdAt,
          row.updatedAt,
        );
      }
    },

    readRegistrationTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id","classId","nameKh","nameEn","email","phone","passwordHash","generatedPassword","photo","sex","dateOfBirth","address","generation","customFieldValues","status","rejectReason","studentId","createdAt","resolvedAt","resolvedBy" FROM "${REGISTRATION_TABLE}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`,
      after || '',
      limit,
    ),
    readSettingsTargetSingleton: () => prisma.$queryRawUnsafe(
      `SELECT "id","khmerNameMode","phoneMode","emailMode","photoMode","passwordMode","sexMode","dateOfBirthMode","addressMode","generationMode","updatedAt" FROM "${SETTINGS_TABLE}" WHERE "id" = 'singleton' LIMIT 1`,
    ).then((rows) => rows[0] ?? null),
    readFieldTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id","key","label","fieldType","options","required","order","enabled","createdAt","updatedAt" FROM "${FIELD_TABLE}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`,
      after || '',
      limit,
    ),
  };

  try {
    const result = process.argv.includes('--dry-run')
      ? await dryRun({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation })
      : await adopt({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.dryRun && !result.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Academic admissions adoption failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { adopt, dryRun, journalPath, parseConfirmation };
