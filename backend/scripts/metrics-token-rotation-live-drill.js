/**
 * Live drill for the overlap-capable METRICS_TOKEN rotation added to
 * docs/operations/secret-rotation-runbooks.md, mirroring the marketplace-api drill
 * (apps/marketplace-api/scripts/admin-and-metrics-token-rotation-live-drill.js) and the
 * JWT_SECRET rotation drill. Uses the real, unmodified dist/main.js entrypoint as a real
 * listening process against a real disposable PostgreSQL 16 -- not mocked.
 *
 * Run (from backend/, after `npm run build`):
 *   DATABASE_URL=postgresql://user:pass@host:port/db node scripts/metrics-token-rotation-live-drill.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

let passed = 0;
let failed = 0;
function check(description, condition) {
  if (condition) { passed += 1; console.log(`PASS ${description}`); }
  else { failed += 1; console.log(`FAIL ${description}`); }
}

function baseEnv(databaseUrl, overrides) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'metrics-drill-secret-at-least-32-characters-long',
    PORT: '46001',
    CORS_ORIGINS: 'http://localhost:3000',
    BACKUP_DIR: './backups-metrics-drill',
    PLUGIN_DIR: './plugins-installed-metrics-drill',
    PLUGIN_DATA_DIR: './plugin-data-metrics-drill',
    PLUGIN_TRUSTED_KEYS: '{}',
    ...overrides,
  };
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try { return await fetch(url, { headers: { Connection: 'close' } }); }
    catch (error) { lastError = error; await new Promise((r) => setTimeout(r, 200)); }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function get(port, token) {
  const headers = { Connection: 'close', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`http://localhost:${port}/metrics`, { headers });
  return response.status;
}

function stop(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const tokenA = 'backend-metrics-token-v1-at-least-32-chars';
  const tokenB = 'backend-metrics-token-v2-at-least-32-chars';

  console.log('-- Step 0: baseline, only tokenA configured --');
  let child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
    cwd: path.join(__dirname, '..'),
    env: baseEnv(databaseUrl, { METRICS_TOKEN: tokenA }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHttp('http://localhost:46001/health/ready', 15000);
  check('tokenA works against the baseline deployment', (await get(46001, tokenA)) === 200);
  check('tokenB is rejected before it has ever been configured', (await get(46001, tokenB)) === 401);
  await stop(child);

  console.log('-- Step 1 (runbook): tokenB becomes active, tokenA kept as a trusted secondary --');
  child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
    cwd: path.join(__dirname, '..'),
    env: baseEnv(databaseUrl, { METRICS_TOKEN: tokenB, METRICS_SECONDARY_TOKENS_JSON: JSON.stringify([tokenA]) }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHttp('http://localhost:46001/health/ready', 15000);
  check('the OLD token (tokenA) still works during the overlap window -- the actual point of overlap', (await get(46001, tokenA)) === 200);
  check('the NEW token (tokenB) works at the same time', (await get(46001, tokenB)) === 200);
  await stop(child);

  console.log('-- Step 2 (runbook): overlap window closes, tokenA removed --');
  child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
    cwd: path.join(__dirname, '..'),
    env: baseEnv(databaseUrl, { METRICS_TOKEN: tokenB }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForHttp('http://localhost:46001/health/ready', 15000);
  check('tokenB still works after the old token is dropped', (await get(46001, tokenB)) === 200);
  check('tokenA now fails closed once no longer trusted', (await get(46001, tokenA)) === 401);
  await stop(child);

  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${passed}/${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
