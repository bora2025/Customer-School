'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-subjects-adoption-preflight');
const { adopt, dryRun, journalPath, parseConfirmation } = require('./academic-subjects-adopt');

const backupName = 'wattanam-20260925T000000Z.dump';
const rows = [{ id: 'c1', subject: 'Math' }, { id: 'c2', subject: 'Science' }, { id: 'c3', subject: 'math' }];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-subject-adopt-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'subject backup fixture');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size, sha256,
  }));
  const target = new Map();
  let writes = 0;
  const adapter = {
    readClassSubjectChunk: async ({ after, limit }) => rows.filter((row) => !after || row.id > after).slice(0, limit),
    targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: target.size }),
    writeSubjects: async (subjects) => { writes += 1; for (const subject of subjects) target.set(subject.id, { ...subject }); },
    readTargetSubjects: async () => [...target.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { directory, adapter, target, get writes() { return writes; }, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('requires exact confirmation and dry-run makes zero writes', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    assert.throws(() => parseConfirmation({ ACADEMIC_SUBJECTS_NON_INTERACTIVE: 'true', ACADEMIC_SCHOOL_SLUG: 'bora-school', ACADEMIC_CONFIRM_SLUG: 'wrong', ACADEMIC_SUBJECTS_SOURCE_SHA256: preflight.source.sha256 }), /exactly match/);
    const result = await dryRun({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } });
    assert.equal(result.ready, true);
    assert.equal(result.zeroWriteGuarantee, true);
    assert.equal(sample.writes, 0);
    assert.equal(fs.existsSync(journalPath(sample.directory, 'bora-school')), false);
  } finally { sample.close(); }
});

test('adopts exact deterministic subjects, reconciles, and resumes idempotently', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: preflight.source.sha256 };
    const result = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.subjectCount, 2);
    assert.equal(sample.target.size, 2);
    const resumed = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation });
    assert.equal(resumed.resumed, true);
    assert.equal(sample.writes, 1);
  } finally { sample.close(); }
});

test('blocks stale fingerprints and a non-empty target without a matching journal', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) } }), /fingerprint changed/);
    sample.target.set('existing', { id: 'existing', code: 'EXISTING', name: 'Existing' });
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } }), /preflight is blocked/);
  } finally { sample.close(); }
});
