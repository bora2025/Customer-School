'use strict';

const { PrismaClient } = require('@prisma/client');

function target(env = process.env) {
  if (!env.ADOPT_DATABASE_URL?.trim()) throw new Error('ADOPT_DATABASE_URL is required');
  if (!env.ADOPT_SCHOOL_SLUG?.trim()) throw new Error('ADOPT_SCHOOL_SLUG is required');
  return { url: env.ADOPT_DATABASE_URL.trim(), slug: env.ADOPT_SCHOOL_SLUG.trim() };
}

async function main() {
  const selected = target();
  const prisma = new PrismaClient({ datasources: { db: { url: selected.url } } });
  try {
    const [users, owner, installation, installationCount, adoptionAuditCount] = await Promise.all([
      prisma.user.count(),
      prisma.user.findUnique({ where: { id: 'legacy-owner-fixture' }, select: { role: true } }),
      prisma.installation.findUnique({ where: { schoolSlug: selected.slug }, select: { installationId: true, status: true, schoolSlug: true } }),
      prisma.installation.count(),
      prisma.auditLog.count({ where: { action: 'LEGACY_ADOPTION' } }),
    ]);
    process.stdout.write(`${JSON.stringify({
      usersPreserved: users >= 1,
      fixtureOwnerRole: owner?.role || null,
      installationPresent: !!installation,
      installationCount,
      adoptionAuditCount,
      schoolSlugMatches: installation?.schoolSlug === selected.slug,
    })}\n`);
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`ERROR: legacy adoption status failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}

module.exports = { target };
