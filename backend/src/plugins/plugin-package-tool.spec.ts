import { generateKeyPairSync } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PluginPackageVerifier } from './plugin-package';

// The public @wattanam/plugin-cli's packer (C-008) -- retired the internal
// backend/scripts/plugin-package.js in its favor. This test is the
// permanent proof that the CLI's pack output stays byte-compatible with the
// real backend verifier, not just internally self-consistent.
const { packPlugin } = require('../../../packages/plugin-cli/src/commands/pack');
const { run: scaffoldPlugin } = require('../../../packages/plugin-cli/src/commands/init');

describe('plugin packaging tool', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-pack-test-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('packages and verifies a source-independent scaffolded plugin', async () => {
    const keys = generateKeyPairSync('ed25519');
    const source = path.join(directory, 'acme.packaging-proof');
    const privateKey = path.join(directory, 'private.pem');
    const output = path.join(directory, 'packaging-proof.wtp');
    const secondOutput = path.join(directory, 'packaging-proof-second.wtp');
    await scaffoldPlugin(['acme.packaging-proof', '--dir', source]);
    await fs.writeFile(privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const packed = await packPlugin({
      source,
      privateKeyFile: privateKey,
      keyId: 'test-key',
      output,
    });
    const result = await new PluginPackageVerifier().verify(
      await fs.readFile(output),
      { acme: { 'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() } },
      '0.1.0',
    );
    const second = await packPlugin({
      source,
      privateKeyFile: privateKey,
      keyId: 'test-key',
      output: secondOutput,
    });

    expect(packed.sha256).toBe(result.packageSha256);
    expect(second.sha256).toBe(packed.sha256);
    expect(result.manifest.id).toBe('acme.packaging-proof');
    expect(result.files.has('backend/index.js')).toBe(true);
  });
});
