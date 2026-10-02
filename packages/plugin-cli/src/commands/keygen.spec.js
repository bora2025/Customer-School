'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./keygen');

describe('wattanam-plugin keygen', () => {
  it('generates a distinct Ed25519 private/public PEM pair', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-keygen-'));
    run([path.join(dir, 'keys')]);
    const privatePem = fs.readFileSync(path.join(dir, 'keys', 'plugin-signing-private.pem'), 'utf8');
    const publicPem = fs.readFileSync(path.join(dir, 'keys', 'plugin-signing-public.pem'), 'utf8');
    expect(privatePem).toContain('PRIVATE KEY');
    expect(publicPem).toContain('PUBLIC KEY');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to overwrite an existing key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-keygen-'));
    run([path.join(dir, 'keys')]);
    expect(() => run([path.join(dir, 'keys')])).toThrow('already exists');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
