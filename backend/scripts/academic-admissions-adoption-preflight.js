'use strict';

// Read-only prerequisite for moving legacy admissions rows into Academic Management
// namespaced tables. Report includes deterministic hashes/counts and target blockers only.
const crypto = require('node:crypto');

const TARGET_TABLES = [
  'plugin_wattanam_academic_management_class_registration',
  'plugin_wattanam_academic_management_class_registration_settings',
  'plugin_wattanam_academic_management_class_registration_field',
];

const FIELD_TYPES = new Set(['TEXT', 'SELECT', 'MULTI_SELECT']);
const FIELD_MODES = new Set(['REQUIRED', 'OPTIONAL', 'HIDDEN']);

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
  return sorted;
}

function normalizeRegistration(row) {
  return [
    row.id,
    row.classId,
    row.nameKh ?? null,
    row.nameEn,
    row.email ?? null,
    row.phone ?? null,
    row.passwordHash,
    row.generatedPassword ?? null,
    row.photo ?? null,
    row.sex ?? null,
    toIso(row.dateOfBirth),
    row.address ?? null,
    row.generation ?? null,
    canonicalize(row.customFieldValues ?? null),
    row.status,
    row.rejectReason ?? null,
    row.studentId ?? null,
    toIso(row.createdAt),
    toIso(row.resolvedAt),
    row.resolvedBy ?? null,
  ];
}

function normalizeSettings(row) {
  return [
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
    toIso(row.updatedAt),
  ];
}

function normalizeField(row) {
  return [
    row.id,
    row.key,
    row.label,
    row.fieldType,
    canonicalize(row.options ?? null),
    Boolean(row.required),
    Number(row.order),
    Boolean(row.enabled),
    toIso(row.createdAt),
    toIso(row.updatedAt),
  ];
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('batchSize must be 1..1000');
  }

  const hash = crypto.createHash('sha256');
  const blockers = [];

  let registrationCount = 0;
  let registrationCursor = null;
  let previousRegistrationId = null;
  const statusCounts = { pending: 0, approved: 0, rejected: 0, other: 0 };

  while (true) {
    const rows = await adapter.readRegistrationChunk({ after: registrationCursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('registration adapter returned an invalid chunk');
    if (!rows.length) break;

    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousRegistrationId !== null && row.id <= previousRegistrationId)) {
        throw new Error('registration rows must have strictly increasing IDs');
      }
      if (typeof row.classId !== 'string' || !row.classId) throw new Error(`registration ${row.id} has no classId`);
      if (typeof row.nameEn !== 'string' || !row.nameEn.trim()) throw new Error(`registration ${row.id} has no English name`);
      if (typeof row.passwordHash !== 'string' || !row.passwordHash) throw new Error(`registration ${row.id} has no password hash`);
      previousRegistrationId = row.id;
      registrationCount++;
      const status = String(row.status || '').toUpperCase();
      if (status === 'PENDING') statusCounts.pending++;
      else if (status === 'APPROVED') statusCounts.approved++;
      else if (status === 'REJECTED') statusCounts.rejected++;
      else statusCounts.other++;
      hash.update(`${JSON.stringify(normalizeRegistration(row))}\n`);
    }

    registrationCursor = rows.at(-1).id;
  }

  const settings = await adapter.readSettingsSingleton();
  let settingsPresent = false;
  if (!settings) {
    blockers.push('legacy class-registration settings singleton is missing');
  } else {
    settingsPresent = true;
    if (settings.id !== 'singleton') {
      throw new Error('settings singleton id must be "singleton"');
    }
    for (const key of ['khmerNameMode', 'phoneMode', 'emailMode', 'photoMode', 'passwordMode', 'sexMode', 'dateOfBirthMode', 'addressMode', 'generationMode']) {
      if (!FIELD_MODES.has(String(settings[key]))) {
        throw new Error(`settings ${key} must be one of REQUIRED, OPTIONAL, HIDDEN`);
      }
    }
    if (settings.phoneMode === 'HIDDEN' && settings.emailMode === 'HIDDEN') {
      blockers.push('legacy settings hide both phone and email; admissions account creation would be impossible');
    }
    hash.update(`${JSON.stringify(normalizeSettings(settings))}\n`);
  }

  let fieldCount = 0;
  let fieldCursor = null;
  let previousFieldId = null;
  while (true) {
    const rows = await adapter.readFieldChunk({ after: fieldCursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('field adapter returned an invalid chunk');
    if (!rows.length) break;

    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousFieldId !== null && row.id <= previousFieldId)) {
        throw new Error('field rows must have strictly increasing IDs');
      }
      if (typeof row.key !== 'string' || !row.key.trim()) throw new Error(`field ${row.id} has no key`);
      if (typeof row.label !== 'string' || !row.label.trim()) throw new Error(`field ${row.id} has no label`);
      if (!FIELD_TYPES.has(String(row.fieldType))) throw new Error(`field ${row.id} has invalid fieldType`);
      previousFieldId = row.id;
      fieldCount++;
      hash.update(`${JSON.stringify(normalizeField(row))}\n`);
    }

    fieldCursor = rows.at(-1).id;
  }

  const target = [];
  for (const table of TARGET_TABLES) {
    const state = await adapter.targetState(table);
    if (!state || state.table !== table || typeof state.exists !== 'boolean') {
      throw new Error(`target adapter returned invalid state for ${table}`);
    }
    if (!state.exists) blockers.push(`target table ${table} is absent; install the signed plugin first`);
    if (state.exists && Number(state.rowCount) > 0) blockers.push(`target table ${table} is not empty`);
    target.push(state);
  }

  return {
    format: 'wattanam-academic-admissions-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: {
      registrationCount,
      fieldCount,
      settingsPresent,
      statusCounts,
      sha256: hash.digest('hex'),
    },
    target,
    nextStep: 'Create a school-bound recovery backup, then run guarded admissions dry-run/adoption with this fingerprint',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const report = await inspect({
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
        const existsRows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
        const exists = existsRows[0]?.exists === true;
        const countRows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
        return { table, exists, rowCount: exists ? Number(countRows[0]?.count || 0) : 0 };
      },
    });

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Academic admissions preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { inspect, TARGET_TABLES, canonicalize };
