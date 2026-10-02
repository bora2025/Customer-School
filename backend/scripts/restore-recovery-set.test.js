'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { walkDirectoryChecksums } = require('./db-toolkit');

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('recovery restore stages and verifies plugin archives before a failed database restore touches live plugin directories', (t) => {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('tar is unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-recovery-stage-'));
  try {
    const backups = path.join(root, 'backups');
    const pluginSource = path.join(root, 'plugin-source');
    const dataSource = path.join(root, 'data-source');
    const livePlugins = path.join(root, 'live-plugins');
    const liveData = path.join(root, 'live-data');
    for (const directory of [backups, pluginSource, dataSource, livePlugins, liveData]) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(pluginSource, 'plugin.json'), '{"id":"wattanam.test"}');
    fs.writeFileSync(path.join(dataSource, 'state.json'), '{"rows":1}');
    fs.writeFileSync(path.join(livePlugins, 'sentinel.txt'), 'original-plugin');
    fs.writeFileSync(path.join(liveData, 'sentinel.txt'), 'original-data');
    const pluginArchive = path.join(backups, 'plugin-files.tar');
    const dataArchive = path.join(backups, 'plugin-data.tar');
    assert.equal(spawnSync('tar', ['-cf', pluginArchive, '-C', pluginSource, '.']).status, 0);
    assert.equal(spawnSync('tar', ['-cf', dataArchive, '-C', dataSource, '.']).status, 0);
    const database = path.join(backups, 'school.dump');
    fs.writeFileSync(database, 'not-a-real-pg-dump');
    fs.writeFileSync(path.join(backups, 'school.manifest.json'), JSON.stringify({
      format: 'pg_dump-custom-v1', file: 'school.dump', sha256: digest(database), schemaLineage: 'wattanam-legacy-v1',
    }));
    const journal = {
      format: 'wattanam-recovery-set-v1', createdAt: new Date().toISOString(),
      database: { file: 'school.dump', sha256: digest(database), sizeBytes: fs.statSync(database).size },
      pluginFiles: { archive: { file: 'plugin-files.tar', sha256: digest(pluginArchive) }, checksums: walkDirectoryChecksums(pluginSource) },
      pluginData: { archive: { file: 'plugin-data.tar', sha256: digest(dataArchive) }, checksums: walkDirectoryChecksums(dataSource) },
    };
    const journalFile = path.join(backups, 'wattanam-recovery-test.recovery-set.json');
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'restore-recovery-set.js'), '--from', journalFile, '--confirm-target', 'EMPTY', '--yes-replace', '--plugin-dir', livePlugins, '--plugin-data-dir', liveData], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/invalid', WATTANAM_DISTRIBUTION: 'legacy-full' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Staging and verifying plugin archives before database restore/);
    assert.equal(fs.readFileSync(path.join(livePlugins, 'sentinel.txt'), 'utf8'), 'original-plugin');
    assert.equal(fs.readFileSync(path.join(liveData, 'sentinel.txt'), 'utf8'), 'original-data');
    assert.equal(fs.readdirSync(root).filter((name) => name.includes('.wattanam-')).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
