'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalSubject, inspect, TARGET_TABLE } = require('./academic-subjects-adoption-preflight');

const rows = [
  { id: 'c1', subject: ' Mathematics ' },
  { id: 'c2', subject: 'mathematics' },
  { id: 'c3', subject: 'Khmer' },
  { id: 'c4', subject: null },
];

function adapter(source = rows, target = { table: TARGET_TABLE, exists: true, rowCount: 0 }) {
  return {
    readClassSubjectChunk: async ({ after, limit }) => source.filter((row) => !after || row.id > after).slice(0, limit),
    targetState: async () => target,
  };
}

test('canonicalizes and deduplicates subject values deterministically', async () => {
  const report = await inspect(adapter(), { batchSize: 2 });
  const repeat = await inspect(adapter(), { batchSize: 4 });
  assert.equal(report.readOnly, true);
  assert.equal(report.ready, true);
  assert.deepEqual(report.source, { classCount: 4, subjectCount: 2, sha256: repeat.source.sha256 });
  assert.deepEqual(report.subjects.map((subject) => subject.name), ['Khmer', 'Mathematics']);
  assert.match(report.subjects[0].id, /^legacy-subject-[a-f0-9]{24}$/);
  assert.match(report.subjects[0].code, /^LEGACY_[A-F0-9]{12}$/);
  assert.equal(canonicalSubject('  '), null);
});

test('fails closed for an unavailable or dirty target and invalid source ordering', async () => {
  assert.equal((await inspect(adapter(rows, { table: TARGET_TABLE, exists: false, rowCount: 0 }))).ready, false);
  assert.equal((await inspect(adapter(rows, { table: TARGET_TABLE, exists: true, rowCount: 1 }))).ready, false);
  await assert.rejects(inspect(adapter([...rows].reverse())), /strictly increasing IDs/);
  await assert.rejects(inspect(adapter(), { batchSize: 0 }), /batchSize/);
});
