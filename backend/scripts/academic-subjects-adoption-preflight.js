'use strict';

// Read-only inventory for adopting distinct legacy Class.subject values into the
// Academic Management canonical subject table. No source or target writes occur here.
const crypto = require('node:crypto');

const TARGET_TABLE = 'plugin_wattanam_academic_management_subject';

function canonicalSubject(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const digest = crypto.createHash('sha256').update(name.toLocaleLowerCase('en-US')).digest('hex');
  return {
    id: `legacy-subject-${digest.slice(0, 24)}`,
    code: `LEGACY_${digest.slice(0, 12).toUpperCase()}`,
    name,
    sourceKey: name.toLocaleLowerCase('en-US'),
  };
}

async function collect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');
  const byKey = new Map();
  let cursor = null;
  let previousId = null;
  let classCount = 0;
  while (true) {
    const rows = await adapter.readClassSubjectChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('subject adapter returned an invalid chunk');
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousId !== null && row.id <= previousId)) {
        throw new Error('class rows must have strictly increasing IDs');
      }
      previousId = row.id;
      classCount += 1;
      const subject = canonicalSubject(row.subject);
      if (subject && !byKey.has(subject.sourceKey)) byKey.set(subject.sourceKey, subject);
    }
    cursor = rows.at(-1).id;
  }
  const subjects = [...byKey.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  const sha256 = crypto.createHash('sha256')
    .update(subjects.map(({ id, code, name }) => JSON.stringify([id, code, name])).join('\n'))
    .digest('hex');
  return { classCount, subjectCount: subjects.length, sha256, subjects };
}

async function inspect(adapter, options) {
  const source = await collect(adapter, options);
  const target = await adapter.targetState(TARGET_TABLE);
  if (!target || target.table !== TARGET_TABLE || typeof target.exists !== 'boolean') throw new Error('target adapter returned invalid state');
  const blockers = [];
  if (!target.exists) blockers.push(`target table ${TARGET_TABLE} is absent; install Academic Management 0.1.4 or later first`);
  if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${TARGET_TABLE} is not empty`);
  return {
    format: 'wattanam-academic-subjects-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: { classCount: source.classCount, subjectCount: source.subjectCount, sha256: source.sha256 },
    target,
    subjects: source.subjects.map(({ sourceKey, ...subject }) => subject),
    nextStep: 'Create a school-bound recovery backup, then run guarded dry-run/adoption with this fingerprint',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await inspect({
      readClassSubjectChunk: ({ after, limit }) => prisma.class.findMany({
        ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit,
        select: { id: true, subject: true },
      }),
      targetState: async (table) => {
        const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
        const exists = found[0]?.exists === true;
        const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
        return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 };
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Academic subject preflight failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { TARGET_TABLE, canonicalSubject, collect, inspect };
