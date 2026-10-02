'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect } = require('./academic-student-profiles-adoption-preflight');
const { journalPath } = require('./academic-student-profiles-adopt');
const { drill, parseInput, routingRegistry } = require('./academic-student-profiles-rollback-drill');

const backupName = 'wattanam-20260923T000000Z.dump';
const students = [{ id: 's1', userId: 'u1', studentNumber: 'ST-1', parentId: null, qrCode: 'QR-1', photo: null, sex: 'MALE', dateOfBirth: null, address: null, generation: null, nameKh: null, customFieldValues: {}, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-student-profile-rollback-'));
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'student profile rollback backup fixture');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({
    format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school',
    sizeBytes: fs.statSync(archive).size, sha256: checksum,
  }));
  const adapter = {
    readStudentChunk: async ({ after, limit }) => students.filter((row) => after === null || row.id > after).slice(0, limit),
    targetState: async (table) => ({ table, exists: true, rowCount: 1 }),
  };
  return { directory, checksum, adapter, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('requires explicit rollback confirmation and valid route owner', () => {
  assert.throws(() => parseInput({ ACADEMIC_SCHOOL_SLUG: 'bora-school' }), /ROLLBACK_DRILL=true/);
  assert.throws(() => routingRegistry('auto'), /must be legacy or plugin/);
  assert.deepEqual(routingRegistry('plugin'), { routeOwner: 'plugin', pluginEnabled: true });
});

test('preserves datasets while returning Student profile routing to legacy', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const identity = `academic-student-profiles:bora-school:${preflight.source.sha256}:${sample.checksum}`;
    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({
      format: 'wattanam-plugin-adoption-v1', identity, stage: 'reconciled', backupSha256: sample.checksum,
    }));
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const report = await drill({ adapter: sample.adapter, directory: sample.directory, backupName, slug: 'bora-school', registry });
    assert.equal(report.rolledBack, true);
    assert.deepEqual(registry, { routeOwner: 'legacy', pluginEnabled: false });
    assert.equal(report.journal.stage, 'rolled_back');
    assert.equal((await sample.adapter.readStudentChunk({ after: null, limit: 10 })).length, 1);
  } finally { sample.close(); }
});

test('fails closed for absent, non-reconciled, or mismatched journals', async () => {
  const sample = fixture();
  try {
    await assert.rejects(drill({ adapter: sample.adapter, directory: sample.directory, backupName, slug: 'bora-school', registry: {} }), /journal is absent/);
    const preflight = await inspect(sample.adapter);
    const identity = `academic-student-profiles:bora-school:${preflight.source.sha256}:${sample.checksum}`;
    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', backupSha256: sample.checksum }));
    await assert.rejects(drill({ adapter: sample.adapter, directory: sample.directory, backupName, slug: 'bora-school', registry: {} }), /not reconciled/);
    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity: 'wrong', stage: 'reconciled', backupSha256: sample.checksum }));
    await assert.rejects(drill({ adapter: sample.adapter, directory: sample.directory, backupName, slug: 'bora-school', registry: {} }), /identity or format mismatch/);
  } finally { sample.close(); }
});
