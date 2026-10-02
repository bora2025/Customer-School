'use strict';

const { PrismaClient } = require('@prisma/client');
const { AuthService } = require('../dist/auth/auth.service');

if (process.env.REFRESH_TOKEN_DRILL !== 'I_UNDERSTAND_THIS_CREATES_AND_DELETES_A_TEST_USER') {
  throw new Error('Set the exact REFRESH_TOKEN_DRILL guard before running this disposable test');
}

async function main() {
  const prisma = new PrismaClient();
  let userId;
  try {
    const user = await prisma.user.create({
      data: { email: `refresh-drill-${Date.now()}@example.test`, password: 'not-used', name: 'Refresh Token Drill', role: 'SUPER_ADMIN' },
    });
    userId = user.id;
    const service = new AuthService({ sign: () => 'drill-access-token' }, prisma);
    const raw = await service.createRefreshToken(user.id);
    const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    const rotated = await service.rotateRefreshToken(raw);
    let reuseRejected = false;
    try { await service.rotateRefreshToken(raw); } catch { reuseRejected = true; }
    const activeAfterReuse = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    const result = {
      rawAbsentAtRest: stored.token === null,
      sha256DigestPresent: stored.tokenHash?.length === 64,
      rotationIssuedDifferentToken: rotated.refreshToken !== raw,
      reuseRejected,
      activeSessionsAfterReuse: activeAfterReuse,
    };
    if (!result.rawAbsentAtRest || !result.sha256DigestPresent || !result.rotationIssuedDifferentToken || !reuseRejected || activeAfterReuse !== 0) {
      throw new Error(`Refresh-token drill failed: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`${JSON.stringify({ outcome: 'PASS', ...result })}\n`);
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
