'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { adopt, confirmation, inspect, interval, TARGET_TABLE } = require('./academic-enrollment-adopt');

const source = [
  { studentId: 's1', classId: 'c1', createdAt: '2026-01-02T03:00:00.000Z' },
  { studentId: 's2', classId: 'c1', createdAt: '2026-01-03T03:00:00.000Z' },
];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-enrollment-adopt-'));
  const backupName = 'wattanam-20260916T000000Z.dump';
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'backup fixture');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size, sha256,
  }));
  const target = new Map();
  const chunks = (after, limit) => source.filter((row) => !after || row.studentId > after).slice(0, limit);
  const adapter = {
    readAllSource: async () => source,
    readSourceChunk: async ({ after, limit }) => chunks(after, limit),
    targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: target.size }),
    writeTargetChunk: async (rows) => rows.forEach((row) => target.set(row.id, { ...row })),
    readAllTarget: async () => [...target.values()],
  };
  return { adapter, backupName, directory, target };
}

test('builds deterministic open intervals without exposing names', async () => {
  assert.deepEqual(interval(source[0]), {
    id: 'legacy:s1:2026-01-02', studentId: 's1', classId: 'c1', validFrom: '2026-01-02',
    validTo: null, source: 'legacy-adoption',
  });
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    assert.equal(report.ready, true);
    assert.equal(report.source.intervalCount, 2);
    assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(report).includes('student name'), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('requires exact unattended confirmation and an empty installed target', async () => {
  assert.throws(() => confirmation({ ACADEMIC_ENROLLMENT_NON_INTERACTIVE: 'true', ACADEMIC_SCHOOL_SLUG: 'bora-school', ACADEMIC_CONFIRM_SLUG: 'wrong', ACADEMIC_ENROLLMENT_SOURCE_SHA256: 'a'.repeat(64) }), /confirmation/);
  const sample = fixture();
  try {
    sample.target.set('existing', {});
    const report = await inspect(sample.adapter);
    assert.equal(report.ready, false);
    assert.match(report.blockers[0], /not empty/);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});

test('journaled adoption reconciles the exact interval fingerprint', async () => {
  const sample = fixture();
  try {
    const report = await inspect(sample.adapter);
    const result = await adopt({
      adapter: sample.adapter, directory: sample.directory, backupName: sample.backupName,
      approved: { slug: 'bora-school', sourceSha256: report.source.sha256 }, chunkSize: 1,
    });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.intervalCount, 2);
    assert.equal(result.sha256, report.source.sha256);
    assert.equal(sample.target.size, 2);
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally { fs.rmSync(sample.directory, { recursive: true, force: true }); }
});
