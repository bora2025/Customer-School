'use strict';

const crypto = require('node:crypto');
const { exactMinor, exponentFor } = require('./legacy-money-minor');

const DATASETS = Object.freeze([
  { name: 'profiles', target: 'plugin_wattanam_human_resources_employee_profile' },
  { name: 'education', target: 'plugin_wattanam_human_resources_education' },
  { name: 'experience', target: 'plugin_wattanam_human_resources_work_experience' },
  { name: 'certifications', target: 'plugin_wattanam_human_resources_certification' },
  { name: 'salaries', target: 'plugin_wattanam_human_resources_salary' },
  { name: 'attendance', target: 'plugin_wattanam_human_resources_staff_attendance' },
]);
const INVALID_DATE = '__INVALID_DATE__';

function date(value, dateOnly = false) {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? (dateOnly ? parsed.toISOString().slice(0, 10) : parsed.toISOString())
    : INVALID_DATE;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function skills(value) {
  if (value == null) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return null;
}

function money(value, options, label, blockers) {
  const result = exactMinor(Number(value), options.currency, options.minorExponent);
  if (!result.ok) {
    blockers.push(`${label}: ${result.reason}`);
    return null;
  }
  return result.minor;
}

function normalize(name, row, options, blockers) {
  const common = { id: row.id, directoryUserId: row.userId };
  if (name === 'profiles') return { ...common, title: row.title ?? null, summary: row.summary ?? null, skills: skills(row.skills), updatedAt: date(row.updatedAt) };
  if (name === 'education') return { ...common, institution: row.institution, degree: row.degree ?? null, fieldOfStudy: row.fieldOfStudy ?? null, startYear: row.startYear ?? null, endYear: row.endYear ?? null, order: row.order ?? 0, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) };
  if (name === 'experience') return { ...common, title: row.title, employer: row.employer, startDate: date(row.startDate, true), endDate: date(row.endDate, true), description: row.description ?? null, order: row.order ?? 0, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) };
  if (name === 'certifications') return { ...common, name: row.name, issuer: row.issuer ?? null, issueDate: date(row.issueDate, true), order: row.order ?? 0, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) };
  if (name === 'salaries') {
    return { ...common, month: row.month, year: row.year, currency: options.currency,
      baseMinor: money(row.baseSalary, options, `salaries ${row.id} baseSalary`, blockers),
      allowancesMinor: money(row.allowances ?? 0, options, `salaries ${row.id} allowances`, blockers),
      deductionsMinor: money(row.deductions ?? 0, options, `salaries ${row.id} deductions`, blockers),
      netMinor: money(row.netSalary, options, `salaries ${row.id} netSalary`, blockers),
      status: row.isPaid ? 'PAID' : 'DRAFT', paidAt: row.isPaid ? date(row.paidAt) : null,
      notes: row.notes ?? null, createdByDirectoryUserId: row.createdById,
      approvedByDirectoryUserId: null, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) };
  }
  if (name === 'attendance') return { ...common, date: date(row.date, true), session: row.session ?? 1, status: row.status, permissionType: row.permissionType ?? null, permissionStartDate: date(row.permissionStartDate, true), permissionEndDate: date(row.permissionEndDate, true), checkInTime: date(row.checkInTime), checkOutTime: date(row.checkOutTime), markedByDirectoryUserId: row.markedById, scanLatitude: row.scanLatitude ?? null, scanLongitude: row.scanLongitude ?? null, scanLocation: row.scanLocation ?? null, createdAt: date(row.timestamp), updatedAt: date(row.timestamp) };
  throw new Error(`unknown Human Resources dataset: ${name}`);
}

function validate(name, row, blockers) {
  const add = (message) => blockers.push(`${name} ${row.id || '<unknown>'}: ${message}`);
  if (!row.id || !row.directoryUserId) add('identity is absent');
  for (const [key, value] of Object.entries(row)) if (value === INVALID_DATE) add(`invalid ${key}`);
  if (name === 'profiles' && row.skills === null) add('skills must be a string array');
  if (name === 'education' && (!row.institution || row.order < 0 || (row.startYear && row.endYear && row.endYear < row.startYear))) add('invalid education values');
  if (name === 'experience' && (!row.title || !row.employer || row.order < 0 || (row.startDate && row.endDate && row.endDate < row.startDate))) add('invalid work experience values');
  if (name === 'certifications' && (!row.name || row.order < 0)) add('invalid certification values');
  if (name === 'salaries') {
    const amounts = [row.baseMinor, row.allowancesMinor, row.deductionsMinor, row.netMinor];
    if (!Number.isInteger(row.month) || row.month < 1 || row.month > 12 || !Number.isInteger(row.year) || amounts.some((value) => value == null || value < 0)) add('invalid payroll period or amount');
    if (amounts.every((value) => value != null) && row.baseMinor + row.allowancesMinor - row.deductionsMinor !== row.netMinor) add('net salary does not reconcile exactly');
    if (!row.createdByDirectoryUserId) add('creator identity is absent');
    if (row.status === 'PAID' && !row.paidAt) add('paid legacy salary has no paidAt value');
  }
  if (name === 'attendance' && (!['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].includes(row.status) || !row.date || !row.markedByDirectoryUserId || row.session < 1)) add('invalid attendance values');
}

async function fingerprint(readChunk, options) {
  const currency = String(options.currency || '').toUpperCase();
  const minorExponent = exponentFor(currency, options.minorExponent);
  const batchSize = options.batchSize || 250;
  const blockers = [];
  const datasets = {};
  for (const dataset of DATASETS) {
    const hash = crypto.createHash('sha256');
    let count = 0; let cursor = null; let previous = null;
    while (true) {
      const rows = await readChunk(dataset.name, { after: cursor, limit: batchSize });
      if (!Array.isArray(rows) || rows.length > batchSize) throw new Error(`${dataset.name} adapter returned invalid chunk`);
      if (!rows.length) break;
      for (const source of rows) {
        if (previous !== null && String(source.id) <= previous) throw new Error(`${dataset.name} rows must have increasing IDs`);
        const row = normalize(dataset.name, source, { currency, minorExponent }, blockers);
        validate(dataset.name, row, blockers);
        previous = String(source.id); count += 1; hash.update(`${JSON.stringify(canonical(row))}\n`);
      }
      cursor = String(rows.at(-1).id);
    }
    datasets[dataset.name] = { count, sha256: hash.digest('hex') };
  }
  return { blockers: [...new Set(blockers)], currency, minorExponent, datasets, sha256: crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex') };
}

async function fingerprintNormalized(readChunk, options) {
  const currency = String(options.currency || '').toUpperCase();
  const minorExponent = exponentFor(currency, options.minorExponent);
  const batchSize = options.batchSize || 250; const blockers = []; const datasets = {};
  for (const dataset of DATASETS) {
    const hash = crypto.createHash('sha256'); let count = 0; let cursor = null; let previous = null;
    while (true) {
      const rows = await readChunk(dataset.name, { after: cursor, limit: batchSize });
      if (!Array.isArray(rows) || rows.length > batchSize) throw new Error(`${dataset.name} adapter returned invalid chunk`);
      if (!rows.length) break;
      for (const source of rows) {
        const row = normalizeTarget(dataset.name, source);
        if (previous !== null && String(row.id) <= previous) throw new Error(`${dataset.name} rows must have increasing IDs`);
        validate(dataset.name, row, blockers); previous = String(row.id); count += 1;
        hash.update(`${JSON.stringify(canonical(row))}\n`);
      }
      cursor = String(rows.at(-1).id);
    }
    datasets[dataset.name] = { count, sha256: hash.digest('hex') };
  }
  return { blockers: [...new Set(blockers)], currency, minorExponent, datasets, sha256: crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex') };
}

async function inspect(adapter, options) {
  const source = await fingerprint(adapter.readSourceChunk, options);
  const blockers = [...source.blockers]; const target = {};
  for (const dataset of DATASETS) {
    const state = await adapter.targetState(dataset.target); target[dataset.name] = state;
    if (!state?.exists) blockers.push(`${dataset.name}: target table is absent; install Human Resources 0.1.0 first`);
    if (state?.exists && Number(state.rowCount) > 0) blockers.push(`${dataset.name}: target table is not empty`);
  }
  return { format: 'wattanam-human-resources-adoption-preflight-v1', readOnly: true, ready: blockers.length === 0, blockers: [...new Set(blockers)], conversion: { policy: 'EXACT_ONLY', currency: source.currency, minorExponent: source.minorExponent }, source: { datasets: source.datasets, sha256: source.sha256 }, target, exclusions: ['employee names', 'profile summaries', 'work descriptions', 'salary notes', 'location labels'], provenanceWarnings: ['Legacy paid salary rows have no independent approver identity and require payroll approval before adoption.'], nextStep: 'Obtain payroll/privacy approval and create a verified school-bound backup' };
}

function normalizeTarget(name, row) {
  const result = { ...row };
  const dateOnly = name === 'experience' ? ['startDate', 'endDate'] : name === 'certifications' ? ['issueDate'] : name === 'attendance' ? ['date', 'permissionStartDate', 'permissionEndDate'] : [];
  const timestamps = name === 'profiles' ? ['updatedAt'] : ['education', 'experience', 'certifications'].includes(name) ? ['createdAt', 'updatedAt'] : name === 'salaries' ? ['paidAt', 'createdAt', 'updatedAt'] : name === 'attendance' ? ['checkInTime', 'checkOutTime', 'createdAt', 'updatedAt'] : [];
  for (const key of dateOnly) result[key] = date(result[key], true);
  for (const key of timestamps) result[key] = date(result[key]);
  return result;
}

function productionAdapter(prisma) {
  const models = { profiles: prisma.staffProfile, education: prisma.staffEducation, experience: prisma.staffWorkExperience, certifications: prisma.staffCertification, salaries: prisma.salary, attendance: prisma.staffAttendance };
  return { readSourceChunk: (name, { after, limit }) => models[name].findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }), targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; } };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  try { const report = await inspect(productionAdapter(prisma), { currency: process.env.HR_CURRENCY, minorExponent: process.env.HR_MINOR_EXPONENT == null ? undefined : Number(process.env.HR_MINOR_EXPONENT) }); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ready) process.exitCode = 2; }
  finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Human Resources adoption preflight failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { DATASETS, canonical, fingerprint, fingerprintNormalized, inspect, normalize, normalizeTarget, productionAdapter };
