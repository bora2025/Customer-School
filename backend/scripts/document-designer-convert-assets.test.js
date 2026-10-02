'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { conversionPlan, convertAssets, deterministicAssetId } = require('./document-designer-convert-assets');

const png = Buffer.from('legacy-image').toString('base64');
const uri = `data:image/png;base64,${png}`;
const sourceRow = { id: 'a', name: 'Card', cardType: 'student', design: { cardType: 'student', logos: [{ src: uri }] }, createdAt: '2026-01-01', updatedAt: '2026-01-02' };

function sourceAdapter() {
  return { readSourceChunk: async ({ after }) => after ? [] : [sourceRow], targetExists: async () => true };
}

test('creates stable UUID-shaped IDs, deduplicates bytes, and preserves legacy sources', () => {
  const plan = conversionPlan({ logos: [{ src: uri }, { src: uri, originalSrc: uri }] });
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.references, 3);
  assert.match(plan.assets[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(plan.design.logos[0].src, uri);
  assert.equal(plan.design.logos[0].assetId, plan.assets[0].id);
  assert.equal(deterministicAssetId(plan.assets[0].sha256), plan.assets[0].id);
});

test('conversion is additive, content-deduplicated, and idempotent', async () => {
  const rows = [{ id: 'a', design: { logos: [{ src: uri }] }, updatedAt: 'one' }, { id: 'b', design: { logos: [{ src: uri }] }, updatedAt: 'two' }];
  const assets = new Map();
  let updates = 0;
  const adapter = {
    readTargetChunk: async ({ after }) => after ? rows.filter((row) => row.id > after) : rows,
    putAsset: async (asset) => { assets.set(asset.sha256, asset.bytes.toString('base64')); },
    updateTargetDesign: async (row, design) => { row.design = design; updates++; return true; },
  };
  const confirmation = { slug: 'bora-school', sourceSha256: (await require('./document-designer-adoption-preflight').inspect(sourceAdapter())).source.sha256 };
  const backup = { schoolSlug: 'bora-school', sourceSha256: confirmation.sourceSha256, stage: 'reconciled' };
  const first = await convertAssets({ adapter, sourceAdapter: sourceAdapter(), confirmation, backup });
  const second = await convertAssets({ adapter, sourceAdapter: sourceAdapter(), confirmation, backup });
  assert.deepEqual({ unique: first.uniqueAssets, references: first.references, stored: assets.size }, { unique: 1, references: 2, stored: 1 });
  assert.equal(second.uniqueAssets, 1);
  assert.equal(rows.every((row) => row.design.logos[0].src === uri && row.design.logos[0].assetId), true);
  assert.equal(updates, 4);
});

test('requires matching school, source fingerprint, and reconciled journal', async () => {
  const report = await require('./document-designer-adoption-preflight').inspect(sourceAdapter());
  const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
  const adapter = { readTargetChunk: async () => [], putAsset: async () => {}, updateTargetDesign: async () => true };
  await assert.rejects(convertAssets({ adapter, sourceAdapter: sourceAdapter(), confirmation, backup: { schoolSlug: 'other', sourceSha256: confirmation.sourceSha256, stage: 'reconciled' } }), /confirmed school/);
  await assert.rejects(convertAssets({ adapter, sourceAdapter: sourceAdapter(), confirmation, backup: { schoolSlug: 'bora-school', sourceSha256: confirmation.sourceSha256, stage: 'prepared' } }), /reconciled adoption journal/);
});

test('fails on an optimistic concurrency conflict without touching the legacy source', async () => {
  const report = await require('./document-designer-adoption-preflight').inspect(sourceAdapter());
  const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
  const adapter = {
    readTargetChunk: async ({ after }) => after ? [] : [{ id: 'a', design: { logos: [{ src: uri }] }, updatedAt: 'one' }],
    putAsset: async () => {}, updateTargetDesign: async () => false,
  };
  await assert.rejects(convertAssets({ adapter, sourceAdapter: sourceAdapter(), confirmation, backup: { schoolSlug: 'bora-school', sourceSha256: confirmation.sourceSha256, stage: 'reconciled' } }), /changed during asset conversion/);
});
