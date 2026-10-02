'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect } = require('./academic-enrollment-adopt');
const { drill, journalPath, parseInput, routingRegistry } = require('./academic-enrollment-rollback-drill');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-enrollment-rollback-'));
  const backupName = 'wattanam-20260925T000000Z.dump';
  const archive = path.join(directory, backupName); fs.writeFileSync(archive, 'enrollment rollback backup');
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: checksum }));
  const rows = [{ studentId: 's1', classId: 'c1', createdAt: '2026-01-02T00:00:00Z' }];
  const adapter = { readAllSource: async () => rows, targetState: async () => ({ table: 'plugin_wattanam_academic_management_enrollment_interval', exists: true, rowCount: 1 }) };
  return { directory, backupName, checksum, adapter, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('requires explicit enrollment rollback approval and a valid owner', () => {
  assert.throws(() => parseInput({ ACADEMIC_SCHOOL_SLUG: 'bora-school' }), /ROLLBACK_DRILL=true/);
  assert.throws(() => routingRegistry('automatic'), /must be legacy or plugin/);
});

test('returns roster reads to legacy while preserving both datasets', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const identity = `academic-enrollment:bora-school:${preflight.source.sha256}:${sample.checksum}`;
    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity, stage: 'reconciled', backupSha256: sample.checksum }));
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const result = await drill({ ...sample, slug: 'bora-school', registry });
    assert.equal(result.rolledBack, true); assert.deepEqual(registry, { routeOwner: 'legacy', pluginEnabled: false });
    assert.equal(result.journal.stage, 'rolled_back'); assert.equal((await sample.adapter.readAllSource()).length, 1); assert.equal((await sample.adapter.targetState()).rowCount, 1);
  } finally { sample.close(); }
});

test('fails closed without a reconciled, backup-bound journal', async () => {
  const sample = fixture();
  try {
    await assert.rejects(drill({ ...sample, slug: 'bora-school', registry: {} }), /journal is absent/);
    const preflight = await inspect(sample.adapter), identity = `academic-enrollment:bora-school:${preflight.source.sha256}:${sample.checksum}`;
    fs.writeFileSync(journalPath(sample.directory, 'bora-school'), JSON.stringify({ format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', backupSha256: sample.checksum }));
    await assert.rejects(drill({ ...sample, slug: 'bora-school', registry: {} }), /not reconciled/);
  } finally { sample.close(); }
});

