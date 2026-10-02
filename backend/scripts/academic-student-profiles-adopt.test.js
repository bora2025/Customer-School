'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-student-profiles-adoption-preflight');
const { adopt, dryRun, journalPath, parseConfirmation } = require('./academic-student-profiles-adopt');

const backupName = 'wattanam-20260923T000000Z.dump';
const source = [
  { id: 's1', userId: 'u1', studentNumber: '001', parentId: 'p1', qrCode: 'qr1', photo: null, sex: 'FEMALE', dateOfBirth: '2015-01-02', address: 'A', generation: '1', nameKh: 'ក', customFieldValues: { house: 'Blue' }, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 's2', userId: 'u2', studentNumber: '002', parentId: null, qrCode: 'qr2', photo: null, sex: 'MALE', dateOfBirth: null, address: null, generation: null, nameKh: null, customFieldValues: {}, createdAt: '2025-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-student-profile-adopt-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'student profile backup fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: checksum }));
  const target = new Map();
  let writes = 0;
  let crash = false;
  const chunk = (rows, after, limit) => rows.filter((row) => after === null || row.id > after).slice(0, limit);
  const adapter = {
    readStudentChunk: async ({ after, limit }) => chunk(source, after, limit),
    targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: target.size }),
    targetCount: async () => target.size,
    readSourceChunk: async ({ after, limit }) => chunk(source, after, limit),
    writeTargetChunk: async (rows) => {
      for (const row of rows) target.set(row.id, { ...row });
      writes++;
      if (crash && writes === 1) throw new Error('simulated crash after commit');
    },
    readTargetChunk: async ({ after, limit }) => chunk([...target.values()].sort((a, b) => a.id.localeCompare(b.id)), after, limit),
  };
  return { directory, adapter, target, get writes() { return writes; }, enableCrash() { crash = true; }, disableCrash() { crash = false; }, close() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('requires exact confirmation and dry-run writes nothing', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    assert.throws(() => parseConfirmation({ ACADEMIC_STUDENT_PROFILES_NON_INTERACTIVE: 'true', ACADEMIC_SCHOOL_SLUG: 'bora-school', ACADEMIC_CONFIRM_SLUG: 'wrong', ACADEMIC_STUDENT_PROFILES_SOURCE_SHA256: preflight.source.sha256 }), /exactly match/);
    const result = await dryRun({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } });
    assert.equal(result.ready, true);
    assert.equal(result.zeroWriteGuarantee, true);
    assert.equal(sample.writes, 0);
    assert.equal(fs.existsSync(journalPath(sample.directory, 'bora-school')), false);
  } finally { sample.close(); }
});

test('resumes a committed chunk and reconciles the exact fingerprint', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: preflight.source.sha256 };
    sample.enableCrash();
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 }), /simulated crash/);
    sample.disableCrash();
    const result = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.studentProfileCount, 2);
    assert.equal(result.sha256, result.targetSha256);
    assert.equal(sample.target.size, 2);
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally { sample.close(); }
});

test('blocks stale fingerprints and a non-empty target without its journal', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) } }), /fingerprint changed/);
    sample.target.set('existing', { ...source[0], id: 'existing' });
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } }), /preflight is blocked/);
    assert.equal(sample.writes, 0);
  } finally { sample.close(); }
});
