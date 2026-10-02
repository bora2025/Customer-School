'use strict';

const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');
const { fail } = require('../util');

function run(argv) {
  const output = argv[0];
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin keygen <protected-output-directory>\n');
    return;
  }
  if (!output) fail('Missing required <protected-output-directory> argument; use --help');
  const directory = path.resolve(output);
  if (directory === path.parse(directory).root) fail('Refusing to write signing keys to a filesystem root');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePath = path.join(directory, 'plugin-signing-private.pem');
  const publicPath = path.join(directory, 'plugin-signing-public.pem');
  try {
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  } catch (error) {
    fail(error.code === 'EEXIST' ? `A key already exists at ${directory} -- refusing to overwrite` : error.message);
  }
  process.stdout.write(`Generated private key: ${privatePath}\nGenerated public key: ${publicPath}\n`);
}

module.exports = { run };
