'use strict';

// Read-only inventory and fingerprint for the complete student school-day Attendance boundary.
// Output contains aggregate counts and hashes only; names, identifiers and attendance rows are never printed.
const crypto = require('node:crypto');

const DATASETS = Object.freeze([
  { name: 'studyYears', target: 'plugin_wattanam_attendance_manager_study_year' },
  { name: 'sessions', target: 'plugin_wattanam_attendance_manager_session' },
  { name: 'holidays', target: 'plugin_wattanam_attendance_manager_holiday' },
  { name: 'identifiers', target: 'plugin_wattanam_attendance_manager_identifier' },
  { name: 'formatRules', target: 'plugin_wattanam_attendance_manager_format_rule' },
  { name: 'records', target: 'plugin_wattanam_attendance_manager_record' },
]);

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value ?? null;
}

const INVALID_DATE = '__INVALID_DATE__';
function isoDate(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : INVALID_DATE;
}
function isoDateTime(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : INVALID_DATE;
}
function normalize(dataset, row) {
  if (dataset === 'studyYears') return { id: row.id, year: Number(row.year), label: row.label ?? null, startDate: isoDateTime(row.startDate), endDate: isoDateTime(row.endDate), isCurrent: Boolean(row.isCurrent), schoolName: row.schoolName ?? null, logoUrl: row.logoUrl ?? null, createdAt: isoDateTime(row.createdAt), updatedAt: isoDateTime(row.updatedAt) };
  if (dataset === 'sessions') return { id: row.id, scope: 'CLASS', classId: row.classId || null, session: Number(row.session), type: row.type, startTime: row.startTime, endTime: row.endTime, createdAt: isoDateTime(row.createdAt), updatedAt: isoDateTime(row.updatedAt) };
  if (dataset === 'holidays') return { id: row.id, date: isoDate(row.date), name: row.name, description: row.description ?? null, type: row.type || 'HOLIDAY', createdById: row.createdById, createdAt: isoDateTime(row.createdAt), updatedAt: isoDateTime(row.updatedAt) };
  if (dataset === 'identifiers') return { id: row.id, qrValue: row.qrValue ?? row.code, studentId: row.studentId ?? row.personId, createdById: row.createdById ?? null, createdAt: isoDateTime(row.createdAt), updatedAt: isoDateTime(row.updatedAt ?? row.createdAt), active: row.active !== false };
  if (dataset === 'formatRules') return { id: row.id, scope: 'CLASS', organizationId: row.organizationId || null, permissionsPerAbsent: Number(row.permissionsPerAbsent), latesPerAbsentHalf: Number(row.latesPerAbsentHalf), absentSessionsForDayAbsent: Number(row.absentSessionsForDayAbsent), caseStudyABEnabled: row.caseStudyABEnabled !== false, enabled: Boolean(row.enabled), createdAt: isoDateTime(row.createdAt), updatedAt: isoDateTime(row.updatedAt) };
  if (dataset === 'records') return { id: row.id, studentId: row.studentId ?? row.personId, classId: row.classId, studyYearId: row.studyYearId ?? row.class?.studyYearId ?? null, date: isoDate(row.date), session: Number(row.session), status: String(row.status).toUpperCase(), permissionType: row.permissionType ?? null, permissionStartDate: isoDate(row.permissionStartDate), permissionEndDate: isoDate(row.permissionEndDate), checkInTime: isoDateTime(row.checkInTime), checkOutTime: isoDateTime(row.checkOutTime), markedById: row.markedById, scanMode: row.scanMode ?? 'MANUAL', scanLatitude: row.scanLatitude ?? null, scanLongitude: row.scanLongitude ?? null, scanLocation: row.scanLocation ?? null, personNameSnapshot: row.personNameSnapshot ?? row.student?.user?.name ?? null, personNumberSnapshot: row.personNumberSnapshot ?? row.student?.studentNumber ?? null, classNameSnapshot: row.classNameSnapshot ?? row.class?.name ?? null, studyYearLabelSnapshot: row.studyYearLabelSnapshot ?? row.class?.studyYear?.label ?? (row.class?.studyYear?.year == null ? null : String(row.class.studyYear.year)), createdAt: isoDateTime(row.createdAt ?? row.timestamp), updatedAt: isoDateTime(row.updatedAt ?? row.timestamp) };
  throw new Error(`unknown Attendance adoption dataset: ${dataset}`);
}

function validateRow(dataset, row, blockers, context) {
  if (typeof row.id !== 'string' || !row.id) blockers.push(`${dataset}: invalid id`);
  if (dataset === 'studyYears') {
    if (!Number.isInteger(row.year)) blockers.push('studyYears: invalid year');
    if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) blockers.push('studyYears: invalid audit timestamps');
    if (row.startDate === INVALID_DATE || row.endDate === INVALID_DATE) blockers.push('studyYears: invalid date range');
    if (row.startDate && row.endDate && row.endDate < row.startDate) blockers.push('studyYears: end date precedes start date');
    if (row.id) context.studyYearIds.add(row.id);
  }
  if (dataset === 'sessions') {
    if (!row.startTime || !row.endTime) blockers.push('sessions: missing time window');
    if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) blockers.push('sessions: invalid audit timestamps');
  }
  if (dataset === 'holidays') {
    if (!row.date || row.date === INVALID_DATE || !row.name || !row.createdById) blockers.push('holidays: missing or invalid required value');
    if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) blockers.push('holidays: invalid audit timestamps');
  }
  if (dataset === 'identifiers') {
    if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) blockers.push('identifiers: invalid audit timestamps');
  }
  if (dataset === 'formatRules') {
    if (![row.permissionsPerAbsent, row.latesPerAbsentHalf].every((value) => Number.isInteger(value) && value > 0) || !Number.isInteger(row.absentSessionsForDayAbsent) || row.absentSessionsForDayAbsent < 0) blockers.push('formatRules: invalid thresholds');
    if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) blockers.push('formatRules: invalid audit timestamps');
  }
  if (dataset === 'records') {
    if (!['PRESENT', 'LATE', 'ABSENT', 'PERMISSION'].includes(String(row.status).toUpperCase())) blockers.push('records: unsupported status');
    if (!Number.isInteger(Number(row.session)) || Number(row.session) < 1 || Number(row.session) > 4) blockers.push('records: session outside 1..4');
    if (!row.studentId || !row.classId || !row.markedById) blockers.push('records: missing required relationship');
    if (!row.date || row.date === INVALID_DATE) blockers.push('records: invalid attendance date');
    if (row.studyYearId && !context.studyYearIds.has(row.studyYearId)) blockers.push('records: unknown Study Year relationship');
    if (row.scanMode != null && !['CAMERA', 'USB', 'MANUAL'].includes(row.scanMode)) blockers.push('records: unsupported scan mode');
    if ([row.checkInTime, row.checkOutTime, row.createdAt, row.updatedAt].includes(INVALID_DATE) || !row.createdAt || !row.updatedAt) blockers.push('records: invalid audit or scan timestamp');
    const start = row.permissionStartDate && row.permissionStartDate !== INVALID_DATE ? new Date(row.permissionStartDate) : null; const end = row.permissionEndDate && row.permissionEndDate !== INVALID_DATE ? new Date(row.permissionEndDate) : null;
    if (row.permissionStartDate === INVALID_DATE || row.permissionEndDate === INVALID_DATE) blockers.push('records: invalid permission date range');
    if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && end < start)) blockers.push('records: invalid permission date range');
  }
  if (dataset === 'sessions' && (!Number.isInteger(Number(row.session)) || Number(row.session) < 1 || Number(row.session) > 4 || !['CHECK_IN', 'CHECK_OUT'].includes(row.type))) blockers.push('sessions: invalid session/type');
  if (dataset === 'identifiers' && (!row.qrValue || !row.studentId)) blockers.push('identifiers: missing code/student');
}

async function fingerprint(readSourceChunk, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');
  const blockers = []; const source = {}; const context = { studyYearIds: new Set() };
  for (const dataset of DATASETS) {
    const hash = crypto.createHash('sha256'); let count = 0; let cursor = null; let previous = null;
    while (true) {
      const rows = await readSourceChunk(dataset.name, { after: cursor, limit: batchSize });
      if (!Array.isArray(rows) || rows.length > batchSize) throw new Error(`${dataset.name} adapter returned an invalid chunk`);
      if (!rows.length) break;
      for (const row of rows) {
        if (previous !== null && String(row.id) <= previous) throw new Error(`${dataset.name} rows must have strictly increasing IDs`);
        const normalized = normalize(dataset.name, row); validateRow(dataset.name, normalized, blockers, context); previous = String(row.id); count++; hash.update(`${JSON.stringify(canonical(normalized))}\n`);
      }
      cursor = String(rows.at(-1).id);
    }
    source[dataset.name] = { count, sha256: hash.digest('hex') };
  }
  return { blockers: [...new Set(blockers)], datasets: source, sha256: crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex') };
}

async function inspect(adapter, options = {}) {
  const fingerprinted = await fingerprint(adapter.readSourceChunk, options);
  const blockers = [...fingerprinted.blockers]; const target = {};
  for (const dataset of DATASETS) {
    const state = await adapter.targetState(dataset.target);
    if (!state || state.table !== dataset.target || typeof state.exists !== 'boolean') throw new Error(`${dataset.name} target state is invalid`);
    target[dataset.name] = state;
    if (!state.exists) blockers.push(`${dataset.name}: target table ${dataset.target} is absent; install Attendance Manager 0.1.6 first`);
    if (state.exists && Number(state.rowCount) > 0) blockers.push(`${dataset.name}: target table is not empty`);
  }
  return { format: 'wattanam-attendance-adoption-preflight-v1', readOnly: true, ready: blockers.length === 0, blockers: [...new Set(blockers)], source: { datasets: fingerprinted.datasets, sha256: fingerprinted.sha256 }, target, exclusions: ['staff attendance', 'staff sessions and format rules', 'teacher lesson attendance', 'course attendance'], nextStep: 'Create a school-bound recovery backup, then run the guarded Attendance adoption dry-run with this fingerprint' };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  const readers = {
    studyYears: ({ after, limit }) => prisma.studyYear.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    sessions: ({ after, limit }) => prisma.sessionConfig.findMany({ where: { scope: 'CLASS' }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    holidays: ({ after, limit }) => prisma.holiday.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    identifiers: ({ after, limit }) => prisma.cardAlias.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    formatRules: ({ after, limit }) => prisma.attendanceFormatRule.findMany({ where: { scope: 'CLASS' }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    records: ({ after, limit }) => prisma.attendance.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, include: { student: { include: { user: true } }, class: { include: { studyYear: true } } } }),
  };
  try {
    const report = await inspect({
      readSourceChunk: (name, options) => readers[name](options),
      targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Attendance adoption preflight failed: ${error.message}\n`); process.exitCode = 1; });

module.exports = { DATASETS, canonical, fingerprint, inspect, normalize };
