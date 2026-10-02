'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DATASETS, fingerprint, inspect, normalize } = require('./attendance-manager-adoption-preflight');
const { journalPath } = require('./attendance-manager-adopt');
const { drill, parseInput, routingRegistry } = require('./attendance-manager-rollback-drill');
const { atomicJson } = require('./plugin-adoption-toolkit');

test('rollback requires explicit guard and valid owner', () => {
  assert.throws(() => parseInput({ ATTENDANCE_SCHOOL_SLUG: 'bora-school' }), /ROLLBACK_DRILL=true/);
  assert.throws(() => routingRegistry('auto'), /legacy or plugin/);
});

test('rollback verifies backup, reconciliation and journal before preserving both datasets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-attendance-rollback-')); const backupName = 'wattanam-20260925T010000Z.dump';
  try {
    const archive = path.join(directory, backupName); fs.writeFileSync(archive, 'attendance rollback backup');
    const backupSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: backupSha256 }));
    const now = '2026-01-01T00:00:00.000Z';
    const source = {
      studyYears: [{ id: 'y', year: 2026, isCurrent: true, createdAt: now, updatedAt: now }], sessions: [{ id: 's', classId: null, session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '08:00', createdAt: now, updatedAt: now }],
      holidays: [{ id: 'h', date: '2026-09-24', name: 'Holiday', createdById: 'a', createdAt: now, updatedAt: now }], identifiers: [{ id: 'i', qrValue: 'secret', studentId: 'student', createdAt: now }],
      formatRules: [{ id: 'f', organizationId: null, permissionsPerAbsent: 3, latesPerAbsentHalf: 3, absentSessionsForDayAbsent: 3, createdAt: now, updatedAt: now }],
      records: [{ id: 'r', studentId: 'student', classId: 'class', date: '2026-09-25', session: 1, status: 'PRESENT', markedById: 'a', timestamp: now }],
    };
    const target = Object.fromEntries(DATASETS.map(({ name }) => [name, source[name].map((row) => normalize(name, row))]));
    const chunk = (rows, after, limit) => rows.filter((row) => after === null || row.id > after).slice(0, limit);
    const adapter = { readSourceChunk: async (name, { after, limit }) => chunk(source[name], after, limit), readTargetChunk: async (name, { after, limit }) => chunk(target[name], after, limit), targetState: async (table) => { const name = DATASETS.find((item) => item.target === table).name; return { table, exists: true, rowCount: target[name].length }; } };
    const preflight = await inspect(adapter); const targetFingerprint = await fingerprint(adapter.readTargetChunk);
    const identity = `attendance:bora-school:${preflight.source.sha256}:${backupSha256}`;
    atomicJson(journalPath(directory, 'bora-school'), { format: 'wattanam-plugin-adoption-v1', identity, stage: 'reconciled', backupSha256, targetSha256: targetFingerprint.sha256 });
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const result = await drill({ adapter, directory, backupName, slug: 'bora-school', registry });
    assert.equal(result.rolledBack, true); assert.deepEqual(registry, { routeOwner: 'legacy', pluginEnabled: false });
    assert.equal(source.records.length, 1); assert.equal(target.records.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(journalPath(directory, 'bora-school'), 'utf8')).stage, 'rolled_back');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
