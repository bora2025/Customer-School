'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compare } = require('./legacy-compare');

function writeSnapshot(dir, name, overrides) {
  const base = {
    format: 'wattanam-legacy-comparison-snapshot-v1',
    capturedAt: new Date().toISOString(),
    tableCount: 2,
    tables: {
      User: { rowCount: 3, contentHash: 'aaa' },
      Class: { rowCount: 1, contentHash: 'bbb' },
    },
    foreignKeyOrphans: [],
    credentials: { usersChecked: 3, allPasswordHashesValid: true },
  };
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ ...base, ...overrides }));
  return file;
}

test('compare reports zero diffs for two identical snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', {});
    const result = compare(before, after);
    assert.equal(result.unexplainedRowLoss.length, 0);
    assert.equal(result.tablesWithChangedContent.length, 0);
    assert.equal(result.foreignKeyOrphansAfter.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare flags a table that lost rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', { tables: { User: { rowCount: 2, contentHash: 'ccc' }, Class: { rowCount: 1, contentHash: 'bbb' } } });
    const result = compare(before, after);
    assert.equal(result.unexplainedRowLoss.length, 1);
    assert.equal(result.unexplainedRowLoss[0].table, 'User');
    assert.equal(result.unexplainedRowLoss[0].rowCountDelta, -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare flags content changes even when row counts match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', { tables: { User: { rowCount: 3, contentHash: 'DIFFERENT' }, Class: { rowCount: 1, contentHash: 'bbb' } } });
    const result = compare(before, after);
    assert.equal(result.unexplainedRowLoss.length, 0);
    assert.deepEqual(result.tablesWithChangedContent, ['User']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare surfaces a growing table without flagging it as loss', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', { tables: { User: { rowCount: 5, contentHash: 'ddd' }, Class: { rowCount: 1, contentHash: 'bbb' } } });
    const result = compare(before, after);
    assert.equal(result.unexplainedRowLoss.length, 0);
    const userDiff = result.tableDiffs.find((diff) => diff.table === 'User');
    assert.equal(userDiff.rowCountDelta, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare surfaces a table that only exists in one snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', {
      tables: { User: { rowCount: 3, contentHash: 'aaa' }, Class: { rowCount: 1, contentHash: 'bbb' }, PluginSetting: { rowCount: 2, contentHash: 'eee' } },
    });
    const result = compare(before, after);
    const newTable = result.tableDiffs.find((diff) => diff.table === 'PluginSetting');
    assert.equal(newTable.rowCountBefore, 0);
    assert.equal(newTable.rowCountAfter, 2);
    assert.equal(result.unexplainedRowLoss.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare surfaces post-adoption foreign key orphans', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', {});
    const after = writeSnapshot(dir, 'after.json', {
      foreignKeyOrphans: [{ constraint: 'Student_classId_fkey', table: 'Student', column: 'classId', referencedTable: 'Class', referencedColumn: 'id', orphanCount: 3 }],
    });
    const result = compare(before, after);
    assert.equal(result.foreignKeyOrphansAfter.length, 1);
    assert.equal(result.foreignKeyOrphansAfter[0].orphanCount, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compare rejects a snapshot with the wrong format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-legacy-compare-'));
  try {
    const before = writeSnapshot(dir, 'before.json', { format: 'something-else-v1' });
    const after = writeSnapshot(dir, 'after.json', {});
    assert.throws(() => compare(before, after));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
