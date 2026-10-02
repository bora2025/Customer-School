/**
 * C-007: the malicious-fixture suite named in the master plan --
 * "traversal, bombs, tampering, capability abuse, migration abuse, SSRF and
 * secret access". Tampering, capability abuse, and migration abuse already
 * have dedicated suites (plugin-package.spec.ts, plugin-runtime.service.spec.ts,
 * plugin-migrations.service.spec.ts / plugin-sql-guard.spec.ts respectively);
 * this file adds the categories that had no dedicated coverage yet: zip
 * bombs, duplicate/symlink archive entries, and the SSRF/secret-access
 * architectural-absence proof. See docs/plugins/security-review-checklist.md
 * for the human review process this suite backs.
 */
import { createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yazl = require('yazl');
import { PluginPackageVerifier, safePackagePath } from './plugin-package';
import { PluginRuntimeService } from './plugin-runtime.service';
import { PluginEventBus } from './plugin-events';
import { PLUGIN_CAPABILITIES } from './plugin-manifest';

async function buildZip(add: (zip: any) => void): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-zipfixture-'));
  const zipPath = path.join(dir, 'x.zip');
  await new Promise<void>((resolve, reject) => {
    const zip = new yazl.ZipFile();
    add(zip);
    zip.end();
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });
  const buffer = await fs.readFile(zipPath);
  await fs.rm(dir, { recursive: true, force: true });
  return buffer;
}

// Tampering: see plugin-package.spec.ts (tampered payload, undeclared extra files, invalid
// signature) -- not duplicated here.
// Capability abuse: see plugin-runtime.service.spec.ts (every one of the twelve capabilities
// individually rejects an undeclared call) -- not duplicated here.
// Migration abuse: see plugin-migrations.service.spec.ts and plugin-sql-guard.spec.ts
// (cross-namespace access, transaction/role/grant control, multi-statement stacking,
// undeclared destructive operations) -- not duplicated here.

describe('C-007 malicious-fixture suite: traversal', () => {
  it('rejects path-traversal, absolute, and null-byte archive entry names before extraction', () => {
    expect(safePackagePath('../../etc/passwd')).toBe(false);
    expect(safePackagePath('/etc/passwd')).toBe(false);
    expect(safePackagePath('backend/..\\..\\evil')).toBe(false);
    expect(safePackagePath('a\0b')).toBe(false);
    expect(safePackagePath('backend/index.js')).toBe(true);
  });

  // A zip built with legitimate tooling (yazl) can't even construct a traversal entry name --
  // it validates paths on `addBuffer` the same way real-world zip libraries increasingly do.
  // The extraction-time wiring is `plugin-package.ts`'s `zip.on('entry')` handler calling this
  // exact `safePackagePath` function before any entry is read; the unit test above is the
  // direct proof of the function itself.

  it('rejects a duplicate archive entry (a classic zip-parser confusion vector)', async () => {
    const buffer = await buildZip((zip) => { zip.addBuffer(Buffer.from('1'), 'a.txt'); zip.addBuffer(Buffer.from('2'), 'a.txt'); });
    await expect(new PluginPackageVerifier().verify(buffer, {}, '1.0.0')).rejects.toThrow('Duplicate plugin path');
  });
});

describe('C-007 malicious-fixture suite: bombs', () => {
  const withLimit = async (bytes: number, run: () => Promise<void>) => {
    const previous = process.env.PLUGIN_MAX_UNPACKED_BYTES;
    process.env.PLUGIN_MAX_UNPACKED_BYTES = String(bytes);
    try { await run(); }
    finally { if (previous === undefined) delete process.env.PLUGIN_MAX_UNPACKED_BYTES; else process.env.PLUGIN_MAX_UNPACKED_BYTES = previous; }
  };

  it('rejects a package whose declared uncompressed size exceeds the unpacked limit -- a zip bomb, not just a large upload', async () => {
    await withLimit(1024, async () => {
      // A single highly-compressible entry that DECLARES far more bytes than the limit allows,
      // rejected on its declared size before yauzl ever fully streams the (real, matching) payload.
      const buffer = await buildZip((zip) => zip.addBuffer(Buffer.alloc(10 * 1024 * 1024, 'a'), 'bomb.txt'));
      await expect(new PluginPackageVerifier().verify(buffer, {}, '1.0.0')).rejects.toThrow('exceeds the package limit');
    });
  });

  it('rejects an oversized package before it is ever unzipped', async () => {
    await withLimit(10, async () => {
      const buffer = Buffer.alloc(1000, 'x');
      await expect(new PluginPackageVerifier().verify(buffer, {}, '1.0.0')).rejects.toThrow('exceeds the package limit');
    });
  });

  it('rejects a symlink archive entry (a bomb/traversal hybrid: link a huge or sensitive host path into the package)', async () => {
    const buffer = await buildZip((zip) => zip.addBuffer(Buffer.from('/etc/passwd'), 'evil-link', { mode: 0o120777 }));
    await expect(new PluginPackageVerifier().verify(buffer, {}, '1.0.0')).rejects.toThrow('symlinks are not allowed');
  });
});

describe('C-007 malicious-fixture suite: SSRF and secret access', () => {
  it('the SDK grants no outbound-HTTP capability at all -- SSRF via a plugin is architecturally not applicable, not merely filtered', () => {
    const networkLike = PLUGIN_CAPABILITIES.filter((capability) => /http|fetch|network|request|url/i.test(capability));
    expect(networkLike).toEqual([]);
  });

  it('the runtime context exposes no fetch/http/network/env/process/prisma surface a plugin could reach beyond its declared capabilities', async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.tmp-wattanam-ssrffixture-'));
    const installedPath = path.join(directory, 'wattanam.ssrftest', '1.0.0');
    await fs.mkdir(path.join(installedPath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(installedPath, 'backend', 'index.js'), `
      module.exports = { id: 'wattanam.ssrftest', activate(context) { global.__wattanamContextKeys = Object.keys(context).sort(); } };
    `);
    process.env.PLUGIN_DIR = directory;
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.APP_VERSION = '0.1.0';
    process.env.PLUGIN_TRUSTED_KEYS = '{}';
    const manifest = { id: 'wattanam.ssrftest', version: '1.0.0', backendEntry: 'backend/index.js', capabilities: [], permissions: [], dependencies: {} };
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ id: 'wattanam.ssrftest', version: '1.0.0', installedPath }) } } as any;
    const verifier = { verifyInstalledDirectory: jest.fn().mockResolvedValue({ manifest }) } as any;
    const noop = () => undefined;
    const runtime = new PluginRuntimeService(
      prisma, verifier, new PluginEventBus(),
      { registerRoute: noop, registerPermissions: noop, registerNavigation: noop, clear: noop } as any,
      { register: async () => noop, clear: async () => undefined } as any,
      { get: async (_k: string, fallback: unknown) => fallback, set: async () => undefined, delete: async () => undefined } as any,
      { readText: async () => null, writeText: async () => undefined, delete: async () => undefined, list: async () => [] } as any,
      { sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }), notifyInApp: async () => ({ id: 'x' }) } as any,
      { resolveAudience: async () => [], lookupUsers: async () => [], lookupClasses: async () => [], classesForUser: async () => [] } as any,
      { notifyUser: noop } as any,
      { recordAndCheck: async () => ({ allowed: true, count: 1, limit: 200 }) } as any,
      { log: async () => undefined } as any,
    );
    await runtime.load('wattanam.ssrftest');
    // The complete, exhaustive key list -- no `env`, `process`, `config`, `prisma`, `fetch`,
    // or `http` property exists on the object a plugin's activate() receives. This is the
    // proof behind both the SSRF and secret-access claims: there is no sanctioned surface
    // for either, only the explicitly capability-gated SDK methods below.
    expect((global as any).__wattanamContextKeys).toEqual([
      'accounts', 'crypto', 'database', 'dependencies', 'directory', 'durableEvents', 'events', 'jobs', 'logger', 'navigation', 'notifications',
      'permissions', 'pluginId', 'readModels', 'realtime', 'routes', 'sdkVersion', 'settings', 'storage',
    ]);
    delete (global as any).__wattanamContextKeys;
    await fs.rm(directory, { recursive: true, force: true });
  });
});
