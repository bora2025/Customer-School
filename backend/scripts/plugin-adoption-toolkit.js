'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'wattanam-plugin-adoption-v1';

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function loadJournal(file, identity) {
  if (!fs.existsSync(file)) return { format: FORMAT, identity, stage: 'prepared', cursor: null, processedRows: 0, chunks: [] };
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.format !== FORMAT || journal.identity !== identity) throw new Error('adoption journal identity or format mismatch');
  return journal;
}

function enterMaintenance(file, identity) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, `${JSON.stringify({ identity, enteredAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('another maintenance operation is active'); throw error; }
}

function leaveMaintenance(file, identity) {
  if (!fs.existsSync(file)) return;
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (lock.identity !== identity) throw new Error('maintenance lock belongs to another operation');
  fs.unlinkSync(file);
}

async function runBackfill({ identity, journalFile, maintenanceFile, adapter, chunkSize = 500, onProgress = () => {} }) {
  let journal = loadJournal(journalFile, identity);
  enterMaintenance(maintenanceFile, identity);
  try {
    while (journal.stage !== 'backfilled') {
      const batch = await adapter.readChunk({ after: journal.cursor, limit: chunkSize });
      if (!Array.isArray(batch.rows)) throw new Error('backfill adapter must return rows');
      if (batch.rows.length === 0) {
        journal = { ...journal, stage: 'backfilled', completedAt: new Date().toISOString() };
        atomicJson(journalFile, journal);
        onProgress({ stage: journal.stage, processedRows: journal.processedRows, cursor: journal.cursor });
        break;
      }
      const chunkKey = crypto.createHash('sha256').update(`${identity}:${JSON.stringify(batch.rows.map((row) => row.id))}`).digest('hex');
      await adapter.writeChunk(batch.rows, { idempotencyKey: chunkKey });
      journal = {
        ...journal,
        stage: 'backfilling',
        cursor: batch.nextCursor,
        processedRows: journal.processedRows + batch.rows.length,
        chunks: journal.chunks.includes(chunkKey) ? journal.chunks : [...journal.chunks, chunkKey],
        updatedAt: new Date().toISOString(),
      };
      atomicJson(journalFile, journal);
      onProgress({ stage: journal.stage, processedRows: journal.processedRows, cursor: journal.cursor });
    }
    return journal;
  } finally {
    leaveMaintenance(maintenanceFile, identity);
  }
}

function reconcile(before, after) {
  const rowCountMatches = before.rowCount === after.rowCount;
  const relationshipMatches = before.relationshipCount === after.relationshipCount;
  const amountMatches = String(before.amountTotal) === String(after.amountTotal);
  const timestampMatches = before.timestampHash === after.timestampHash;
  const fileMatches = before.fileHash === after.fileHash;
  return {
    ok: rowCountMatches && relationshipMatches && amountMatches && timestampMatches && fileMatches,
    rowCountMatches, relationshipMatches, amountMatches, timestampMatches, fileMatches,
  };
}

function rollbackRouting({ journalFile, registry, identity, legacyOwner }) {
  const journal = loadJournal(journalFile, identity);
  registry.routeOwner = legacyOwner;
  registry.pluginEnabled = false;
  journal.stage = 'rolled_back';
  journal.rolledBackAt = new Date().toISOString();
  atomicJson(journalFile, journal);
  return journal;
}

module.exports = { FORMAT, atomicJson, enterMaintenance, leaveMaintenance, loadJournal, reconcile, rollbackRouting, runBackfill };
