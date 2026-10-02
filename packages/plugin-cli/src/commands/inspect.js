'use strict';

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { fail, sha256 } = require('../util');

const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const REQUIRED_FILES = ['plugin.json', 'checksums.json', 'signature.json'];

function readArchive(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const files = new Map();
      let settled = false;
      const abort = (error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on('error', abort);
      zip.on('entry', (entry) => {
        const normalized = entry.fileName.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) return abort(new Error(`Unsafe archive path: ${entry.fileName}`));
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) return abort(new Error(`Archive entry exceeds ${MAX_ENTRY_BYTES} bytes: ${entry.fileName}`));
        if (files.has(normalized)) return abort(new Error(`Duplicate archive entry: ${normalized}`));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return abort(streamError);
          const chunks = [];
          let size = 0;
          stream.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_ENTRY_BYTES) stream.destroy(new Error(`Archive entry exceeds ${MAX_ENTRY_BYTES} bytes: ${entry.fileName}`));
            else chunks.push(chunk);
          });
          stream.on('error', abort);
          stream.on('end', () => {
            files.set(normalized, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(files);
      });
      zip.readEntry();
    });
  });
}

async function inspectPackage(packageFile) {
  const archivePath = path.resolve(packageFile);
  const files = await readArchive(archivePath);
  for (const name of REQUIRED_FILES) if (!files.has(name)) throw new Error(`Package is missing ${name}`);
  const manifest = JSON.parse(files.get('plugin.json').toString('utf8'));
  const checksums = JSON.parse(files.get('checksums.json').toString('utf8'));
  const signature = JSON.parse(files.get('signature.json').toString('utf8'));
  if (checksums.algorithm !== 'sha256' || !checksums.files || typeof checksums.files !== 'object') throw new Error('Invalid checksums.json');
  for (const [name, expected] of Object.entries(checksums.files)) {
    if (!files.has(name)) throw new Error(`Checksummed file is missing: ${name}`);
    if (sha256(files.get(name)) !== expected) throw new Error(`Checksum mismatch: ${name}`);
  }
  const unsigned = [...files.keys()].filter((name) => !REQUIRED_FILES.slice(1).includes(name) && !Object.hasOwn(checksums.files, name));
  if (unsigned.length) throw new Error(`Unsigned payload file(s): ${unsigned.join(', ')}`);
  return {
    package: archivePath,
    sha256: sha256(fs.readFileSync(archivePath)),
    id: manifest.id,
    version: manifest.version,
    sdkVersion: manifest.sdkVersion,
    publisher: manifest.publisher,
    keyId: signature.keyId,
    algorithm: signature.algorithm,
    files: Object.keys(checksums.files).sort(),
    checksumsValid: true,
  };
}

async function run(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin inspect <plugin.wtp>\n');
    return;
  }
  if (!argv[0]) fail('Missing required <plugin.wtp> argument');
  process.stdout.write(`${JSON.stringify(await inspectPackage(argv[0]), null, 2)}\n`);
}

module.exports = { inspectPackage, run };
