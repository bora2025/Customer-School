'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect, TARGET_TABLES } = require('./academic-management-adoption-preflight');
const { adopt, dryRun, journalPaths, parseConfirmation } = require('./academic-management-adopt');

const backupName = 'wattanam-20260915T000000Z.dump';
const departments = [
  { id: 'd1', name: 'Languages', nameKh: null, description: null },
  { id: 'd2', name: 'Science', nameKh: 'វិទ្យាសាស្ត្រ', description: 'STEM' },
];
const memberships = [{ userId: 'u1', departmentId: 'd1' }, { userId: 'u2', departmentId: 'd2' }];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-academic-adopt-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'test pg_dump fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size, sha256: checksum,
  }));
  const targetDepartments = new Map();
  const targetMemberships = new Map();
  let writes = 0;
  let crash = false;
  const chunkKeys = { departments: [], memberships: [] };
  const chunks = (rows, key, after, limit) => rows.filter((row) => !after || row[key] > after).slice(0, limit);
  const adapter = {
    readDepartmentChunk: async ({ after, limit }) => chunks(departments, 'id', after, limit),
    readMembershipChunk: async ({ after, limit }) => chunks(memberships, 'userId', after, limit),
    targetState: async (tables) => tables.map((table) => ({ table, exists: true, rowCount: table === TARGET_TABLES[0] ? targetDepartments.size : targetMemberships.size })),
    targetCounts: async () => ({ departments: targetDepartments.size, memberships: targetMemberships.size }),
    writeDepartmentChunk: async (rows, metadata) => {
      chunkKeys.departments.push(metadata.idempotencyKey);
      for (const row of rows) targetDepartments.set(row.id, { ...row });
      writes++;
      if (crash && writes === 1) throw new Error('simulated crash after commit');
    },
    writeMembershipChunk: async (rows, metadata) => {
      chunkKeys.memberships.push(metadata.idempotencyKey);
      for (const row of rows) targetMemberships.set(row.userId, { userId: row.userId, departmentId: row.departmentId });
      writes++;
    },
    readTargetDepartmentChunk: async ({ after, limit }) => chunks([...targetDepartments.values()].sort((a, b) => a.id.localeCompare(b.id)), 'id', after, limit),
    readTargetMembershipChunk: async ({ after, limit }) => chunks([...targetMemberships.values()].sort((a, b) => a.userId.localeCompare(b.userId)), 'userId', after, limit),
  };
  return { directory, adapter, targetDepartments, targetMemberships, chunkKeys, get writes() { return writes; }, enableCrash() { crash = true; }, disableCrash() { crash = false; } };
}

test('requires exact confirmation and dry-run guarantees zero writes', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    assert.throws(() => parseConfirmation({ ACADEMIC_ADOPT_NON_INTERACTIVE: 'true', ACADEMIC_SCHOOL_SLUG: 'bora-school', ACADEMIC_CONFIRM_SLUG: 'wrong', ACADEMIC_SOURCE_SHA256: report.source.sha256 }), /exactly match/);
    const result = await dryRun({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: report.source.sha256 } });
    assert.equal(result.ready, true);
    assert.equal(result.zeroWriteGuarantee, true);
    assert.equal(sample.writes, 0);
    assert.equal(fs.readdirSync(sample.directory).some((name) => name.endsWith('.journal.json') || name.endsWith('.lock')), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('resumes after a committed chunk and exactly reconciles both phases', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
    sample.enableCrash();
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 }), /simulated crash/);
    sample.disableCrash();
    const result = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.departmentCount, 2);
    assert.equal(result.membershipCount, 2);
    assert.equal(result.sha256, result.targetSha256);
    assert.equal(sample.targetDepartments.size, 2);
    assert.equal(sample.targetMemberships.size, 2);
    assert.equal(new Set(sample.chunkKeys.memberships).size, 2);
    assert.equal(sample.chunkKeys.memberships.length, 2);
    assert.equal(fs.existsSync(result.journals.maintenance), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('blocks stale fingerprints and pre-existing target data without writes', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) } }), /fingerprint changed/);
    sample.targetDepartments.set('existing', { id: 'existing' });
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: report.source.sha256 } }), /preflight is blocked/);
    assert.equal(sample.writes, 0);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('validates both resume journals and phase targets before any backfill write', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: report.source.sha256 };
    const files = journalPaths(sample.directory, confirmation.slug);
    fs.writeFileSync(files.memberships, JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity: 'wrong', backupSha256: 'wrong' }));

    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation }), /journal identity or format mismatch/);
    assert.equal(sample.writes, 0);
    assert.equal(fs.existsSync(files.departments), false);

    fs.unlinkSync(files.memberships);
    sample.targetMemberships.set('existing', { userId: 'existing', departmentId: 'd1' });
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation }), /preflight is blocked/);
    assert.equal(sample.writes, 0);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});
