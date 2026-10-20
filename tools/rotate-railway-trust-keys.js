'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FAMILIES = {
  update: { id: 'UPDATE_REPOSITORY_KEY_ID', primary: 'UPDATE_REPOSITORY_PUBLIC_KEY', secondary: 'UPDATE_REPOSITORY_PUBLIC_KEYS_JSON' },
  entitlement: { id: 'ENTITLEMENT_KEY_ID', primary: 'ENTITLEMENT_PUBLIC_KEY', secondary: 'ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON' },
};
function option(argv, name) { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; }
function railwayBinary(platform = process.platform) { return platform === 'win32' ? 'railway.cmd' : 'railway'; }
function normalizePem(value) { return String(value || '').replace(/\r\n/g, '\n').trim(); }
function parseSecondary(value) {
  if (!value) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('secondary trust bundle must be a JSON object');
  return parsed;
}
function buildRotationValues(family, current, newKeyId, newPublicKey) {
  const names = FAMILIES[family];
  if (!names) throw new Error('--family must be update or entitlement');
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(newKeyId || '')) throw new Error('--new-key-id is invalid');
  const pem = normalizePem(newPublicKey);
  if (!pem.includes('BEGIN PUBLIC KEY') || !pem.includes('END PUBLIC KEY')) throw new Error('new public key file is not a PEM public key');
  const currentId = String(current[names.id] || '').trim();
  const currentPem = normalizePem(current[names.primary]);
  if (!currentId || !currentPem) throw new Error(`current ${family} primary trust key is incomplete`);
  const secondary = parseSecondary(current[names.secondary]);
  if (currentId !== newKeyId) secondary[currentId] = currentPem;
  delete secondary[newKeyId];
  return { [names.secondary]: JSON.stringify(secondary), [names.id]: newKeyId, [names.primary]: pem };
}
function assertParity(api, worker, family) {
  const names = FAMILIES[family];
  for (const name of Object.values(names)) {
    const left = name.endsWith('_JSON') ? JSON.stringify(parseSecondary(api[name])) : normalizePem(api[name]);
    const right = name.endsWith('_JSON') ? JSON.stringify(parseSecondary(worker[name])) : normalizePem(worker[name]);
    if (left !== right) throw new Error(`${name} differs between API and worker; repair parity before rotation`);
  }
}
function command(args, input) {
  const result = spawnSync(railwayBinary(), args, { input, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  if (result.status !== 0) throw new Error(`Railway command failed (${args[0]}): ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
function setSecret(service, environment, name, value) {
  command(['variable', 'set', name, '--stdin', '--service', service, '--environment', environment, '--skip-deploys', '--json'], `${value}\n`);
}
function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: npm run trust:rotate:railway -- --environment <name> --family <update|entitlement> --new-key-id <id> --new-public-key-file <pem> [--execute --confirm-environment <name>]\n');
    return;
  }
  const environment = option(argv, 'environment');
  const family = option(argv, 'family');
  const newKeyId = option(argv, 'new-key-id');
  const keyFile = option(argv, 'new-public-key-file');
  const execute = argv.includes('--execute');
  if (!environment || !/^[a-z0-9][a-z0-9-]*$/.test(environment)) throw new Error('--environment is required and must be lowercase kebab-case');
  if (!FAMILIES[family]) throw new Error('--family must be update or entitlement');
  if (!keyFile) throw new Error('--new-public-key-file is required');
  const newPublicKey = fs.readFileSync(path.resolve(keyFile), 'utf8');
  // Validate key syntax before displaying a plan or touching Railway.
  buildRotationValues(family, { [FAMILIES[family].id]: 'current-key', [FAMILIES[family].primary]: newPublicKey }, newKeyId, newPublicKey);
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', environment, family, services: ['api', 'worker'], stages: ['verify-current-parity', 'stage-overlap-bundle-without-deploy', 'redeploy-api-and-worker', 'run-hosted-preflight'], secretValuesExposed: false }, null, 2)}\n`);
    return;
  }
  if (option(argv, 'confirm-environment') !== environment) throw new Error('--confirm-environment must exactly match --environment');
  const api = command(['variables', '--service', 'api', '--environment', environment, '--json']);
  const worker = command(['variables', '--service', 'worker', '--environment', environment, '--json']);
  assertParity(api, worker, family);
  const values = buildRotationValues(family, api, newKeyId, newPublicKey);
  // Stage the complete overlap bundle on both roles before either role is redeployed.
  for (const service of ['api', 'worker']) for (const [name, value] of Object.entries(values)) setSecret(service, environment, name, value);
  for (const service of ['api', 'worker']) command(['redeploy', '--service', service, '--environment', environment, '--yes', '--json']);
  const confirmationFlag = environment === 'production' ? '--confirm-production' : '--confirm-isolated';
  const preflight = spawnSync(process.execPath, [path.join(__dirname, 'railway-core-hosted-preflight.js'), '--environment', environment, confirmationFlag, environment, '--require-marketplace'], { encoding: 'utf8' });
  if (preflight.status !== 0) throw new Error(`Hosted preflight failed after rotation: ${(preflight.stderr || preflight.stdout).trim()}`);
  process.stdout.write(preflight.stdout);
}

if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`Trust rotation failed: ${error.message}\n`); process.exitCode = 1; } }
module.exports = { assertParity, buildRotationValues, main, normalizePem, parseSecondary, railwayBinary };
