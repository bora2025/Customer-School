import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { PLUGIN_UI_CSP, pluginUiAssetPath, pluginUiResponseHeaders, readVerifiedPluginUiAsset } from './plugin-ui-assets';
import { PluginUiAssetsController } from './plugin-ui-assets.controller';
import { parsePluginUiBundle } from './plugin-ui-schema';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('plugin UI assets (sandboxed plugin-owned screens)', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-ui-'));
    await fs.mkdir(path.join(root, 'ui', 'js'), { recursive: true });
    const files: Record<string, string> = { 'ui/index.html': '<!doctype html><script src="js/app.js"></script>', 'ui/js/app.js': 'console.log(1)', 'plugin.json': '{}' };
    for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(root, name), content);
    await fs.writeFile(path.join(root, 'ui', 'unsigned.js'), 'not in checksums');
    await fs.writeFile(path.join(root, 'checksums.json'), JSON.stringify({ algorithm: 'sha256', files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha(content)])) }));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('accepts only plain ui/ paths with an allowed file type', () => {
    expect(pluginUiAssetPath('ui/index.html')).toBe('ui/index.html');
    expect(pluginUiAssetPath('ui/js/app.js')).toBe('ui/js/app.js');
    for (const bad of ['plugin.json', 'backend/index.js', 'ui/../plugin.json', 'ui/./a.js', 'ui/.env', 'ui//a.js', 'ui/a.php', 'ui/a.js%00', 'ui\\a.js', 'ui', '']) {
      expect(pluginUiAssetPath(bad)).toBeNull();
    }
  });

  it('locks every response into an opaque-origin sandbox with no network access', () => {
    const headers = pluginUiResponseHeaders('text/html; charset=utf-8');
    expect(PLUGIN_UI_CSP).toContain("connect-src 'none'");
    expect(PLUGIN_UI_CSP).toContain("frame-ancestors 'self'");
    expect(PLUGIN_UI_CSP).toMatch(/sandbox allow-scripts/);
    expect(PLUGIN_UI_CSP).not.toContain('allow-same-origin');
    expect(PLUGIN_UI_CSP).not.toContain('allow-top-navigation');
    expect(PLUGIN_UI_CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toBe(PLUGIN_UI_CSP);
  });

  it('serves only files that match the signed checksums', async () => {
    await expect(readVerifiedPluginUiAsset(root, 'ui/js/app.js')).resolves.toMatchObject({ contentType: 'text/javascript; charset=utf-8' });
    await expect(readVerifiedPluginUiAsset(root, 'ui/unsigned.js')).resolves.toBeNull();
    await expect(readVerifiedPluginUiAsset(root, 'ui/missing.js')).resolves.toBeNull();
    await fs.writeFile(path.join(root, 'ui', 'js', 'app.js'), 'tampered after install');
    await expect(readVerifiedPluginUiAsset(root, 'ui/js/app.js')).rejects.toThrow(/does not match its signed checksum/);
  });

  describe('controller', () => {
    const response = () => { const headers: Record<string, string> = {}; let sent: Buffer | undefined; return { headers, get sent() { return sent; }, setHeader: (k: string, v: string) => { headers[k] = v; }, removeHeader: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn((body: Buffer) => { sent = body; }) }; };
    const controller = (record: unknown) => new PluginUiAssetsController({ pluginInstallation: { findUnique: jest.fn().mockResolvedValue(record) } } as any);
    const request = (splat: string[]) => ({ params: { splat } }) as any;

    it('serves an active plugin at its exact installed version', async () => {
      const res = response();
      await controller({ id: 'wattanam.demo', status: 'active', version: '1.2.3', installedPath: root }).asset('wattanam.demo', '1.2.3', request(['ui', 'index.html']), res as any);
      expect(res.sent?.toString()).toContain('<!doctype html>');
      expect(res.headers['Content-Security-Policy']).toBe(PLUGIN_UI_CSP);
      expect(res.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    });

    it.each([
      ['an inactive plugin', { id: 'wattanam.demo', status: 'inactive', version: '1.2.3' }, '1.2.3', ['ui', 'index.html']],
      ['another version', { id: 'wattanam.demo', status: 'active', version: '1.2.4' }, '1.2.3', ['ui', 'index.html']],
      ['a non-ui file', { id: 'wattanam.demo', status: 'active', version: '1.2.3' }, '1.2.3', ['plugin.json']],
      ['an unknown plugin', null, '1.2.3', ['ui', 'index.html']],
    ])('returns 404 for %s', async (_name, record, version, splat) => {
      await expect(controller(record && { ...record, installedPath: root }).asset('wattanam.demo', version as string, request(splat as string[]), response() as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('app component schema', () => {
    const bundle = (options: unknown, extra: Record<string, unknown> = {}) => ({
      schemaVersion: 2, kind: 'declarative-ui', portability: 'universal',
      pages: [{ id: 'sessions', title: 'Sessions', routePath: 'sessions', permission: 'wattanam.demo.view', parameters: [], dataSources: [], components: [{ id: 'app', type: 'app', options, ...extra }] }],
    });
    const permissions = new Set(['wattanam.demo.view']);

    it('accepts a universal app component pointing at ui/<path>.html', () => {
      const page = parsePluginUiBundle(bundle({ entry: 'ui/sessions/index.html', height: 'auto', minHeight: 400 }), 'wattanam.demo', permissions).pages[0];
      expect(page.components[0]).toMatchObject({ type: 'app', options: { entry: 'ui/sessions/index.html' } });
    });

    it.each([
      [{ entry: 'backend/index.js' }], [{ entry: 'ui/../plugin.json' }], [{ entry: 'ui/index.js' }], [{ entry: 'UI/index.html' }],
      [{ entry: 'ui/index.html', height: 'huge' }], [{ entry: 'ui/index.html', minHeight: 10 }], [{ entry: 'ui/index.html', sandbox: 'allow-same-origin' }], [undefined],
    ])('refuses unsafe options %j', (options) => {
      expect(() => parsePluginUiBundle(bundle(options), 'wattanam.demo', permissions)).toThrow();
    });

    it('accepts the device services a screen declares', () => {
      for (const devices of [['scanner'], ['location'], ['scanner', 'location'], []]) {
        const page = parsePluginUiBundle(bundle({ entry: 'ui/scan/index.html', devices }), 'wattanam.demo', permissions).pages[0];
        expect(page.components[0].options).toMatchObject({ devices });
      }
    });

    it.each([
      [['camera']], [['microphone']], [['scanner', 'scanner']], ['scanner'], [[1]], [{ scanner: true }], [['scanner', 'location', 'hid']],
    ])('refuses device declarations the host does not provide: %j', (devices) => {
      expect(() => parsePluginUiBundle(bundle({ entry: 'ui/scan/index.html', devices }), 'wattanam.demo', permissions)).toThrow(/devices must be a list of: scanner, location/);
    });
  });
});
