'use strict';

// One-time migration for C-004: copies the core Announcement/AnnouncementRead
// rows into the wattanam.announcements plugin's own tables, verifies the
// copy, and grants the plugin's read/manage permissions to the roles that
// already had access via the old @Roles() guards -- preserving access, not
// widening it.
//
// Run this AFTER the plugin has been installed/updated to a version whose
// migrations 002_create_announcement/003_create_announcement_read have
// already applied (the target tables must exist before rows can be copied
// into them). Core's Announcement/AnnouncementRead tables and data are left
// in place afterwards -- this is additive-only. The rollback path is: revert
// the code commit that switches the /announcements/* controller over to the
// plugin; the original tables were never modified.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { backupDirectory, sha256 } = require('./db-toolkit');

const GRANT_READ_ROLES = ['ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
const GRANT_MANAGE_ROLES = ['ADMIN', 'SCHOOL_ADMIN', 'TEACHER'];

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function readJournal(file) {
  if (!fs.existsSync(file)) return null;
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.format !== 'wattanam-announcements-cutover-v1') throw new Error('announcements cutover journal has an unsupported format');
  return journal;
}

function command(executable, args, env, capture = false) {
  const result = spawnSync(executable, args, { env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw new Error(`${executable} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`);
  return capture ? String(result.stdout || '').trim() : '';
}

async function grantRole(prisma, permissionId, role) {
  await prisma.pluginPermissionGrant.upsert({
    where: { pluginId_permissionId_role: { pluginId: 'wattanam.announcements', permissionId, role } },
    create: { pluginId: 'wattanam.announcements', permissionId, role },
    update: {},
  });
}

async function cutover() {
  const directory = backupDirectory();
  const journalFile = path.join(directory, 'announcements-cutover.json');
  let journal = readJournal(journalFile);

  if (!journal) {
    // Same NODE_ENV=test bypass plugin-migrations.service.ts's createRecoveryPoint() already
    // uses -- pg_dump/psql are not assumed present on every host that runs the test suite.
    if (process.env.NODE_ENV === 'test') {
      journal = { format: 'wattanam-announcements-cutover-v1', stage: 'backed_up', createdAt: new Date().toISOString(), backup: { file: null, sha256: null, sizeBytes: 0, skipped: true } };
    } else {
      process.stderr.write('Creating mandatory pre-cutover backup...\n');
      const backupOutput = command(process.execPath, [path.join(__dirname, 'backup-database.js')], process.env, true);
      const backup = JSON.parse(backupOutput.split(/\r?\n/).filter(Boolean).pop());
      journal = { format: 'wattanam-announcements-cutover-v1', stage: 'backed_up', createdAt: new Date().toISOString(), backup: { file: backup.file, sha256: backup.sha256, sizeBytes: backup.sizeBytes } };
    }
    atomicJson(journalFile, journal);
  } else if (!process.argv.includes('--resume')) {
    throw new Error('an announcements cutover journal already exists; inspect it and rerun with --resume');
  } else if (!journal.backup.skipped && sha256(path.join(directory, journal.backup.file)) !== journal.backup.sha256) {
    throw new Error('announcements cutover recovery backup checksum mismatch');
  }

  const prisma = new PrismaClient();
  try {
    if (journal.stage === 'backed_up') {
      process.stderr.write('Copying Announcement/AnnouncementRead rows into the plugin tables...\n');
      const announcements = await prisma.announcement.findMany();
      for (const a of announcements) {
        await prisma.$executeRawUnsafe(
          'INSERT INTO plugin_wattanam_announcements_announcement (id, "authorId", title, body, audience, "targetRole", "classId", channels, pinned, "scheduledAt", "sentAt", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING',
          a.id, a.authorId, a.title, a.body, a.audience, a.targetRole, a.classId, a.channels, a.pinned, a.scheduledAt, a.sentAt, a.createdAt,
        );
      }
      const reads = await prisma.announcementRead.findMany();
      for (const r of reads) {
        await prisma.$executeRawUnsafe(
          'INSERT INTO plugin_wattanam_announcements_announcement_read (id, "announcementId", "userId", "readAt") VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
          r.id, r.announcementId, r.userId, r.readAt,
        );
      }
      journal.stage = 'copied';
      journal.counts = { announcements: announcements.length, reads: reads.length };
      journal.updatedAt = new Date().toISOString();
      atomicJson(journalFile, journal);
    }

    if (journal.stage === 'copied') {
      process.stderr.write('Verifying row counts...\n');
      const [sourceCount] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM "Announcement"');
      const [targetCount] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM plugin_wattanam_announcements_announcement');
      const [sourceReadCount] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM "AnnouncementRead"');
      const [targetReadCount] = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM plugin_wattanam_announcements_announcement_read');
      if (sourceCount.count !== targetCount.count) throw new Error(`announcement row count mismatch: source=${sourceCount.count} target=${targetCount.count}`);
      if (sourceReadCount.count !== targetReadCount.count) throw new Error(`announcement_read row count mismatch: source=${sourceReadCount.count} target=${targetReadCount.count}`);
      journal.stage = 'verified';
      journal.updatedAt = new Date().toISOString();
      atomicJson(journalFile, journal);
    }

    if (journal.stage === 'verified') {
      process.stderr.write("Granting plugin permissions to preserve today's access...\n");
      for (const role of GRANT_READ_ROLES) await grantRole(prisma, 'wattanam.announcements.read', role);
      for (const role of GRANT_MANAGE_ROLES) await grantRole(prisma, 'wattanam.announcements.manage', role);
      journal.stage = 'granted';
      journal.completedAt = new Date().toISOString();
      atomicJson(journalFile, journal);
    }
  } finally {
    await prisma.$disconnect();
  }

  process.stdout.write(`${JSON.stringify({ state: journal.stage, counts: journal.counts, recoveryJournal: journalFile })}\n`);
}

if (require.main === module) {
  cutover().catch((error) => {
    process.stderr.write(`ERROR: announcements cutover failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { readJournal };
