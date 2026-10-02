'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect } = require('./academic-admissions-adoption-preflight');
const { journalPath } = require('./academic-admissions-adopt');
const { drill, parseInput, routingRegistry } = require('./academic-admissions-rollback-drill');

const backupName = 'wattanam-20260916T000000Z.dump';
const registrations = [
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
    customFieldValues: null,
    status: 'PENDING',
    rejectReason: null,
    studentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
  },
];

const settings = {
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

const fields = [];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-admissions-rollback-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'rollback drill backup fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1',
    file: backupName,
    installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size,
    sha256: checksum,
  }));

  const adapter = {
    readRegistrationChunk: async ({ after, limit }) => registrations.filter((row) => !after || row.id > after).slice(0, limit),
    readSettingsSingleton: async () => settings,
    readFieldChunk: async ({ after, limit }) => fields.filter((row) => !after || row.id > after).slice(0, limit),
    targetState: async (table) => ({ table, exists: true, rowCount: 1 }),
  };

  return { directory, checksum, adapter, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('requires explicit rollback-drill confirmation and valid route-owner values', () => {
  assert.throws(() => parseInput({ ACADEMIC_SCHOOL_SLUG: 'bora-school' }), /ROLLBACK_DRILL=true/);
  assert.throws(() => routingRegistry('auto'), /must be legacy or plugin/);
  assert.deepEqual(routingRegistry('plugin'), { routeOwner: 'plugin', pluginEnabled: true });
});

test('rollback drill flips route owner to legacy and journals rolled_back state', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const identity = `academic-admissions:bora-school:${preflight.source.sha256}:${sample.checksum}`;
    fs.writeFileSync(
      journalPath(sample.directory, 'bora-school'),
      JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity, stage: 'reconciled', backupSha256: sample.checksum }),
    );

    const report = await drill({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      slug: 'bora-school',
      registry: { routeOwner: 'plugin', pluginEnabled: true },
    });

    assert.equal(report.rolledBack, true);
    assert.deepEqual(report.registry, { routeOwner: 'legacy', pluginEnabled: false });
    assert.equal(report.journal.stage, 'rolled_back');
  } finally {
    sample.close();
  }
});

test('fails closed for non-reconciled or mismatched admissions journal', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const identity = `academic-admissions:bora-school:${preflight.source.sha256}:${sample.checksum}`;

    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({
      format: 'wattanam-plugin-adoption-v1',
      identity,
      stage: 'prepared',
      backupSha256: sample.checksum,
    }));
    await assert.rejects(drill({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      slug: 'bora-school',
      registry: { routeOwner: 'plugin', pluginEnabled: true },
    }), /not reconciled/);

    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({
      format: 'wattanam-plugin-adoption-v1',
      identity: 'wrong',
      stage: 'reconciled',
      backupSha256: sample.checksum,
    }));
    await assert.rejects(drill({
      adapter: sample.adapter,
      directory: sample.directory,
      backupName,
      slug: 'bora-school',
      registry: { routeOwner: 'plugin', pluginEnabled: true },
    }), /identity or format mismatch/);
  } finally {
    sample.close();
  }
});
