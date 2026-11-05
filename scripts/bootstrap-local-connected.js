'use strict';

// Prepares .env.connected.local for docker-compose.local.yml: a source-built core school that
// connects to a local Marketplace on the same Docker host. Only PUBLIC keys are written here;
// the Marketplace private keys stay in the Marketplace workspace.
//
// Usage: node scripts/bootstrap-local-connected.js [path-to-Wattanam-V2]

const { createPublicKey, generateKeyPairSync, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const marketplaceRoot = path.resolve(process.argv[2] || path.join(root, '..', 'Wattanam-V2'));
const marketplaceSecrets = path.join(marketplaceRoot, '.local-secrets');
const envPath = path.join(root, '.env.connected.local');

function publicFromPrivateFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found. Run "npm run local:bootstrap" in ${marketplaceRoot} first.`);
  }
  return createPublicKey(fs.readFileSync(file, 'utf8')).export({ type: 'spki', format: 'pem' }).toString();
}

// Local official-plugin publisher key. It lives with the Marketplace secrets because the
// Marketplace workspace signs the packages; the school receives only its public half.
function publisherPublicKey() {
  const file = path.join(marketplaceSecrets, 'plugin-signing-private.pem');
  if (!fs.existsSync(file)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  return publicFromPrivateFile(file);
}

const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');

if (fs.existsSync(envPath)) {
  process.stdout.write(`${envPath} already exists; leaving it unchanged.\n`);
  process.exit(0);
}

const repositoryKey = publicFromPrivateFile(path.join(marketplaceSecrets, 'repository-signing-private.pem'));
const entitlementKey = publicFromPrivateFile(path.join(marketplaceSecrets, 'entitlement-signing-private.pem'));
const trusted = { wattanam: { 'local-official-plugins': publisherPublicKey().trim() } };

const env = [
  'APP_VERSION=0.2.0-local',
  'APP_URL=http://localhost:3000',
  'WEB_PORT=3000',
  'COOKIE_SECURE=false',
  'POSTGRES_IMAGE=postgres:16-alpine',
  'API_IMAGE=wattanam-core-api:local',
  'WEB_IMAGE=wattanam-core-web:local',
  'GATEWAY_IMAGE=wattanam-core-gateway:local',
  `POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`,
  `JWT_SECRET=${randomBytes(48).toString('base64url')}`,
  'MARKETPLACE_URL=http://host.docker.internal:3010',
  'UPDATE_CHANNEL=beta',
  'UPDATE_REPOSITORY_KEY_ID=local-repository',
  `UPDATE_REPOSITORY_PUBLIC_KEY="${oneLine(repositoryKey)}"`,
  'ENTITLEMENT_KEY_ID=local-entitlement',
  `ENTITLEMENT_PUBLIC_KEY="${oneLine(entitlementKey)}"`,
  `PLUGIN_TRUSTED_KEYS='${JSON.stringify(trusted)}'`,
  '',
].join('\n');

fs.writeFileSync(envPath, env, { mode: 0o600 });
process.stdout.write(`Wrote ${envPath}\n`);
process.stdout.write('Plugin publisher key id: local-official-plugins (publisher "wattanam")\n');
