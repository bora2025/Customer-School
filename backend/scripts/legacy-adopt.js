'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { BASELINE, buildReport, querySnapshot } = require('./legacy-preflight');
const { backupDirectory, postgresEnvironment, sha256 } = require('./db-toolkit');

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseInput(env = process.env) {
  if (env.ADOPT_NON_INTERACTIVE !== 'true') throw new Error('ADOPT_NON_INTERACTIVE=true is required');
  const schoolSlug = required(env, 'ADOPT_SCHOOL_SLUG');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schoolSlug) || schoolSlug.length > 80) throw new Error('ADOPT_SCHOOL_SLUG is invalid');
  if (required(env, 'ADOPT_CONFIRM_SLUG') !== schoolSlug) throw new Error('ADOPT_CONFIRM_SLUG must exactly match ADOPT_SCHOOL_SLUG');
  const fingerprint = required(env, 'ADOPT_APPROVED_SCHEMA_FINGERPRINT');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('ADOPT_APPROVED_SCHEMA_FINGERPRINT must be a SHA-256 value');
  const timezone = env.ADOPT_TIMEZONE?.trim() || 'Asia/Phnom_Penh';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error('ADOPT_TIMEZONE must be a valid IANA timezone'); }
  const currency = env.ADOPT_CURRENCY?.trim() || 'KHR';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('ADOPT_CURRENCY must be a three-letter code');
  const locale = env.ADOPT_LOCALE?.trim() || 'en-KH';
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new Error('ADOPT_LOCALE is invalid');
  const schoolName = required(env, 'ADOPT_SCHOOL_NAME');
  if (schoolName.length < 2 || schoolName.length > 150) throw new Error('ADOPT_SCHOOL_NAME must be between 2 and 150 characters');
  const ownerEmail = required(env, 'ADOPT_OWNER_EMAIL').toLowerCase();
  if (ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('ADOPT_OWNER_EMAIL must be a valid email address');
  return {
    schoolName, schoolSlug, locale, timezone, currency,
    ownerEmail, fingerprint,
    coreVersion: env.APP_VERSION?.trim() || '0.1.0-dev',
  };
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function readJournal(file, input) {
  if (!fs.existsSync(file)) return null;
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.format !== 'wattanam-legacy-adoption-v1') throw new Error('legacy adoption journal has an unsupported format');
  if (journal.schoolSlug !== input.schoolSlug || journal.sourceFingerprint !== input.fingerprint) throw new Error('legacy adoption journal does not match the confirmed school and fingerprint');
  if (typeof journal.backup?.file !== 'string' || path.basename(journal.backup.file) !== journal.backup.file || !/^wattanam-\d{8}T\d{6}Z\.dump$/.test(journal.backup.file)) {
    throw new Error('legacy adoption journal contains an invalid backup filename');
  }
  const archive = path.join(path.dirname(file), journal.backup.file);
  const manifestFile = archive.replace(/\.dump$/, '.manifest.json');
  if (!fs.existsSync(archive) || !fs.existsSync(manifestFile)) throw new Error('legacy adoption recovery backup is missing');
  if (sha256(archive) !== journal.backup.sha256) throw new Error('legacy adoption recovery backup checksum mismatch');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== 'pg_dump-custom-v1' || manifest.file !== journal.backup.file || manifest.sha256 !== journal.backup.sha256) {
    throw new Error('legacy adoption recovery manifest does not match the journal');
  }
  return journal;
}

function command(executable, args, env, capture = false) {
  const result = spawnSync(executable, args, { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw new Error(`${executable} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`);
  return capture ? String(result.stdout || '').trim() : '';
}

function prismaCommand(args, env) {
  const executable = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  command(executable, args, env);
}

function buildDryRunPlan(report, input, ownerExists) {
  const blockers = [...(report.adoptionReadiness?.blockers || [])];
  if (!ownerExists) blockers.push('ADOPT_OWNER_EMAIL must identify an existing SUPER_ADMIN');
  return {
    format: 'wattanam-legacy-adoption-dry-run-v1',
    generatedAt: new Date().toISOString(),
    dryRun: true,
    zeroWriteGuarantee: true,
    ready: blockers.length === 0,
    blockers,
    source: {
      state: report.state,
      schemaFingerprint: report.schemaFingerprint,
      databaseVersion: report.databaseVersion,
      databaseBytes: report.databaseBytes,
      tableCount: report.tableCount,
      columnCount: report.columnCount,
    },
    target: { schoolSlug: input.schoolSlug, coreVersion: input.coreVersion },
    plannedSteps: [
      'create_verified_recovery_backup',
      `record_baseline_${BASELINE}`,
      'deploy_post_baseline_migrations',
      'create_installation_identity_and_audit',
      'capture_after_snapshot_and_reconcile',
    ],
    reconciliationPreview: {
      preserveAllSourceTables: true,
      preserveAllSourceRows: true,
      expectedSourceTableCount: report.tableCount,
      checks: ['row_counts', 'foreign_key_orphans', 'content_hashes', 'credential_hash_format'],
    },
  };
}

async function confirmedOwnerExists(input) {
  const prisma = new PrismaClient();
  try {
    return Boolean(await prisma.user.findFirst({ where: { email: { equals: input.ownerEmail, mode: 'insensitive' }, role: 'SUPER_ADMIN' }, select: { id: true } }));
  } finally { await prisma.$disconnect(); }
}

async function adopt() {
  const isolated = process.argv.includes('--use-adopt-database-url');
  if (isolated && !process.env.ADOPT_DATABASE_URL?.trim()) throw new Error('ADOPT_DATABASE_URL is required with --use-adopt-database-url');
  if (isolated) process.env.DATABASE_URL = process.env.ADOPT_DATABASE_URL.trim();
  const input = parseInput();
  const databaseEnvironment = postgresEnvironment();
  const report = buildReport(querySnapshot(databaseEnvironment), {
    approvedFingerprint: input.fingerprint,
    availableCapacityBytes: process.env.ADOPT_TARGET_CAPACITY_BYTES?.trim(),
  });
  if (process.argv.includes('--dry-run')) {
    const plan = buildDryRunPlan(report, input, await confirmedOwnerExists(input));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (!plan.ready) process.exitCode = 2;
    return plan;
  }
  const directory = backupDirectory();
  const journalFile = path.join(directory, `legacy-adoption-${input.schoolSlug}.json`);
  let journal = readJournal(journalFile, input);

  if (!journal) {
    if (!report.adoptionReadiness.ready) throw new Error(`adoption preflight failed: ${report.adoptionReadiness.blockers.join('; ')}`);
    if (report.state !== 'legacy_unadopted') throw new Error(`initial adoption requires legacy_unadopted state; found ${report.state}`);
    if (report.schemaFingerprint !== input.fingerprint) throw new Error('current schema fingerprint does not match the reviewed approval');
    const prisma = new PrismaClient();
    try {
      const owner = await prisma.user.findFirst({ where: { email: { equals: input.ownerEmail, mode: 'insensitive' }, role: 'SUPER_ADMIN' }, select: { id: true } });
      if (!owner) throw new Error('ADOPT_OWNER_EMAIL must identify an existing SUPER_ADMIN');
    } finally { await prisma.$disconnect(); }

    process.stderr.write('Creating mandatory pre-adoption backup...\n');
    const backupOutput = command(process.execPath, [path.join(__dirname, 'backup-database.js')], process.env, true);
    const backup = JSON.parse(backupOutput.split(/\r?\n/).filter(Boolean).pop());
    journal = {
      format: 'wattanam-legacy-adoption-v1', stage: 'backed_up', createdAt: new Date().toISOString(),
      schoolSlug: input.schoolSlug, sourceFingerprint: input.fingerprint,
      backup: { file: backup.file, sha256: backup.sha256, sizeBytes: backup.sizeBytes },
    };
    atomicJson(journalFile, journal);
  } else if (!process.argv.includes('--resume')) {
    throw new Error('an adoption journal already exists; inspect it and rerun with --resume');
  }

  const refreshed = buildReport(querySnapshot(databaseEnvironment));
  if (refreshed.state === 'legacy_unadopted') {
    process.stderr.write('Recording reviewed baseline migration history...\n');
    prismaCommand(['migrate', 'resolve', '--applied', BASELINE, '--schema=prisma/schema.prisma'], process.env);
  } else if (refreshed.state !== 'managed') {
    throw new Error(`adoption cannot continue from ${refreshed.state}`);
  }
  journal.stage = 'baseline_recorded'; journal.updatedAt = new Date().toISOString(); atomicJson(journalFile, journal);

  process.stderr.write('Applying post-baseline platform migrations...\n');
  prismaCommand(['migrate', 'deploy', '--schema=prisma/schema.prisma'], process.env);
  journal.stage = 'migrated'; journal.updatedAt = new Date().toISOString(); atomicJson(journalFile, journal);

  const prisma = new PrismaClient();
  let installation;
  try {
    installation = await prisma.$transaction(async (tx) => {
      const existing = await tx.installation.findUnique({ where: { id: 'singleton' } });
      if (existing) {
        if (existing.schoolSlug !== input.schoolSlug) throw new Error('existing installation identity belongs to another school slug');
        return existing;
      }
      const owner = await tx.user.findFirst({ where: { email: { equals: input.ownerEmail, mode: 'insensitive' }, role: 'SUPER_ADMIN' }, select: { id: true, name: true, email: true, role: true } });
      if (!owner) throw new Error('confirmed legacy owner is no longer an existing SUPER_ADMIN');
      await tx.siteSetting.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', siteName: input.schoolName }, update: { siteName: input.schoolName } });
      const created = await tx.installation.create({ data: { id: 'singleton', schoolName: input.schoolName, schoolSlug: input.schoolSlug, locale: input.locale, timezone: input.timezone, currency: input.currency, coreVersion: input.coreVersion } });
      await tx.auditLog.create({ data: {
        actorId: owner.id, actorRole: owner.role, actorName: owner.name, actorEmail: owner.email,
        action: 'LEGACY_ADOPTION', resource: 'INSTALLATION', resourceId: created.installationId,
        metadata: { sourceFingerprint: input.fingerprint, backupSha256: journal.backup.sha256 }, success: true,
      } });
      return created;
    }, { isolationLevel: 'Serializable' });
  } finally { await prisma.$disconnect(); }

  journal.stage = 'installed'; journal.installationId = installation.installationId; journal.completedAt = new Date().toISOString(); atomicJson(journalFile, journal);
  process.stdout.write(`${JSON.stringify({ state: 'installed', installationId: installation.installationId, schoolSlug: installation.schoolSlug, coreVersion: installation.coreVersion, recoveryJournal: journalFile })}\n`);
}

if (require.main === module) {
  adopt().catch((error) => {
    process.stderr.write(`ERROR: legacy adoption failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildDryRunPlan, parseInput, readJournal };
