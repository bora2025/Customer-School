'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');
const { run: init } = require('./init');
const { run: keygen } = require('./keygen');
const { packPlugin } = require('./pack');

function readZipEntries(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map();
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

describe('wattanam-plugin pack', () => {
  it('produces a .wtp whose signature verifies against the public key and whose checksums match every payload file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-pack-'));
    const source = path.join(root, 'acme.widget');
    await init(['acme.widget', '--dir', source]);
    keygen([path.join(root, 'keys')]);

    const out = path.join(root, 'dist', 'acme-widget-0.1.0.wtp');
    const result = await packPlugin({
      source, privateKeyFile: path.join(root, 'keys', 'plugin-signing-private.pem'), keyId: 'test-key-2026', output: out,
    });
    expect(result.publisher).toBe('acme');
    expect(fs.existsSync(out)).toBe(true);

    const files = await readZipEntries(out);
    expect(files.has('plugin.json')).toBe(true);
    expect(files.has('checksums.json')).toBe(true);
    expect(files.has('signature.json')).toBe(true);
    expect(files.has('backend/index.js')).toBe(true);

    const checksums = JSON.parse(files.get('checksums.json').toString('utf8'));
    for (const [name, expectedHash] of Object.entries(checksums.files)) {
      const actual = crypto.createHash('sha256').update(files.get(name)).digest('hex');
      expect(actual).toBe(expectedHash);
    }

    const signature = JSON.parse(files.get('signature.json').toString('utf8'));
    const publicKey = fs.readFileSync(path.join(root, 'keys', 'plugin-signing-public.pem'), 'utf8');
    const valid = crypto.verify(null, files.get('checksums.json'), publicKey, Buffer.from(signature.signature, 'base64'));
    expect(valid).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
