'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect } = require('./academic-subjects-adoption-preflight');
const { adopt } = require('./academic-subjects-adopt');
const { rollback, routingRegistry } = require('./academic-subjects-rollback-drill');

test('switches routing to legacy while preserving adopted subjects and the legacy source', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-subject-rollback-'));
  const backupName = 'wattanam-20260925T000000Z.dump';
  const archive = path.join(directory, backupName);
  fs.writeFileSync(archive, 'subject rollback fixture');
  const backupSha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: backupSha }));
  const source = [{ id: 'c1', subject: 'Math' }, { id: 'c2', subject: 'Science' }];
  const target = new Map([['manual', { id: 'manual', code: 'MANUAL', name: 'Manual' }]]);
  const chunk = ({ after, limit }) => source.filter((row) => !after || row.id > after).slice(0, limit);
  const adapter = {
    readClassSubjectChunk: async (args) => chunk(args),
    targetState: async () => ({ table: 'plugin_wattanam_academic_management_subject', exists: true, rowCount: target.size }),
    writeSubjects: async (subjects) => { for (const subject of subjects) target.set(subject.id, subject); },
    readTargetSubjects: async () => [...target.values()].filter((row) => row.id !== 'manual').sort((a, b) => a.id.localeCompare(b.id)),
    findSubjects: async (ids) => ids.filter((id) => target.has(id)).map((id) => ({ id })),
  };
  try {
    target.delete('manual');
    const preflight = await inspect(adapter);
    const confirmation = { slug: 'bora-school', sourceSha256: preflight.source.sha256 };
    await adopt({ adapter, directory, backupName, confirmation });
    target.set('manual', { id: 'manual', code: 'MANUAL', name: 'Manual' });
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const result = await rollback({ adapter, directory, backupName, confirmation, registry });
    assert.equal(result.legacyPreserved, true);
    assert.equal(result.pluginDataPreserved, true);
    assert.equal(result.retained, 2);
    assert.deepEqual(registry, { routeOwner: 'legacy', pluginEnabled: false });
    assert.equal(target.size, 3);
    assert.deepEqual(source, [{ id: 'c1', subject: 'Math' }, { id: 'c2', subject: 'Science' }]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('validates subject route owner', () => {
  assert.deepEqual(routingRegistry('plugin'), { routeOwner: 'plugin', pluginEnabled: true });
  assert.throws(() => routingRegistry('invalid'), /must be legacy or plugin/);
});
