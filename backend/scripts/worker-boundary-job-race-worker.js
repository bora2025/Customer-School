/**
 * One participant in the B-013 two-worker no-overlap live drill (see
 * worker-boundary-live-drill.js, which spawns two copies of this script at once). Uses the
 * real, unmodified production PluginJobsService.run() -- the same PostgreSQL advisory-lock
 * transaction every real worker process uses -- against a real database, with its own separate
 * PrismaClient connection (simulating a separate OS process's own connection, not a shared
 * client), so the race is genuine, not simulated.
 *
 * Env: DATABASE_URL (required), RESULTS_FILE (required, appended to as JSON lines).
 */
'use strict';

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { PluginJobsService } = require('../dist/plugins/plugin-jobs.service');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const resultsFile = process.env.RESULTS_FILE;
  if (!databaseUrl || !resultsFile) throw new Error('DATABASE_URL and RESULTS_FILE are required');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.$connect();
  // The drill is about the advisory lock between workers, not the billing lock: treat the school as open.
  const jobs = new PluginJobsService(prisma, { isSuspended: async () => false });

  let ran = false;
  await jobs.run('drill-plugin', 'overlap-job', async () => {
    ran = true;
    // Hold the lock for a bit to widen the race window -- if the advisory lock did not
    // actually serialize these two processes, the other process's run() would slip in here.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  fs.appendFileSync(resultsFile, JSON.stringify({ pid: process.pid, ranHandler: ran, at: new Date().toISOString() }) + '\n');
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
