'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-classes-adoption-preflight');

const classes = [
  {
    id: 'c1',
    name: 'Class A',
    subject: 'Math',
    teacherId: 't1',
    classAdminId: 'a1',
    studyYearId: 'y1',
    schedule: 'Mon 09:00',
    registrationStatus: 'AVAILABLE',
    thumbnail: null,
    description: null,
    price: 10,
    showPrice: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'c2',
    name: 'Class B',
    subject: null,
    teacherId: null,
    classAdminId: null,
    studyYearId: null,
    schedule: null,
    registrationStatus: 'HIDDEN',
    thumbnail: null,
    description: null,
    price: null,
    showPrice: false,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

function fixture(rows = classes, target = { table: TARGET_TABLE, exists: true, rowCount: 0 }) {
  const calls = [];
  return {
    calls,
    adapter: {
      readClassChunk: async ({ after, limit }) => {
        calls.push(['classes', after, limit]);
        return rows.filter((row) => !after || row.id > after).slice(0, limit);
      },
      targetState: async (table) => {
        calls.push(['target', table]);
        return target;
      },
    },
  };
}

test('chunks deterministically and returns read-only metadata', async () => {
  const first = fixture();
  const report = await inspect(first.adapter, { batchSize: 1 });
  const repeat = await inspect(fixture().adapter, { batchSize: 2 });
  assert.equal(report.readOnly, true);
  assert.equal(report.ready, true);
  assert.deepEqual(report.source, { classCount: 2, sha256: repeat.source.sha256 });
  assert.equal(JSON.stringify(report).includes('Class A'), false);
  assert.deepEqual(first.calls.map((call) => call[0]), ['classes', 'classes', 'classes', 'target']);
});

test('fails closed for missing/non-empty target', async () => {
  const missing = await inspect(fixture(classes, { table: TARGET_TABLE, exists: false, rowCount: 0 }).adapter);
  assert.equal(missing.ready, false);
  assert.match(missing.blockers.join(' '), /is absent/);

  const nonEmpty = await inspect(fixture(classes, { table: TARGET_TABLE, exists: true, rowCount: 1 }).adapter);
  assert.equal(nonEmpty.ready, false);
  assert.match(nonEmpty.blockers.join(' '), /is not empty/);
});

test('rejects invalid ordering/name and batch sizes', async () => {
  await assert.rejects(inspect(fixture([...classes].reverse()).adapter), /strictly increasing IDs/);
  await assert.rejects(inspect(fixture([{ ...classes[0], name: '' }]).adapter), /has no name/);
  await assert.rejects(inspect(fixture().adapter, { batchSize: 0 }), /batchSize/);
});
