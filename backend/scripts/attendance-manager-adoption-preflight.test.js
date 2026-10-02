'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DATASETS, inspect } = require('./attendance-manager-adoption-preflight');

function fixture() {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-09-25T00:00:00.000Z');
  return {
    studyYears: [{ id: 'year-1', year: 2026, label: '2026-2027', isCurrent: true, createdAt, updatedAt }],
    sessions: [{ id: 'session-1', scope: 'CLASS', classId: 'class-1', session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '08:00', createdAt, updatedAt }],
    holidays: [{ id: 'holiday-1', date: new Date('2026-09-24T00:00:00.000Z'), name: 'Holiday', createdById: 'admin-1', createdAt, updatedAt }],
    identifiers: [{ id: 'alias-1', qrValue: 'QR-1', studentId: 'student-1', createdById: 'admin-1', createdAt, updatedAt }],
    formatRules: [{ id: 'rule-1', scope: 'CLASS', organizationId: 'class-1', permissionsPerAbsent: 3, latesPerAbsentHalf: 3, absentSessionsForDayAbsent: 3, enabled: true, createdAt, updatedAt }],
    records: [{ id: 'record-1', studentId: 'student-1', classId: 'class-1', studyYearId: 'year-1', date: new Date('2026-09-25T00:00:00.000Z'), session: 1, status: 'PRESENT', markedById: 'admin-1', permissionStartDate: null, permissionEndDate: null, createdAt, updatedAt }],
  };
}

function adapter(rows = fixture(), targetCount = 0) {
  return {
    readSourceChunk: async (name, { after, limit }) => rows[name].filter((row) => !after || row.id > after).slice(0, limit),
    targetState: async (table) => ({ table, exists: true, rowCount: targetCount }),
  };
}

test('preflight fingerprints every in-scope attendance dataset without returning row data', async () => {
  const report = await inspect(adapter(), { batchSize: 1 });
  assert.equal(report.ready, true);
  assert.equal(report.source.datasets.records.count, 1);
  assert.equal(Object.keys(report.source.datasets).length, DATASETS.length);
  assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes('QR-1'), false);
  assert.deepEqual(report.exclusions, ['staff attendance', 'staff sessions and format rules', 'teacher lesson attendance', 'course attendance']);
});

test('preflight is deterministic and blocks invalid source or populated targets', async () => {
  const first = await inspect(adapter()); const second = await inspect(adapter());
  assert.equal(first.source.sha256, second.source.sha256);
  const rows = fixture(); rows.records[0].status = 'UNKNOWN'; rows.records[0].session = 5;
  const blocked = await inspect(adapter(rows, 1));
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.includes('records: unsupported status'));
  assert.ok(blocked.blockers.includes('records: session outside 1..4'));
  assert.ok(blocked.blockers.some((item) => item.includes('target table is not empty')));
});

test('preflight rejects unordered and oversized adapter chunks', async () => {
  const rows = fixture(); rows.records = [{ ...rows.records[0], id: 'z' }, { ...rows.records[0], id: 'a' }];
  await assert.rejects(() => inspect(adapter(rows), { batchSize: 2 }), /strictly increasing/);
  await assert.rejects(() => inspect(adapter(), { batchSize: 0 }), /1\.\.1000/);
});

test('preflight reports malformed dates, unsupported scan modes and broken Study Year references without exposing rows', async () => {
  const rows = fixture();
  rows.records[0] = { ...rows.records[0], studyYearId: 'missing-year', date: 'not-a-date', scanMode: 'CARD', updatedAt: 'also-not-a-date' };
  const report = await inspect(adapter(rows));
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes('records: invalid attendance date'));
  assert.ok(report.blockers.includes('records: unknown Study Year relationship'));
  assert.ok(report.blockers.includes('records: unsupported scan mode'));
  assert.ok(report.blockers.includes('records: invalid audit or scan timestamp'));
  assert.equal(JSON.stringify(report).includes('missing-year'), false);
});
