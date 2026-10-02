import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parsePluginManifest } from './plugin-manifest';

const catalogRoot = path.resolve(__dirname, '..', '..', '..', 'plugins');

describe('official plugin operational contract', () => {
  const pluginDirectories = readdirSync(catalogRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(catalogRoot, entry.name, 'plugin.json')))
    .map((entry) => entry.name)
    .sort();

  it('discovers the complete official catalog', () => {
    expect(pluginDirectories).toHaveLength(13);
  });

  it.each(pluginDirectories)('%s declares support, privacy, pricing, retention, health and backup behavior', async (directory) => {
    const root = path.join(catalogRoot, directory);
    const manifest = parsePluginManifest(JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8')));

    expect(manifest.publisher).toBe('wattanam');
    expect(manifest.supportUrl).toMatch(/^https:\/\//);
    expect(manifest.privacyUrl).toMatch(/^https:\/\//);
    expect(manifest.operational).toBeDefined();
    expect(manifest.operational?.pricing).toBe('marketplace');
    expect(manifest.operational?.uninstall.dataRetention).toBe('preserve');
    expect(manifest.operational?.backup.restore).toBe('required');
    expect(manifest.operational?.dataClassification.length).toBeGreaterThan(0);
    expect(manifest.operational?.backup.database).toBe(manifest.migrations.length ? 'required' : 'none');
    expect(manifest.operational?.backup.files).toBe(
      manifest.capabilities.some((capability) => capability === 'storage.read' || capability === 'storage.write') ? 'required' : 'none',
    );

    expect(manifest.backendEntry).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtime = require(path.join(root, manifest.backendEntry!));
    expect(runtime.id).toBe(manifest.id);
    expect(typeof runtime.health).toBe('function');
    await expect(Promise.resolve(runtime.health())).resolves.toEqual({ status: 'ready' });
  });
});
