'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect } = require('./document-designer-adoption-preflight');

function fixture(rows, exists = true) {
  const calls = [];
  const adapter = {
    readSourceChunk: async ({ after, limit }) => {
      calls.push(['read', after, limit]);
      return rows.filter((row) => !after || row.id > after).slice(0, limit);
    },
    targetExists: async () => { calls.push(['target']); return exists; },
  };
  return { adapter, calls };
}

const row = (id, name = 'Card', cardType = 'student') => ({
  id, name, cardType, design: { cardType, texts: [] },
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
});

test('chunks the source deterministically and reports only metadata, with no mutation calls', async () => {
  const { adapter, calls } = fixture([row('a'), row('b', '__active__'), row('c', 'Staff', 'staff')]);
  const report = await inspect(adapter, { batchSize: 2 });
  const repeat = await inspect(fixture([row('a'), row('b', '__active__'), row('c', 'Staff', 'staff')]).adapter, { batchSize: 1 });

  assert.equal(report.ready, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.source.rowCount, 3);
  assert.deepEqual(report.source.activeByType, { student: 'b' });
  assert.equal(report.source.sha256, repeat.source.sha256);
  assert.deepEqual(report.assets, { uniqueCount: 0, referenceCount: 0, totalBytes: 0, items: [], portable: true });
  assert.deepEqual(calls.map((call) => call[0]), ['read', 'read', 'read', 'target']);
  assert.equal(JSON.stringify(report).includes('texts'), false);
});

test('inventories embedded legacy assets by content hash and deduplicates repeated references', async () => {
  const png = Buffer.from('portable-png-fixture').toString('base64');
  const first = row('a');
  first.design.logos = [{ src: `data:image/png;base64,${png}` }, { src: `data:image/png;base64,${png}` }];
  const report = await inspect(fixture([first]).adapter);

  assert.equal(report.ready, true);
  assert.equal(report.assets.portable, true);
  assert.equal(report.assets.uniqueCount, 1);
  assert.equal(report.assets.referenceCount, 2);
  assert.equal(report.assets.totalBytes, Buffer.byteLength('portable-png-fixture'));
  assert.equal(report.assets.items[0].references.length, 2);
  assert.match(report.assets.items[0].sha256, /^[a-f0-9]{64}$/);
});

test('blocks external, malformed and unsupported legacy assets before adoption', async () => {
  const first = row('a');
  first.design.logos = [
    { src: 'https://assets.example/logo.png' },
    { src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { src: 'data:image/png;base64,not-canonical' },
  ];
  const report = await inspect(fixture([first]).adapter);

  assert.equal(report.ready, false);
  assert.equal(report.assets.portable, false);
  assert.match(report.blockers.join('\n'), /non-portable legacy asset reference/);
  assert.match(report.blockers.join('\n'), /unsupported legacy asset MIME/);
  assert.match(report.blockers.join('\n'), /non-portable legacy asset reference|invalid legacy asset base64/);
});

test('fails closed for absent target, duplicate active, unsupported type and mismatched design', async () => {
  const rows = [row('a', '__active__'), row('b', '__active__'), row('c', 'Wrong', 'unknown')];
  rows[2].design.cardType = 'student';
  const report = await inspect(fixture(rows, false).adapter);
  assert.equal(report.ready, false);
  assert.equal(report.blockers.length, 4);
  assert.match(report.blockers.join(' '), /duplicate active templates/);
  assert.match(report.blockers.join(' '), /target table .* is absent/);
});

test('rejects unordered source data and invalid batch sizes before any adoption', async () => {
  await assert.rejects(inspect(fixture([row('b'), row('a')]).adapter), /strictly increasing IDs/);
  await assert.rejects(inspect(fixture([]).adapter, { batchSize: 0 }), /batchSize/);
});
