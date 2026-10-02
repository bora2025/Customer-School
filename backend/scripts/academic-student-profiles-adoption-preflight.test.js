'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-student-profiles-adoption-preflight');

const students = [
  { id: 's1', userId: 'u1', studentNumber: '001', parentId: 'p1', qrCode: 'qr1', photo: null, sex: 'FEMALE', dateOfBirth: '2015-01-02', address: 'A', generation: '1', nameKh: 'ក', customFieldValues: { house: 'Blue' } },
  { id: 's2', userId: 'u2', studentNumber: '002', parentId: null, qrCode: 'qr2', photo: null, sex: 'MALE', dateOfBirth: null, address: null, generation: null, nameKh: null, customFieldValues: null },
];

function fixture(rows, target = { table: TARGET_TABLE, exists: true, rowCount: 0 }) {
  const calls = [];
  return { calls, adapter: {
    readStudentChunk: async ({ after, limit }) => { calls.push(['students', after, limit]); return rows.filter((row) => after === null || row.id > after).slice(0, limit); },
    targetState: async (table) => { calls.push(['target', table]); return target; },
  } };
}

test('produces a deterministic metadata-only student profile report', async () => {
  const first = fixture(students);
  const report = await inspect(first.adapter, { batchSize: 1 });
  const repeat = await inspect(fixture(students).adapter, { batchSize: 2 });
  assert.equal(report.ready, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.source.studentProfileCount, 2);
  assert.equal(report.source.sha256, repeat.source.sha256);
  assert.equal(JSON.stringify(report).includes('Blue'), false);
  assert.deepEqual(first.calls.map((call) => call[0]), ['students', 'students', 'students', 'target']);
});

test('fails closed for duplicates, invalid values, and unsafe target state', async () => {
  const broken = [
    students[0],
    { ...students[1], userId: 'u1', qrCode: 'qr1', sex: 'UNKNOWN', dateOfBirth: 'not-a-date' },
  ];
  const report = await inspect(fixture(broken, { table: TARGET_TABLE, exists: true, rowCount: 1 }).adapter);
  assert.equal(report.ready, false);
  assert.match(report.blockers.join(' '), /duplicate core identity/);
  assert.match(report.blockers.join(' '), /duplicate QR/);
  assert.match(report.blockers.join(' '), /unsupported sex/);
  assert.match(report.blockers.join(' '), /invalid birth date/);
  assert.match(report.blockers.join(' '), /not empty/);
});

test('rejects invalid ordering, chunks, and batch sizes', async () => {
  await assert.rejects(inspect(fixture([...students].reverse()).adapter), /strictly increasing IDs/);
  await assert.rejects(inspect(fixture(students).adapter, { batchSize: 0 }), /batchSize/);
  await assert.rejects(inspect({ readStudentChunk: async () => 'bad', targetState: async () => ({}) }), /invalid chunk/);
});
