'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yazl = require('yazl');
const { fail, flagValue, sha256, readPluginFiles } = require('../util');

async function packPlugin({ source, privateKeyFile, keyId, output }) {
  const sourceRoot = path.resolve(source);
  const outputFile = path.resolve(output);
  const files = readPluginFiles(sourceRoot);
  if (!files.has('plugin.json')) throw new Error('plugin.json is required');
  const checksumMap = {};
  for (const name of [...files.keys()].sort()) checksumMap[name] = sha256(files.get(name));
  const checksums = Buffer.from(`${JSON.stringify({ algorithm: 'sha256', files: checksumMap }, null, 2)}\n`);
  const manifest = JSON.parse(files.get('plugin.json').toString('utf8'));
  const privateKey = fs.readFileSync(path.resolve(privateKeyFile), 'utf8');
  const signature = Buffer.from(`${JSON.stringify({
    algorithm: 'ed25519', publisher: manifest.publisher, keyId,
    signature: crypto.sign(null, checksums, privateKey).toString('base64'),
  }, null, 2)}\n`);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const archive = new yazl.ZipFile();
  const stableTime = new Date('1980-01-01T00:00:00.000Z');
  for (const name of [...files.keys()].sort()) archive.addBuffer(files.get(name), name, { mtime: stableTime, mode: 0o100640 });
  archive.addBuffer(checksums, 'checksums.json', { mtime: stableTime, mode: 0o100640 });
  archive.addBuffer(signature, 'signature.json', { mtime: stableTime, mode: 0o100640 });
  archive.end();
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outputFile, { mode: 0o600 });
    archive.outputStream.pipe(stream).on('close', resolve).on('error', reject);
    archive.outputStream.on('error', reject);
  });
  return { output: outputFile, sha256: sha256(fs.readFileSync(outputFile)), publisher: manifest.publisher, version: manifest.version };
}

async function run(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin pack --source <directory> --private-key <pem> --key-id <id> --out <plugin.wtp>\n');
    return;
  }
  const source = flagValue(argv, '--source');
  const privateKeyFile = flagValue(argv, '--private-key');
  const keyId = flagValue(argv, '--key-id');
  const output = flagValue(argv, '--out');
  if (!source || !privateKeyFile || !keyId || !output) fail('Missing required argument; use --help');
  const result = await packPlugin({ source, privateKeyFile, keyId, output });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { run, packPlugin };
