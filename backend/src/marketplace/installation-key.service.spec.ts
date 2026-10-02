import { generateKeyPairSync, verify } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { canonicalJson } from './canonical-json';
import { InstallationKeyService } from './installation-key.service';

describe('InstallationKeyService', () => {
  const originalEnvironment = process.env;
  let keyDir: string;
  let service: InstallationKeyService;

  beforeEach(() => {
    keyDir = mkdtempSync(path.join(os.tmpdir(), 'wattanam-installation-key-'));
    process.env = { ...originalEnvironment, MARKETPLACE_URL: 'https://marketplace.example.com', INSTALLATION_KEY_DIR: keyDir };
    service = new InstallationKeyService();
  });

  afterEach(() => { rmSync(keyDir, { recursive: true, force: true }); });
  afterAll(() => { process.env = originalEnvironment; });

  it('generates a key pair on first use and persists only the private key, restricted to the owner', async () => {
    const info = await service.ensureKeyPair();
    expect(info.publicKeyPem).toContain('PUBLIC KEY');
    const file = path.join(keyDir, 'installation-ed25519.pem');
    const persisted = readFileSync(file, 'utf8');
    expect(persisted).toContain('PRIVATE KEY');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('reuses the same key across calls instead of regenerating it', async () => {
    const first = await service.ensureKeyPair();
    const second = await service.ensureKeyPair();
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('reloads the persisted key for a fresh service instance', async () => {
    const first = await service.ensureKeyPair();
    const reloaded = await new InstallationKeyService().ensureKeyPair();
    expect(reloaded.fingerprint).toBe(first.fingerprint);
  });

  it('produces a verifiable ed25519 signature over the canonical payload', async () => {
    const { publicKeyPem } = await service.ensureKeyPair();
    const payload = { installationId: 'a', challengeId: 'b', nonce: 'c', purpose: 'register' };
    const signature = await service.sign(payload);
    expect(verify(null, Buffer.from(canonicalJson(payload)), publicKeyPem, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it('serializes concurrent first-use calls to a single generated key', async () => {
    const [a, b, c] = await Promise.all([service.ensureKeyPair(), service.ensureKeyPair(), service.ensureKeyPair()]);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(b.fingerprint).toBe(c.fingerprint);
  });

  it('replaces the key pair after a successful rotation and persists the new private key', async () => {
    const before = await service.ensureKeyPair();
    const nextPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const after = await service.replaceKeyPair(nextPrivateKey);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    const reloaded = await new InstallationKeyService().ensureKeyPair();
    expect(reloaded.fingerprint).toBe(after.fingerprint);
  });
});
