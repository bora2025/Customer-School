'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect, TARGET_TABLES } = require('./academic-admissions-adoption-preflight');
const { adopt, dryRun, journalPath, parseConfirmation } = require('./academic-admissions-adopt');

const [REGISTRATION_TABLE, SETTINGS_TABLE, FIELD_TABLE] = TARGET_TABLES;
const backupName = 'wattanam-20260916T000000Z.dump';

const sourceRegistrations = [
  {
    id: 'r1',
    classId: 'c1',
    nameKh: null,
    nameEn: 'Student One',
    email: 's1@school.test',
    phone: null,
    passwordHash: 'hash1',
    generatedPassword: null,
    photo: null,
    sex: null,
    dateOfBirth: null,
    address: null,
    generation: null,
    customFieldValues: { city: 'PP' },
    status: 'PENDING',
    rejectReason: null,
    studentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
  },
  {
    id: 'r2',
    classId: 'c2',
    nameKh: null,
    nameEn: 'Student Two',
    email: null,
    phone: '010000001',
    passwordHash: 'hash2',
    generatedPassword: 'pw-2',
    photo: null,
    sex: 'MALE',
    dateOfBirth: '2012-01-01T00:00:00.000Z',
    address: 'Street',
    generation: 'Gen 1',
    customFieldValues: null,
    status: 'APPROVED',
    rejectReason: null,
    studentId: 's2',
    createdAt: '2026-01-02T00:00:00.000Z',
    resolvedAt: '2026-01-03T00:00:00.000Z',
    resolvedBy: 'a1',
  },
];

const sourceSettings = {
  id: 'singleton',
  khmerNameMode: 'REQUIRED',
  phoneMode: 'REQUIRED',
  emailMode: 'OPTIONAL',
  photoMode: 'OPTIONAL',
  passwordMode: 'REQUIRED',
  sexMode: 'HIDDEN',
  dateOfBirthMode: 'HIDDEN',
  addressMode: 'HIDDEN',
  generationMode: 'HIDDEN',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sourceFields = [
  {
    id: 'f1',
    key: 'city',
    label: 'City',
    fieldType: 'TEXT',
    options: null,
    required: false,
    order: 0,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'f2',
    key: 'hobbies',
    label: 'Hobbies',
    fieldType: 'MULTI_SELECT',
    options: ['music', 'math'],
    required: false,
    order: 1,
    enabled: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

function chunkById(rows, after, limit) {
  return rows.filter((row) => !after || row.id > after).slice(0, limit);
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-admissions-adopt-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'admissions backup fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1',
    file: backupName,
    installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size,
    sha256: checksum,
  }));

  const targetRegistrations = new Map();
  const targetFields = new Map();
  let targetSettings = null;
  let writes = 0;
  let crashAfter = null;

  const adapter = {
    readRegistrationChunk: async ({ after, limit }) => chunkById(sourceRegistrations, after, limit),
    readSettingsSingleton: async () => sourceSettings,
    readFieldChunk: async ({ after, limit }) => chunkById(sourceFields, after, limit),
    targetState: async (table) => ({
      table,
      exists: true,
      rowCount:
        table === REGISTRATION_TABLE ? targetRegistrations.size :
        table === SETTINGS_TABLE ? (targetSettings ? 1 : 0) :
        targetFields.size,
    }),
    targetCounts: async () => ({
      [REGISTRATION_TABLE]: targetRegistrations.size,
      [SETTINGS_TABLE]: targetSettings ? 1 : 0,
      [FIELD_TABLE]: targetFields.size,
    }),

    readRegistrationSourceChunk: async ({ after, limit }) => chunkById(sourceRegistrations, after, limit),
    writeRegistrationTargetChunk: async (rows) => {
      for (const row of rows) targetRegistrations.set(row.id, { ...row });
      writes++;
      if (crashAfter !== null && writes === crashAfter) throw new Error('simulated crash after commit');
    },
    writeSettingsTarget: async (row) => {
      targetSettings = { ...row };
      writes++;
      if (crashAfter !== null && writes === crashAfter) throw new Error('simulated crash after commit');
    },
    readFieldSourceChunk: async ({ after, limit }) => chunkById(sourceFields, after, limit),
    writeFieldTargetChunk: async (rows) => {
      for (const row of rows) targetFields.set(row.id, { ...row });
      writes++;
      if (crashAfter !== null && writes === crashAfter) throw new Error('simulated crash after commit');
    },

    readRegistrationTargetChunk: async ({ after, limit }) => chunkById([...targetRegistrations.values()].sort((a, b) => a.id.localeCompare(b.id)), after, limit),
    readSettingsTargetSingleton: async () => targetSettings,
    readFieldTargetChunk: async ({ after, limit }) => chunkById([...targetFields.values()].sort((a, b) => a.id.localeCompare(b.id)), after, limit),
  };

  return {
    directory,
    adapter,
    targetRegistrations,
    targetFields,
    get targetSettings() { return targetSettings; },
    get writes() { return writes; },
    crashAfter(value) { crashAfter = value; },
    close() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test('requires exact confirmation and dry-run performs zero writes', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    assert.throws(() => parseConfirmation({
      ACADEMIC_ADMISSIONS_NON_INTERACTIVE: 'true',
      ACADEMIC_SCHOOL_SLUG: 'bora-school',
      ACADEMIC_CONFIRM_SLUG: 'wrong',
      ACADEMIC_ADMISSIONS_SOURCE_SHA256: preflight.source.sha256,
    }), /exactly match/);

    const result = await dryRun({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 },
    });

    assert.equal(result.ready, true);
    assert.equal(result.zeroWriteGuarantee, true);
    assert.equal(sample.writes, 0);
    assert.equal(fs.existsSync(journalPath(sample.directory, 'bora-school')), false);
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally {
    sample.close();
  }
});

test('resumes after committed chunks and reconciles exact source fingerprint', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: preflight.source.sha256 };

    sample.crashAfter(2);
    await assert.rejects(adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 }), /simulated crash/);

    sample.crashAfter(null);
    const result = await adopt({ adapter: sample.adapter, directory: sample.directory, backupName, confirmation, chunkSize: 1 });
    assert.equal(result.stage, 'reconciled');
    assert.equal(result.registrationCount, 2);
    assert.equal(result.fieldCount, 2);
    assert.equal(result.settingsPresent, true);
    assert.equal(result.sha256, result.targetSha256);
    assert.equal(sample.targetRegistrations.size, 2);
    assert.equal(sample.targetFields.size, 2);
    assert.equal(sample.targetSettings.id, 'singleton');
    assert.equal(fs.existsSync(path.join(sample.directory, 'plugin-adoption.maintenance.lock')), false);
  } finally {
    sample.close();
  }
});

test('blocks stale fingerprints and non-empty target without journal', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    await assert.rejects(adopt({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      confirmation: { slug: 'bora-school', sourceSha256: '0'.repeat(64) },
    }), /fingerprint changed/);

    sample.targetRegistrations.set('existing', { id: 'existing' });
    await assert.rejects(adopt({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      confirmation: { slug: 'bora-school', sourceSha256: preflight.source.sha256 },
    }), /preflight is blocked/);
    assert.equal(sample.writes, 0);
  } finally {
    sample.close();
  }
});
