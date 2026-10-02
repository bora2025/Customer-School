'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DATASETS, inspect, normalize } = require('./attendance-manager-adoption-preflight');
const { adopt, dryRun, journalPath, parseConfirmation } = require('./attendance-manager-adopt');

const backupName = 'wattanam-20260925T000000Z.dump';
const baseTime = '2026-01-01T00:00:00.000Z';
function sources() { return {
  studyYears: [{ id: 'year-1', year: 2026, label: '2026-2027', isCurrent: true, createdAt: baseTime, updatedAt: baseTime }],
  sessions: [{ id: 'session-1', scope: 'CLASS', classId: null, session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '08:00', createdAt: baseTime, updatedAt: baseTime }],
  holidays: [{ id: 'holiday-1', date: '2026-09-24', name: 'Holiday', type: 'HOLIDAY', createdById: 'admin-1', createdAt: baseTime, updatedAt: baseTime }],
  identifiers: [{ id: 'alias-1', qrValue: 'QR-1', studentId: 'student-1', createdById: 'admin-1', active: true, createdAt: baseTime }],
  formatRules: [{ id: 'rule-1', scope: 'CLASS', organizationId: null, permissionsPerAbsent: 3, latesPerAbsentHalf: 3, absentSessionsForDayAbsent: 3, caseStudyABEnabled: true, enabled: true, createdAt: baseTime, updatedAt: baseTime }],
  records: [{ id: 'record-1', studentId: 'student-1', classId: 'class-1', studyYearId: 'year-1', date: '2026-09-25', session: 1, status: 'PERMISSION', permissionType: 'MEDICAL', permissionStartDate: '2026-09-25', permissionEndDate: '2026-09-26', checkInTime: baseTime, markedById: 'admin-1', student: { studentNumber: 'S001', user: { name: 'Student One' } }, class: { name: 'Grade 1A', studyYearId: 'year-1', studyYear: { label: '2026-2027', year: 2026 } }, timestamp: baseTime }],
}; }

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-attendance-adopt-')); const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'attendance backup fixture'); const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: checksum }));
  const source = sources(); const target = Object.fromEntries(DATASETS.map(({ name }) => [name, new Map()])); let writes = 0; let crash = false;
  const chunk = (rows, after, limit) => rows.filter((row) => after === null || row.id > after).slice(0, limit);
  const adapter = {
    readSourceChunk: async (name, { after, limit }) => chunk(source[name], after, limit),
    readTargetChunk: async (name, { after, limit }) => chunk([...target[name].values()].sort((a, b) => a.id.localeCompare(b.id)), after, limit),
    targetState: async (table) => { const dataset = DATASETS.find((item) => item.target === table); return { table, exists: true, rowCount: target[dataset.name].size }; },
    writeTargetChunk: async (name, rows) => { rows.forEach((row) => target[name].set(row.id, { ...row })); writes++; if (crash && writes === 2) throw new Error('simulated crash after committed Attendance chunk'); },
  };
  return { directory, adapter, source, target, get writes() { return writes; }, enableCrash() { crash = true; }, disableCrash() { crash = false; }, close() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('guarded dry-run is zero-write and requires exact school/fingerprint confirmation', async () => {
  const sample = fixture(); try {
    const preflight = await inspect(sample.adapter);
    assert.throws(() => parseConfirmation({ ATTENDANCE_ADOPTION_NON_INTERACTIVE: 'true', ATTENDANCE_SCHOOL_SLUG: 'bora-school', ATTENDANCE_CONFIRM_SLUG: 'wrong', ATTENDANCE_SOURCE_SHA256: preflight.source.sha256 }), /exactly match/);
    const report = await dryRun({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } });
    assert.equal(report.ready, true); assert.equal(report.zeroWriteGuarantee, true); assert.equal(sample.writes, 0); assert.equal(fs.existsSync(journalPath(sample.directory, 'bora-school')), false);
  } finally { sample.close(); }
});

test('six-dataset adoption resumes committed chunks and reconciles exact canonical hashes', async () => {
  const sample = fixture(); try {
    const preflight = await inspect(sample.adapter); const confirmation = { slug: 'bora-school', sourceSha256: preflight.source.sha256 };
    sample.enableCrash(); await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 }), /simulated crash/);
    sample.disableCrash(); const report = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 });
    assert.equal(report.stage, 'reconciled'); assert.equal(report.source.sha256, report.target.sha256);
    for (const { name } of DATASETS) { assert.equal(sample.target[name].size, sample.source[name].length); assert.deepEqual(sample.target[name].get(sample.source[name][0].id), normalize(name, sample.source[name][0])); }
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally { sample.close(); }
});

test('adoption blocks stale fingerprints and populated targets without its matching journal', async () => {
  const sample = fixture(); try {
    const preflight = await inspect(sample.adapter);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) } }), /blocked or source fingerprint changed/);
    sample.target.holidays.set('existing', normalize('holidays', sample.source.holidays[0]));
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 } }), /blocked or source fingerprint changed/);
    assert.equal(sample.writes, 0);
  } finally { sample.close(); }
});
