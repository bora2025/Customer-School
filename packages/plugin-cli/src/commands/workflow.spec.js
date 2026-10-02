'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run: init } = require('./init');
const { run: validate } = require('./validate');
const { run: testPlugin } = require('./test-plugin');
const { run: keygen } = require('./keygen');
const { packPlugin } = require('./pack');
const { inspectPackage } = require('./inspect');

describe('complete package CLI workflow', () => {
  let root;
  let source;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-workflow-'));
    source = path.join(root, 'acme.widget');
    await init(['acme.widget', '--dir', source]);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('supports init, validate, test, pack and inspect before publication', async () => {
    await expect(validate([source])).resolves.toBeUndefined();
    await expect(testPlugin([source])).resolves.toBeUndefined();
    const keyDir = path.join(root, 'keys');
    keygen([keyDir]);
    const packageFile = path.join(root, 'dist', 'acme-widget-0.1.0.wtp');
    await packPlugin({
      source,
      privateKeyFile: path.join(keyDir, 'plugin-signing-private.pem'),
      keyId: 'acme-2026',
      output: packageFile,
    });
    const result = await inspectPackage(packageFile);
    expect(result).toMatchObject({
      id: 'acme.widget', version: '0.1.0', publisher: 'acme', keyId: 'acme-2026', checksumsValid: true,
    });
    expect(result.files).toContain('migrations/001_create_widget.sql');
    expect(result.files).toContain('translations/km.json');
  });

  it('rejects an invalid package archive', async () => {
    const invalid = path.join(root, 'not-a-package.wtp');
    fs.writeFileSync(invalid, 'not a zip');
    await expect(inspectPackage(invalid)).rejects.toThrow();
  });
});
