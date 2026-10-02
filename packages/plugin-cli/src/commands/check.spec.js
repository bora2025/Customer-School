'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run: init } = require('./init');
const { run: check } = require('./check');

describe('wattanam-plugin check', () => {
  let dir;
  let logs;
  let originalWrite;

  beforeEach(async () => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-check-')), 'acme.widget');
    await init(['acme.widget', '--dir', dir]);
    logs = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { logs.push(String(chunk)); return true; };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it('passes a freshly scaffolded plugin', async () => {
    await check([dir]);
    expect(logs.join('')).toContain('ALL CHECKS PASSED');
    expect(logs.join('')).not.toMatch(/^FAIL/m);
  });

  it('fails and reports the exact reason when plugin.json is invalid', async () => {
    const manifestPath = path.join(dir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.capabilities = ['http.fetch'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(check([dir])).rejects.toThrow('check(s) failed');
    expect(logs.join('')).toContain('unsupported capability');
  });

  it('fails when a declared migration checksum does not match the file on disk', async () => {
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'migrations', '001_x.sql'), '-- wattanam-plugin-migration: 001_x\nCREATE TABLE "plugin_acme_widget_x" ("id" TEXT PRIMARY KEY);');
    const manifestPath = path.join(dir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.migrations = [{ id: '001_x', path: 'migrations/001_x.sql', checksum: 'a'.repeat(64), destructive: false }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(check([dir])).rejects.toThrow('check(s) failed');
    expect(logs.join('')).toContain('CHECK(S) FAILED');
    expect(logs.join('')).toContain('migration checksum matches plugin.json');
  });

  it('fails when the runtime omits its declared operational health check', async () => {
    const backendPath = path.join(dir, 'backend', 'index.js');
    const backend = fs.readFileSync(backendPath, 'utf8');
    fs.writeFileSync(backendPath, backend.replace(/\n\s*health\(\) \{[\s\S]*?\n\s*\},\n\};\s*$/, '\n};\n'));
    await expect(check([dir])).rejects.toThrow('check(s) failed');
    expect(logs.join('')).toContain('backend entry exports the declared health check');
  });
});
