import { promises as fs } from 'fs';
import { generateKeyPairSync } from 'crypto';
import os from 'os';
import path from 'path';
import { parsePluginUiBundle } from './plugin-ui-schema';
import { PluginPackageVerifier } from './plugin-package';
import { PluginEventBus } from './plugin-events';
import { PluginExtensionsService } from './plugin-extensions.service';
import { PluginRuntimeService } from './plugin-runtime.service';

const { run: scaffold } = require('../../../packages/plugin-cli/src/commands/init');
const { packPlugin } = require('../../../packages/plugin-cli/src/commands/pack');

describe('official plugin template UI v2 contract', () => {
  it('scaffolds a valid list, create, detail, edit and print workflow', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-template-v2-'));
    const target = path.join(parent, 'acme.widget');
    try {
      await scaffold(['acme.widget', '--dir', target]);
      const keys = generateKeyPairSync('ed25519');
      const privateKey = path.join(parent, 'private.pem');
      const archive = path.join(parent, 'sample.wtp');
      await fs.writeFile(privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      await packPlugin({ source: target, privateKeyFile: privateKey, keyId: 'sample-key', output: archive });
      const verified = await new PluginPackageVerifier().verify(await fs.readFile(archive), {
        acme: { 'sample-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      }, '0.1.0');
      const descriptor = JSON.parse(verified.files.get('frontend/page.json')!.toString('utf8'));
      const bundle = parsePluginUiBundle(descriptor, verified.manifest.id, new Set(verified.manifest.permissions));
      expect(bundle.pages.map((page) => page.routePath)).toEqual(['records', 'records/:id']);
      expect(bundle.pages[0].components.map((component) => component.type)).toEqual(['heading', 'table', 'form', 'print']);
      expect(bundle.pages[1].components.map((component) => component.type)).toEqual(['detail', 'form']);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it('discovers the signed template at runtime and removes navigation, pages, and routes on disable', async () => {
    const parent = await fs.mkdtemp(path.join(process.cwd(), '.tmp-template-lifecycle-'));
    const source = path.join(parent, 'acme.widget');
    const installedPath = path.join(parent, 'installed', 'acme.widget', '0.1.0');
    const originalEnvironment = process.env;
    try {
      await scaffold(['acme.widget', '--dir', source]);
      const keys = generateKeyPairSync('ed25519');
      const privateKey = path.join(parent, 'private.pem');
      const archive = path.join(parent, 'sample.wtp');
      await fs.writeFile(privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      await packPlugin({ source, privateKeyFile: privateKey, keyId: 'sample-key', output: archive });
      const verified = await new PluginPackageVerifier().verify(await fs.readFile(archive), {
        acme: { 'sample-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      }, '0.1.0');
      for (const [relativePath, contents] of verified.files) {
        const destination = path.join(installedPath, ...relativePath.split('/'));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, contents);
      }

      process.env = {
        ...originalEnvironment,
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/template-lifecycle',
        APP_VERSION: '0.1.0',
        PLUGIN_DIR: path.join(parent, 'installed'),
        PLUGIN_TRUSTED_KEYS: '{}',
      };
      const grants = { isGranted: jest.fn().mockResolvedValue(true) } as any;
      const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const extensions = new PluginExtensionsService(grants, audit);
      const prisma = {
        pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'acme.widget', version: '0.1.0', installedPath }) },
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      } as any;
      const runtime = new PluginRuntimeService(
        prisma,
        { verifyInstalledDirectory: jest.fn().mockResolvedValue(verified) } as any,
        new PluginEventBus(), extensions,
        { register: jest.fn(), clear: jest.fn().mockResolvedValue(undefined) } as any,
        { get: jest.fn(), set: jest.fn(), delete: jest.fn() } as any,
        { readText: jest.fn(), writeText: jest.fn(), delete: jest.fn(), list: jest.fn() } as any,
        { sendEmail: jest.fn(), sendSms: jest.fn(), notifyInApp: jest.fn() } as any,
        { resolveAudience: jest.fn(), lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn() } as any,
        { notifyUser: jest.fn() } as any,
        { recordAndCheck: jest.fn().mockResolvedValue({ allowed: true, count: 1, limit: 200 }) } as any,
        audit,
      );

      await runtime.load('acme.widget');
      const enabled = await extensions.listForPrincipal('SUPER_ADMIN');
      expect(enabled.navigation).toEqual(expect.arrayContaining([expect.objectContaining({ href: '/plugins/acme.widget/records' })]));
      expect(enabled.pages.map((page) => page.routePath)).toEqual(['records', 'records/:id']);
      await expect(extensions.dispatch('acme.widget', {
        method: 'GET', path: 'records', params: {}, query: {}, body: null,
        principal: { userId: 'admin-1', role: 'SUPER_ADMIN' },
      })).resolves.toEqual([]);

      await runtime.unload('acme.widget');
      await expect(extensions.listForPrincipal('SUPER_ADMIN')).resolves.toEqual({ navigation: [], pages: [] });
      await expect(extensions.dispatch('acme.widget', {
        method: 'GET', path: 'records', params: {}, query: {}, body: null,
        principal: { userId: 'admin-1', role: 'SUPER_ADMIN' },
      })).rejects.toThrow('not found');
    } finally {
      process.env = originalEnvironment;
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});
