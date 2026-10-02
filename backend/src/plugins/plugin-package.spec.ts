import { createHash, generateKeyPairSync, sign } from 'crypto';
import yazl from 'yazl';
import { PluginPackageVerifier, safePackagePath } from './plugin-package';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const trusted = { wattanam: { 'official-test': publicKey } };

const manifest = {
  schemaVersion: 1,
  id: 'wattanam.announcements',
  name: 'Announcements',
  description: 'Official announcement features.',
  version: '1.0.0',
  requiresCore: '>=1.0.0 <2.0.0',
  publisher: 'wattanam',
  license: 'commercial',
  backendEntry: 'backend/index.js',
  capabilities: ['api.routes'],
  permissions: ['wattanam.announcements.read'],
  dependencies: {},
};

function digest(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function zip(entries: Record<string, Buffer>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const [name, value] of Object.entries(entries)) archive.addBuffer(value, name);
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function packageBuffer(options: { extra?: boolean; tamper?: boolean; incompatible?: boolean; wrongSignature?: boolean } = {}) {
  const pluginJson = Buffer.from(JSON.stringify({ ...manifest, ...(options.incompatible ? { requiresCore: '>=2.0.0' } : {}) }));
  const backend = Buffer.from('module.exports = {};');
  const checksums = Buffer.from(JSON.stringify({
    algorithm: 'sha256',
    files: { 'backend/index.js': digest(backend), 'plugin.json': digest(pluginJson) },
  }));
  const signingKey = options.wrongSignature ? generateKeyPairSync('ed25519').privateKey : keys.privateKey;
  const signature = Buffer.from(JSON.stringify({
    algorithm: 'ed25519', publisher: 'wattanam', keyId: 'official-test', signature: sign(null, checksums, signingKey).toString('base64'),
  }));
  return zip({
    'plugin.json': pluginJson,
    'backend/index.js': options.tamper ? Buffer.from('tampered') : backend,
    'checksums.json': checksums,
    'signature.json': signature,
    ...(options.extra ? { 'unexpected.txt': Buffer.from('extra') } : {}),
  });
}

describe('signed plugin packages', () => {
  const verifier = new PluginPackageVerifier();

  it('verifies checksums, publisher signature, and core compatibility', async () => {
    const result = await verifier.verify(await packageBuffer(), trusted, '1.2.0');
    expect(result.manifest.id).toBe('wattanam.announcements');
    expect(result.publisherKeyId).toBe('official-test');
    expect(result.packageSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects tampered payload content', async () => {
    await expect(verifier.verify(await packageBuffer({ tamper: true }), trusted, '1.2.0')).rejects.toThrow('Checksum');
  });

  it('rejects files not declared by the signed checksum manifest', async () => {
    await expect(verifier.verify(await packageBuffer({ extra: true }), trusted, '1.2.0')).rejects.toThrow('exactly match');
  });

  it('rejects an invalid publisher signature', async () => {
    await expect(verifier.verify(await packageBuffer({ wrongSignature: true }), trusted, '1.2.0')).rejects.toThrow('signature is invalid');
  });

  it('rejects a package outside the supported core range', async () => {
    await expect(verifier.verify(await packageBuffer({ incompatible: true }), trusted, '1.2.0')).rejects.toThrow('incompatible');
  });

  it('recognizes unsafe archive paths before extraction', () => {
    expect(safePackagePath('../plugin.json')).toBe(false);
    expect(safePackagePath('/plugin.json')).toBe(false);
    expect(safePackagePath('folder\\plugin.json')).toBe(false);
    expect(safePackagePath('backend/index.js')).toBe(true);
  });
});
