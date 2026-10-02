'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-study-years-adoption-preflight');

function fixture(studyYears, target = { table: TARGET_TABLE, exists: true, rowCount: 0 }) {
  const calls = [];
  return {
    calls,
    adapter: {
      readStudyYearChunk: async ({ after, limit }) => {
        calls.push(['study-years', after, limit]);
        return studyYears.filter((row) => after === null || row.year > after).slice(0, limit);
      },
      targetState: async (table) => {
        calls.push(['target', table]);
        return target;
      },
    },
  };
}

const studyYears = [
  { id: 'y1', year: 2025, label: '2025-2026', startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z', isCurrent: false, schoolName: 'Wattanam', logoUrl: null },
  { id: 'y2', year: 2026, label: '2026-2027', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z', isCurrent: true, schoolName: 'Wattanam', logoUrl: null },
];

test('chunks deterministically and returns metadata-only read-only preflight', async () => {
  const first = fixture(studyYears);
  const report = await inspect(first.adapter, { batchSize: 1 });
  const repeat = await inspect(fixture(studyYears).adapter, { batchSize: 2 });

  assert.equal(report.readOnly, true);
  assert.equal(report.ready, true);
  assert.deepEqual(report.source, {
    studyYearCount: 2,
    currentCount: 1,
    sha256: repeat.source.sha256,
  });
  assert.equal(JSON.stringify(report).includes('2026-2027'), false);
  assert.deepEqual(first.calls.map((call) => call[0]), ['study-years', 'study-years', 'study-years', 'target']);
});

test('fails closed for invalid current flags and target state', async () => {
  const duplicateCurrent = [
    { ...studyYears[0], isCurrent: true },
    { ...studyYears[1], isCurrent: true },
  ];

  const missing = await inspect(fixture(duplicateCurrent, { table: TARGET_TABLE, exists: false, rowCount: 0 }).adapter);
  assert.equal(missing.ready, false);
  assert.match(missing.blockers.join(' '), /more than one current year/);
  assert.match(missing.blockers.join(' '), /is absent/);

  const nonEmpty = await inspect(fixture(studyYears, { table: TARGET_TABLE, exists: true, rowCount: 2 }).adapter);
  assert.equal(nonEmpty.ready, false);
  assert.match(nonEmpty.blockers.join(' '), /is not empty/);
});

test('rejects invalid chunks and batch sizes', async () => {
  await assert.rejects(inspect(fixture([...studyYears].reverse()).adapter), /strictly increasing year values/);
  await assert.rejects(inspect(fixture(studyYears).adapter, { batchSize: 0 }), /batchSize/);
});
