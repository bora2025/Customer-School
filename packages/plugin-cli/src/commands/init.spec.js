'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./init');

describe('wattanam-plugin init', () => {
  it('scaffolds a plugin project with the id substituted throughout', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-init-'));
    const dest = path.join(parent, 'acme.widget');
    await run(['acme.widget', '--dir', dest]);

    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'plugin.json'), 'utf8'));
    expect(manifest.id).toBe('acme.widget');
    expect(manifest.publisher).toBe('acme');
    expect(manifest.navigation[0].href).toBe('/plugins/acme.widget/records');
    expect(manifest.sdkVersion).toBe('1.1.0');
    expect(manifest.supportedLanguages).toEqual(['en', 'km']);
    expect(manifest.operational).toEqual({
      healthCheck: 'runtime', dataClassification: ['personal-data'],
      backup: { database: 'required', files: 'none', restore: 'required' },
      uninstall: { dataRetention: 'preserve' }, pricing: 'marketplace',
    });
    expect(manifest.migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);

    const backend = fs.readFileSync(path.join(dest, 'backend', 'index.js'), 'utf8');
    expect(backend).toContain("id: 'acme.widget'");
    expect(fs.existsSync(path.join(dest, 'frontend', 'page.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'translations', 'en.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'translations', 'km.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'docs', 'permissions.md'))).toBe(true);
    const frontend = JSON.parse(fs.readFileSync(path.join(dest, 'frontend', 'page.json'), 'utf8'));
    expect(frontend.schemaVersion).toBe(2);
    expect(frontend.kind).toBe('declarative-ui');
    expect(frontend.pages.map((page) => page.routePath)).toEqual(['records', 'records/:id']);
    expect(frontend.pages[0].components.map((component) => component.type)).toEqual(['heading', 'table', 'form', 'print']);

    const dashedDest = path.join(parent, 'acme.sample-plugin');
    await run(['acme.sample-plugin', '--dir', dashedDest]);
    expect(fs.readFileSync(path.join(dashedDest, 'migrations', '001_create_widget.sql'), 'utf8')).toContain('plugin_acme_sample_plugin_widget');
    expect(fs.readFileSync(path.join(dashedDest, 'migrations', '001_create_widget.sql'), 'utf8')).toContain('"status" TEXT NOT NULL');
    expect(fs.readFileSync(path.join(dashedDest, 'backend', 'index.js'), 'utf8')).not.toContain('sample-plugin_widget');

    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('refuses to scaffold into a non-empty directory', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-init-'));
    fs.writeFileSync(path.join(parent, 'existing.txt'), 'x');
    expect(() => run(['acme.widget', '--dir', parent])).toThrow('already exists and is not empty');
    fs.rmSync(parent, { recursive: true, force: true });
  });
});
