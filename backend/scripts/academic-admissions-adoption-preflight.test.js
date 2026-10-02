'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, TARGET_TABLES } = require('./academic-admissions-adoption-preflight');

const registrations = [
  {
    id: 'r1',
    classId: 'c1',
    nameKh: null,
    nameEn: 'Student One',
    email: 'student1@school.test',
    phone: null,
    passwordHash: 'hash1',
    generatedPassword: null,
    photo: null,
    sex: null,
    dateOfBirth: null,
    address: null,
    generation: null,
    customFieldValues: { city: 'PP', hobbies: ['music', 'math'] },
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
    nameKh: 'សិស្ស',
    nameEn: 'Student Two',
    email: null,
    phone: '010000001',
    passwordHash: 'hash2',
    generatedPassword: 'abc123',
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

const fields = [
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

function fixture({
  sourceRegistrations = registrations,
  sourceSettings = settings,
  sourceFields = fields,
  targetFactory = (table) => ({ table, exists: true, rowCount: 0 }),
} = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      readRegistrationChunk: async ({ after, limit }) => {
        calls.push(['registrations', after, limit]);
        return sourceRegistrations.filter((row) => !after || row.id > after).slice(0, limit);
      },
      readSettingsSingleton: async () => {
        calls.push(['settings']);
        return sourceSettings;
      },
      readFieldChunk: async ({ after, limit }) => {
        calls.push(['fields', after, limit]);
        return sourceFields.filter((row) => !after || row.id > after).slice(0, limit);
      },
      targetState: async (table) => {
        calls.push(['target', table]);
        return targetFactory(table);
      },
    },
  };
}

test('produces deterministic metadata-only readiness output', async () => {
  const first = fixture();
  const report = await inspect(first.adapter, { batchSize: 1 });
  const repeat = await inspect(fixture().adapter, { batchSize: 2 });

  assert.equal(report.readOnly, true);
  assert.equal(report.ready, true);
  assert.equal(report.source.registrationCount, 2);
  assert.equal(report.source.fieldCount, 2);
  assert.equal(report.source.settingsPresent, true);
  assert.deepEqual(report.source.statusCounts, { pending: 1, approved: 1, rejected: 0, other: 0 });
  assert.equal(report.source.sha256, repeat.source.sha256);
  assert.equal(JSON.stringify(report).includes('Student One'), false);
  assert.deepEqual(
    first.calls.map((call) => call[0]),
    ['registrations', 'registrations', 'registrations', 'settings', 'fields', 'fields', 'fields', 'target', 'target', 'target'],
  );
});

test('fails closed for missing/non-empty targets and invalid settings mode combination', async () => {
  const invalidSettings = { ...settings, phoneMode: 'HIDDEN', emailMode: 'HIDDEN' };
  const report = await inspect(fixture({
    sourceSettings: invalidSettings,
    targetFactory: (table) => ({ table, exists: table === TARGET_TABLES[0], rowCount: table === TARGET_TABLES[0] ? 1 : 0 }),
  }).adapter);

  assert.equal(report.ready, false);
  assert.match(report.blockers.join(' '), /hide both phone and email/);
  assert.match(report.blockers.join(' '), /is not empty/);
  assert.match(report.blockers.join(' '), /is absent/);
});

test('rejects invalid ordering, invalid field types, and invalid batch size', async () => {
  await assert.rejects(inspect(fixture({ sourceRegistrations: [...registrations].reverse() }).adapter), /strictly increasing IDs/);
  await assert.rejects(inspect(fixture({ sourceFields: [{ ...fields[0], fieldType: 'BLOB' }] }).adapter), /invalid fieldType/);
  await assert.rejects(inspect(fixture().adapter, { batchSize: 0 }), /batchSize/);
});
