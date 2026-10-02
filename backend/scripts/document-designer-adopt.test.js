'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { inspect } = require('./document-designer-adoption-preflight');
const { adopt, dryRun, parseConfirmation, verifyRecoveryBackup } = require('./document-designer-adopt');

const backupName = 'wattanam-20260915T000000Z.dump';
const source = ['a', 'b', 'c'].map((id) => ({
  id, name: id === 'b' ? '__active__' : `Template ${id}`, cardType: 'student',
  design: { texts: [], cardType: 'student', backgroundColor: '#fff' },
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
}));

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-document-adopt-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'test pg_dump fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(path.join(directory, backupName.replace('.dump', '.manifest.json')), JSON.stringify({
    format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size, sha256: checksum,
  }));
  const target = new Map();
  let writes = 0;
  let grants = null;
  let failAfterFirst = false;
  const adapter = {
    readSourceChunk: async ({ after, limit }) => source.filter((row) => !after || row.id > after).slice(0, limit),
    targetExists: async () => true,
    targetCount: async () => target.size,
    readTargetChunk: async ({ after, limit }) => [...target.values()].filter((row) => !after || row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit),
    writeTargetChunk: async (rows) => {
      for (const row of rows) {
        if (!target.has(row.id)) target.set(row.id, {
          id: row.id, name: row.name, documentType: row.cardType,
          design: { backgroundColor: '#fff', cardType: 'student', texts: [] },
          isActive: row.name === '__active__', createdAt: row.createdAt, updatedAt: row.updatedAt,
        });
      }
      writes++;
      if (failAfterFirst && writes === 1) throw new Error('simulated crash after database commit');
    },
    grantPermissions: async (matrix) => { grants = matrix; },
  };
  return { directory, adapter, target, get writes() { return writes; }, get grants() { return grants; }, crash() { failAfterFirst = true; } };
}

test('requires exact school confirmation and school-bound backup before any writes', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
    assert.throws(() => parseConfirmation({ DOCUMENT_DESIGNER_ADOPT_NON_INTERACTIVE: 'true', DOCUMENT_DESIGNER_SCHOOL_SLUG: 'bora-school', DOCUMENT_DESIGNER_CONFIRM_SLUG: 'other', DOCUMENT_DESIGNER_SOURCE_SHA256: confirmation.sourceSha256 }), /exactly match/);
    assert.throws(() => verifyRecoveryBackup(sample.directory, '../other.dump', 'bora-school'), /exact/);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { ...confirmation, slug: 'other' } }), /does not match this school/);
    assert.equal(sample.writes, 0);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('backup-bound dry run lists the plan and guarantees zero writes or journal creation', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const result = await dryRun({
      adapter: sample.adapter, directory: sample.directory, backupName,
      confirmation: { slug: 'bora-school', sourceSha256: report.source.sha256 },
    });
    assert.equal(result.ready, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.zeroWriteGuarantee, true);
    assert.equal(result.plannedSteps.length, 8);
    assert.equal(sample.writes, 0);
    assert.equal(sample.target.size, 0);
    assert.equal(fs.readdirSync(sample.directory).some((name) => name.endsWith('.journal.json') || name.endsWith('.lock')), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('journaled copy resumes after crash, preserves IDs/designs/active state and reconciles', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
    sample.crash();
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 }), /simulated crash/);
    const result = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.sourceRows, 3);
    assert.equal(result.sourceSha256, result.targetSha256);
    assert.equal(sample.target.size, 3);
    assert.equal(sample.target.get('b').isActive, true);
    assert.deepEqual(sample.grants['wattanam.document-designer.edit'], ['ADMIN']);
    assert.ok(sample.grants['wattanam.document-designer.view'].includes('STUDENT'));
    const journal = JSON.parse(fs.readFileSync(result.journalFile, 'utf8'));
    assert.equal(journal.stage, 'reconciled');
    assert.deepEqual(journal.grants, sample.grants);
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('rejects pre-existing target data and fails reconciliation on tampered target', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
    sample.target.set('x', { id: 'x' });
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation }), /target table must be empty/);
    sample.target.clear();
    const original = sample.adapter.writeTargetChunk;
    sample.adapter.writeTargetChunk = async (rows, metadata) => {
      await original(rows, metadata);
      sample.target.get(rows[0].id).design = { cardType: 'student', texts: ['tampered'] };
    };
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation }), /reconciliation failed/);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('blocks stale source fingerprint and corrupted backup without writing target rows', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName,
      confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) },
    }), /fingerprint changed/);
    fs.appendFileSync(path.join(sample.directory, backupName), 'corrupted');
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName,
      confirmation: { slug: 'bora-school', sourceSha256: report.source.sha256 },
    }), /size or checksum mismatch/);
    assert.equal(sample.writes, 0);
    assert.equal(sample.target.size, 0);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});
