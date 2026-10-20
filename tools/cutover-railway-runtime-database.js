'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const API_ROLE = 'wattanam_api';
const WORKER_ROLE = 'wattanam_worker';

function option(argv, name) { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; }
function railwayBinary(platform = process.platform) { return platform === 'win32' ? 'railway.cmd' : 'railway'; }
function databaseName(value) { const parsed = new URL(value); return decodeURIComponent(parsed.pathname.replace(/^\//, '')); }
function runtimeUrl(adminUrl, role, password) {
  const parsed = new URL(adminUrl);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}
function buildRuntimeUrls(adminUrl, apiPassword, workerPassword) {
  if (!adminUrl) throw new Error('current API DATABASE_URL is required');
  if (apiPassword.length < 32 || workerPassword.length < 32) throw new Error('runtime passwords must contain at least 32 characters');
  return { api: runtimeUrl(adminUrl, API_ROLE, apiPassword), worker: runtimeUrl(adminUrl, WORKER_ROLE, workerPassword) };
}
function assertCutoverState(api, worker, expectedDatabase) {
  if (!api.DATABASE_URL || !worker.DATABASE_URL) throw new Error('API and worker DATABASE_URL are required');
  if (api.DATABASE_URL !== worker.DATABASE_URL) throw new Error('cutover requires the current shared database identity; runtime identities already differ');
  const actual = databaseName(api.DATABASE_URL);
  if (actual !== expectedDatabase) throw new Error('--confirm-database must exactly match the target database');
  if (worker.MIGRATION_DATABASE_URL) throw new Error('worker must not have MIGRATION_DATABASE_URL');
  return { database: actual, adminUrl: api.DATABASE_URL };
}
function command(args, { input, json = true } = {}) {
  const result = spawnSync(railwayBinary(), args, { input, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  if (result.status !== 0) throw new Error(`Railway command failed (${args[0]}): ${(result.stderr || result.stdout).trim()}`);
  const output = result.stdout.trim();
  return json && output ? JSON.parse(output) : output;
}
function setSecret(service, environment, name, value) {
  command(['variable', 'set', name, '--stdin', '--service', service, '--environment', environment, '--skip-deploys', '--json'], { input: `${value}\n` });
}
function redeploy(service, environment) { return command(['redeploy', '--service', service, '--environment', environment, '--yes', '--json']); }
function waitForDeployment(service, environment, deploymentId, { timeoutMs = 10 * 60_000, intervalMs = 5_000, now = Date.now, pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), list = command } = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const deployments = list(['deployment', 'list', '--service', service, '--environment', environment, '--json']);
    const deployment = deployments.find((item) => item.id === deploymentId);
    if (deployment?.status === 'SUCCESS') return deployment;
    if (deployment && ['FAILED', 'CRASHED', 'REMOVED'].includes(deployment.status)) throw new Error(`${service} deployment ${deploymentId} ended with ${deployment.status}`);
    pause(intervalMs);
  }
  throw new Error(`${service} deployment ${deploymentId} did not complete within ${timeoutMs}ms`);
}
function provisionRoles(environment, database, apiPassword, workerPassword) {
  const credentials = JSON.stringify({ RUNTIME_API_DATABASE_PASSWORD: apiPassword, RUNTIME_WORKER_DATABASE_PASSWORD: workerPassword });
  return command(['ssh', '--service', 'api', '--environment', environment, 'node', 'backend/scripts/provision-runtime-database-roles.js', '--credentials-stdin', '--execute', '--confirm-database', database], { input: credentials, json: true });
}
function runPreflight(environment) {
  const confirmation = environment === 'production' ? '--confirm-production' : '--confirm-isolated';
  const result = spawnSync(process.execPath, [path.join(__dirname, 'railway-core-hosted-preflight.js'), '--environment', environment, confirmation, environment, '--require-marketplace'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`hosted preflight failed: ${(result.stderr || result.stdout).trim()}`);
  return JSON.parse(result.stdout);
}
function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node tools/cutover-railway-runtime-database.js --environment <name> --confirm-database <database> [--execute --confirm-environment <name>]\n');
    return;
  }
  const environment = option(argv, 'environment');
  const expectedDatabase = option(argv, 'confirm-database');
  const execute = argv.includes('--execute');
  if (!environment || !/^[a-z0-9][a-z0-9-]*$/.test(environment)) throw new Error('--environment is required and must be lowercase kebab-case');
  if (!expectedDatabase || !/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabase)) throw new Error('--confirm-database is required and must be a safe PostgreSQL database name');
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', environment, database: expectedDatabase, stages: ['verify-shared-current-identity', 'provision-restricted-roles-over-ssh', 'stage-migration-and-runtime-urls', 'redeploy-api-and-worker', 'run-hosted-preflight', 'rollback-runtime-urls-on-failure'], secretsExposed: false }, null, 2)}\n`);
    return;
  }
  if (option(argv, 'confirm-environment') !== environment) throw new Error('--confirm-environment must exactly match --environment');
  if (environment === 'production' && option(argv, 'confirm-production') !== environment) throw new Error('--confirm-production must exactly match production');
  const api = command(['variable', 'list', '--service', 'api', '--environment', environment, '--json']);
  const worker = command(['variable', 'list', '--service', 'worker', '--environment', environment, '--json']);
  const state = assertCutoverState(api, worker, expectedDatabase);
  const apiPassword = crypto.randomBytes(36).toString('base64url');
  const workerPassword = crypto.randomBytes(36).toString('base64url');
  const urls = buildRuntimeUrls(state.adminUrl, apiPassword, workerPassword);
  const provisioned = provisionRoles(environment, state.database, apiPassword, workerPassword);
  try {
    setSecret('api', environment, 'MIGRATION_DATABASE_URL', state.adminUrl);
    setSecret('api', environment, 'DATABASE_URL', urls.api);
    setSecret('worker', environment, 'DATABASE_URL', urls.worker);
    const apiDeployment = redeploy('api', environment);
    const workerDeployment = redeploy('worker', environment);
    waitForDeployment('api', environment, apiDeployment.id);
    waitForDeployment('worker', environment, workerDeployment.id);
    const preflight = runPreflight(environment);
    process.stdout.write(`${JSON.stringify({ mode: 'executed', environment, database: state.database, roles: provisioned.roles, pluginTablesTransferred: provisioned.pluginTablesTransferred, pluginSequencesTransferred: provisioned.pluginSequencesTransferred, preflightPassed: preflight.passed, secretsExposed: false }, null, 2)}\n`);
  } catch (error) {
    setSecret('api', environment, 'DATABASE_URL', state.adminUrl);
    setSecret('worker', environment, 'DATABASE_URL', state.adminUrl);
    redeploy('api', environment);
    redeploy('worker', environment);
    throw new Error(`cutover failed and shared runtime URLs were restored: ${error.message}`);
  }
}

if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`Runtime database cutover failed: ${error.message}\n`); process.exitCode = 1; } }
module.exports = { assertCutoverState, buildRuntimeUrls, databaseName, main, railwayBinary, runtimeUrl, waitForDeployment };
