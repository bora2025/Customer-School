'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { enterMaintenance, leaveMaintenance, reconcile, rollbackRouting, runBackfill } = require('./plugin-adoption-toolkit');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-plugin-adopt-'));
  return { directory, journalFile: path.join(directory, 'journal.json'), maintenanceFile: path.join(directory, 'maintenance.json') };
}

test('journaled chunks resume after a kill at every checkpoint and remain idempotent', async () => {
  for (const killAt of [1, 2, 3, 4]) {
    const { directory, journalFile, maintenanceFile } = fixture();
    const source = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
    const target = new Map();
    let checkpoint = 0;
    let killed = false;
    const adapter = {
      readChunk: async ({ after, limit }) => {
        const rows = source.filter((row) => row.id > (after || 0)).slice(0, limit);
        return { rows, nextCursor: rows.at(-1)?.id || after };
      },
      writeChunk: async (rows) => { for (const row of rows) target.set(row.id, row); },
    };
    try {
      await assert.rejects(runBackfill({ identity: 'attendance-v1', journalFile, maintenanceFile, adapter, chunkSize: 2,
        onProgress: ({ stage }) => { if (stage === 'backfilling' && ++checkpoint === killAt) { killed = true; throw new Error('simulated kill'); } } }), /simulated kill/);
      assert.equal(killed, true);
      const journal = await runBackfill({ identity: 'attendance-v1', journalFile, maintenanceFile, adapter, chunkSize: 2 });
      assert.equal(journal.stage, 'backfilled');
      assert.equal(journal.processedRows, 7);
      assert.equal(target.size, 7);
      assert.equal(fs.existsSync(maintenanceFile), false);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('maintenance is exclusive and ownership-checked', () => {
  const { directory, maintenanceFile } = fixture();
  try {
    enterMaintenance(maintenanceFile, 'one');
    assert.throws(() => enterMaintenance(maintenanceFile, 'two'), /another maintenance/);
    assert.throws(() => leaveMaintenance(maintenanceFile, 'two'), /another operation/);
    leaveMaintenance(maintenanceFile, 'one');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a committed chunk retried before its journal checkpoint is not duplicated', async () => {
  const { directory, journalFile, maintenanceFile } = fixture();
  const target = new Map();
  const committedKeys = new Set();
  let firstWrite = true;
  const adapter = {
    readChunk: async ({ after }) => after ? { rows: [], nextCursor: after } : { rows: [{ id: 1 }], nextCursor: 1 },
    writeChunk: async (rows, { idempotencyKey }) => {
      if (!committedKeys.has(idempotencyKey)) { committedKeys.add(idempotencyKey); for (const row of rows) target.set(row.id, row); }
      if (firstWrite) { firstWrite = false; throw new Error('crash after commit'); }
    },
  };
  try {
    await assert.rejects(runBackfill({ identity: 'attendance-v1', journalFile, maintenanceFile, adapter }), /crash after commit/);
    const journal = await runBackfill({ identity: 'attendance-v1', journalFile, maintenanceFile, adapter });
    assert.equal(journal.processedRows, 1);
    assert.equal(target.size, 1);
    assert.equal(committedKeys.size, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('reconciliation checks rows, relationships, amounts, timestamps and files', () => {
  const snapshot = { rowCount: 2, relationshipCount: 1, amountTotal: '12.50', timestampHash: 'time', fileHash: 'files' };
  assert.equal(reconcile(snapshot, { ...snapshot }).ok, true);
  assert.deepEqual(reconcile(snapshot, { ...snapshot, amountTotal: '12.51' }), {
    ok: false, rowCountMatches: true, relationshipMatches: true, amountMatches: false, timestampMatches: true, fileMatches: true,
  });
});

test('rollback changes routing and registry only and keeps both datasets', () => {
  const { directory, journalFile } = fixture();
  const registry = { routeOwner: 'wattanam.attendance', pluginEnabled: true };
  try {
    const journal = rollbackRouting({ journalFile, registry, identity: 'attendance-v1', legacyOwner: 'legacy:attendance' });
    assert.equal(journal.stage, 'rolled_back');
    assert.deepEqual(registry, { routeOwner: 'legacy:attendance', pluginEnabled: false });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
