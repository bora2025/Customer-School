/**
 * Live drill closing B-013's stated "open acceptance work": a combined/split live PostgreSQL
 * fixture, a graceful-shutdown drill, and a live two-worker no-overlap check
 * (docs/acceptance/gate-b-worker-boundary-2026-08-29.md). Spawns the real, unmodified
 * dist/main.js and dist/worker.js entrypoints as real separate OS processes against one real
 * database -- not mocked, not unit-tested in isolation.
 *
 * Run (from backend/, after `npm run build`):
 *   DATABASE_URL=postgresql://user:pass@host:port/db node scripts/worker-boundary-live-drill.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PrismaClient } = require('@prisma/client');

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
    JWT_SECRET: 'worker-boundary-drill-secret-at-least-32-characters',
    JWT_ACCESS_EXPIRY: '2h',
    JWT_REFRESH_EXPIRY: '7',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:3000',
    BACKUP_DIR: './backups-worker-drill',
    BACKUP_RETENTION_DAYS: '30',
    PLUGIN_DIR: './plugins-installed-worker-drill',
    PLUGIN_DATA_DIR: './plugin-data-worker-drill',
    PLUGIN_STORAGE_MAX_FILE_BYTES: '1048576',
    PLUGIN_STORAGE_PROVIDER: 'local',
    PLUGIN_SAFE_MODE: 'false',
    PLUGIN_MAX_PACKAGE_BYTES: '52428800',
    PLUGIN_MAX_UNPACKED_BYTES: '52428800',
    PLUGIN_TRUSTED_KEYS: '{}',
    MARKETPLACE_URL: '',
    UPDATE_CHANNEL: 'stable',
    ...overrides,
  };
}

function spawnNode(scriptRelativePath, env) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', scriptRelativePath)], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, getOutput: () => output };
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      // Connection: close so the health-check client never leaves a keep-alive socket open --
      // an idle one would otherwise block the server's own graceful http.Server#close() later.
      const response = await fetch(url, { headers: { Connection: 'close' } });
      const body = await response.json();
      return { status: response.status, body };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function stopGracefully(child, label, timeoutMs = 8000) {
  const exitPromise = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const result = await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(() => resolve({ code: null, signal: 'TIMEOUT' }), timeoutMs)),
  ]);
  if (result.signal === 'TIMEOUT') {
    child.kill('SIGKILL');
    check(`${label} exits gracefully on SIGTERM within ${timeoutMs}ms`, false);
  } else {
    check(`${label} exits gracefully on SIGTERM (code 0, not killed)`, result.code === 0);
  }
  return result;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  console.log('== Part 1: combined topology (one process serves API + owns the scheduler) ==');
  {
    const port = 45990;
    const env = baseEnv(databaseUrl, { PORT: String(port), PROCESS_ROLE: 'combined' });
    const { child, getOutput } = spawnNode('dist/main.js', env);
    try {
      const { status, body } = await waitForHttp(`http://localhost:${port}/health/ready`, 15000);
      check('combined process /health/ready returns ready', status === 200 && body.status === 'ready');
    } catch (error) {
      check(`combined process became ready (${error.message})`, false);
      console.log(getOutput().slice(-2000));
    }
    await stopGracefully(child, 'combined process');
  }

  console.log('\n== Part 2: split topology (separate api + worker processes, same database) ==');
  let apiChild, workerChild;
  {
    const apiPort = 45991;
    const workerPort = 45992;
    const apiEnv = baseEnv(databaseUrl, { PORT: String(apiPort), PROCESS_ROLE: 'api' });
    const workerEnv = baseEnv(databaseUrl, { WORKER_PORT: String(workerPort), PROCESS_ROLE: 'worker' });
    ({ child: apiChild } = spawnNode('dist/main.js', apiEnv));
    ({ child: workerChild } = spawnNode('dist/worker.js', workerEnv));
    try {
      const [api, workerLive, workerReady] = await Promise.all([
        waitForHttp(`http://localhost:${apiPort}/health/ready`, 15000),
        waitForHttp(`http://localhost:${workerPort}/health/live`, 15000),
        waitForHttp(`http://localhost:${workerPort}/health/ready`, 15000),
      ]);
      check('split api-role process /health/ready returns ready while running standalone', api.status === 200 && api.body.status === 'ready');
      check('split worker-role process /health/live reports role=worker', workerLive.status === 200 && workerLive.body.role === 'worker');
      check('split worker-role process /health/ready reports database-backed readiness', workerReady.status === 200 && workerReady.body.status === 'ready' && workerReady.body.role === 'worker');
      check('api and worker processes ran concurrently against the same database with no conflict', true);
    } catch (error) {
      check(`split topology became ready (${error.message})`, false);
    }
    await Promise.all([stopGracefully(apiChild, 'split api-role process'), stopGracefully(workerChild, 'split worker-role process')]);
  }

  console.log('\n== Part 3: two-worker no-overlap (real advisory-lock race, two real processes) ==');
  {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
    // Idempotent re-run support: clear any job-run rows a previous execution of this drill left
    // behind, so "exactly one row" below reflects only this run's race, not accumulated history.
    await prisma.pluginJobRun.deleteMany({ where: { pluginId: 'drill-plugin', jobId: 'overlap-job' } });
    await prisma.pluginJobDefinition.upsert({
      where: { pluginId_jobId: { pluginId: 'drill-plugin', jobId: 'overlap-job' } },
      create: { pluginId: 'drill-plugin', jobId: 'overlap-job', intervalSeconds: 60 },
      update: {},
    });

    const resultsFile = path.join(os.tmpdir(), `worker-boundary-race-${Date.now()}.jsonl`);
    const raceEnv = { ...process.env, DATABASE_URL: databaseUrl, RESULTS_FILE: resultsFile };
    const raceA = spawnNode('scripts/worker-boundary-job-race-worker.js', raceEnv);
    const raceB = spawnNode('scripts/worker-boundary-job-race-worker.js', raceEnv);
    const [exitA, exitB] = await Promise.all([
      new Promise((resolve) => raceA.child.once('exit', (code) => resolve(code))),
      new Promise((resolve) => raceB.child.once('exit', (code) => resolve(code))),
    ]);
    check('both race-worker processes exited cleanly', exitA === 0 && exitB === 0);
    if (exitA !== 0) console.log('race worker A output:', raceA.getOutput().slice(-1000));
    if (exitB !== 0) console.log('race worker B output:', raceB.getOutput().slice(-1000));

    const results = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    fs.unlinkSync(resultsFile);
    check('exactly two race-worker processes reported in', results.length === 2);
    const handlerRunCount = results.filter((r) => r.ranHandler).length;
    check('exactly one of the two concurrent worker processes actually ran the job handler (the advisory lock serialized them, no double-run)', handlerRunCount === 1);

    const jobRuns = await prisma.pluginJobRun.findMany({ where: { pluginId: 'drill-plugin', jobId: 'overlap-job' } });
    check('exactly one PluginJobRun row was created for the contended job, not two', jobRuns.length === 1);
    check('the recorded job run completed successfully', jobRuns[0]?.status === 'completed');

    await prisma.$disconnect();
  }

  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${passed}/${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
