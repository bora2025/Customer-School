'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspect, TARGET_TABLE } = require('./academic-classes-adoption-preflight');
const { journalPath } = require('./academic-classes-adopt');
const { drill, parseInput, routingRegistry } = require('./academic-classes-rollback-drill');

const backupName = 'wattanam-20260916T000000Z.dump';
const classes = [
  {
    id: 'c1',
    name: 'Class A',
    subject: 'Math',
    teacherId: 't1',
    classAdminId: 'a1',
    studyYearId: 'y1',
    schedule: null,
    registrationStatus: 'AVAILABLE',
    thumbnail: null,
    description: null,
    price: null,
    showPrice: false,
    createdAt: null,
    updatedAt: null,
  },
];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-classes-rollback-'));
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
    readClassChunk: async ({ after, limit }) => classes.filter((row) => !after || row.id > after).slice(0, limit),
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
    const identity = `academic-classes:bora-school:${preflight.source.sha256}:${sample.checksum}`;
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

test('fails closed for non-reconciled or mismatched class journal', async () => {
  const sample = fixture();
  try {
    const preflight = await inspect(sample.adapter);
    const identity = `academic-classes:bora-school:${preflight.source.sha256}:${sample.checksum}`;

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
