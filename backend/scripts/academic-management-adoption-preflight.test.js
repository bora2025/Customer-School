'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, TARGET_TABLES } = require('./academic-management-adoption-preflight');

function fixture(departments, memberships, targetOverrides = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      readDepartmentChunk: async ({ after, limit }) => {
        calls.push(['departments', after, limit]);
        return departments.filter((row) => !after || row.id > after).slice(0, limit);
      },
      readMembershipChunk: async ({ after, limit }) => {
        calls.push(['memberships', after, limit]);
        return memberships.filter((row) => !after || row.userId > after).slice(0, limit);
      },
      targetState: async (tables) => {
        calls.push(['targets', tables]);
        return tables.map((table) => ({ table, exists: true, rowCount: 0, ...targetOverrides[table] }));
      },
    },
  };
}

const departments = [
  { id: 'd1', name: 'Languages', nameKh: null, description: null },
  { id: 'd2', name: 'Science', nameKh: 'វិទ្យាសាស្ត្រ', description: 'STEM' },
];
const memberships = [
  { userId: 'u1', departmentId: 'd1' },
  { userId: 'u2', departmentId: 'd2' },
];

test('chunks deterministically, emits metadata only, and makes no mutation calls', async () => {
  const first = fixture(departments, memberships);
  const report = await inspect(first.adapter, { batchSize: 1 });
  const repeat = await inspect(fixture(departments, memberships).adapter, { batchSize: 2 });

  assert.equal(report.ready, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.source, { departmentCount: 2, membershipCount: 2, sha256: repeat.source.sha256 });
  assert.equal(JSON.stringify(report).includes('Languages'), false);
  assert.equal(JSON.stringify(report).includes('u1'), false);
  assert.deepEqual(first.calls.map((call) => call[0]), [
    'departments', 'departments', 'departments', 'memberships', 'memberships', 'memberships', 'targets',
  ]);
});

test('fails closed for missing/non-empty targets and orphaned memberships', async () => {
  const overrides = {
    [TARGET_TABLES[0]]: { exists: false },
    [TARGET_TABLES[1]]: { exists: true, rowCount: 1 },
  };
  const report = await inspect(fixture(departments, [{ userId: 'u1', departmentId: 'missing' }], overrides).adapter);

  assert.equal(report.ready, false);
  assert.equal(report.blockers.length, 3);
  assert.match(report.blockers.join(' '), /unknown department/);
  assert.match(report.blockers.join(' '), /is absent/);
  assert.match(report.blockers.join(' '), /is not empty/);
});

test('rejects invalid chunks, ordering, and batch sizes', async () => {
  await assert.rejects(inspect(fixture([...departments].reverse(), memberships).adapter), /strictly increasing IDs/);
  await assert.rejects(inspect(fixture(departments, [...memberships].reverse()).adapter), /strictly increasing user IDs/);
  await assert.rejects(inspect(fixture([], []).adapter, { batchSize: 0 }), /batchSize/);
});
