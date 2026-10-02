'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { buildReport, querySnapshot } = require('./legacy-preflight');
const { postgresEnvironment } = require('./db-toolkit');

function assertFixtureTarget(env = process.env) {
  if (env.ALLOW_SYNTHETIC_LEGACY_FIXTURE !== 'true') throw new Error('ALLOW_SYNTHETIC_LEGACY_FIXTURE=true is required');
  if (!env.ADOPT_DATABASE_URL?.trim()) throw new Error('ADOPT_DATABASE_URL is required');
  if (env.ADOPT_DATABASE_URL === env.DATABASE_URL) throw new Error('synthetic legacy fixture refuses the primary DATABASE_URL');
}

function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function main() {
  assertFixtureTarget();
  const environment = postgresEnvironment(process.env.ADOPT_DATABASE_URL);
  const before = buildReport(querySnapshot(environment));
  if (before.state === 'empty') {
    run('psql', ['--no-psqlrc', '--quiet', '--single-transaction', '--set', 'ON_ERROR_STOP=1', '--file', path.join(process.cwd(), 'prisma/migrations/20260827000000_baseline/migration.sql')], environment);
  } else if (before.state !== 'legacy_unadopted') {
    throw new Error(`synthetic fixture target must be empty or resumable legacy_unadopted; found ${before.state}`);
  }
  const password = process.env.SYNTHETIC_LEGACY_OWNER_PASSWORD_FILE
    ? fs.readFileSync(path.resolve(process.env.SYNTHETIC_LEGACY_OWNER_PASSWORD_FILE), 'utf8').replace(/\r?\n$/, '')
    : `fixture-${Date.now()}-Password1`;
  if (password.length < 12) throw new Error('synthetic legacy owner password must be at least 12 characters');
  const passwordHash = await bcrypt.hash(password, 12);
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.ADOPT_DATABASE_URL } } });
  try {
    await prisma.user.upsert({
      where: { id: 'legacy-owner-fixture' },
      create: { id: 'legacy-owner-fixture', email: 'legacy-owner@example.invalid', password: passwordHash, name: 'Legacy Fixture Owner', role: 'SUPER_ADMIN' },
      update: { email: 'legacy-owner@example.invalid', password: passwordHash, name: 'Legacy Fixture Owner', role: 'SUPER_ADMIN' },
    });
  } finally { await prisma.$disconnect(); }
  const after = buildReport(querySnapshot(environment));
  if (after.state !== 'legacy_unadopted') throw new Error(`fixture did not produce legacy_unadopted state; found ${after.state}`);
  process.stdout.write(`${JSON.stringify(after, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`ERROR: synthetic legacy fixture failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}

module.exports = { assertFixtureTarget };
