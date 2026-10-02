/**
 * Sets a school user's password on a *deployed* environment.
 *
 * The supported self-service path is `PasswordResetService` (POST /auth/password-reset/request),
 * which mails a 30-minute link. That path is useless in exactly the situation this script exists
 * for: the only administrator cannot sign in, and the deployment either has no mail provider
 * configured or nobody can read that mailbox any more. There is no in-app override — a school's
 * SUPER_ADMIN is its highest authority — so the break-glass has to come from someone with deploy
 * access, at the moment they use it. That is why this is piped in over SSH rather than shipped as
 * an endpoint or baked into the image.
 *
 *   # Which accounts actually exist (run this first if the email itself is in doubt):
 *   railway ssh --project <id> --service api -i ~/.ssh/<key> \
 *     node < backend/scripts/reset-school-admin-password.js
 *
 *   # Set a new password:
 *   PAYLOAD=$(printf '%s' '{"email":"you@example.com","password":"..."}' | base64 -w0)
 *   railway ssh --project <id> --service api -i ~/.ssh/<key> \
 *     env SCHOOL_PASSWORD_B64=$PAYLOAD node < backend/scripts/reset-school-admin-password.js
 *
 * The hash is produced by the image's own `bcryptjs` at the same cost factor `AuthService` uses,
 * never a re-implementation, so it is verified by exactly the code the login path runs.
 */
const APP = process.env.SCHOOL_APP_ROOT || '/app';
const { PrismaClient } = require(`${APP}/node_modules/@prisma/client`);
const bcrypt = require(`${APP}/node_modules/bcryptjs`);

/** Same cost factor as `AuthService.resetUserPassword`; a mismatch would still verify, but the
 * account would silently sit at a different strength from every other password in the database. */
const BCRYPT_ROUNDS = 12;

/** `ConfirmPasswordResetDto` enforces this on the HTTP path. The break-glass must not be the
 * weakest way into an account. */
const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * `railway ssh` joins its command arguments and re-splits them on whitespace, so a password
 * containing a space arrives as a broken command line — and a password chosen to avoid spaces is a
 * weaker password. A base64 JSON blob contains no whitespace and survives that round trip.
 */
function inputs() {
  const encoded = process.env.SCHOOL_PASSWORD_B64;
  if (encoded) return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  return { email: process.env.SCHOOL_USER_EMAIL, password: process.env.SCHOOL_USER_PASSWORD };
}

const given = inputs();
const email = (given.email || '').trim();
const password = (given.password || '').trim();

/** Listing is the answer to the "invalid email" half of the problem: a typo and a genuinely
 * missing account look identical from the sign-in form. */
async function listAccounts(prisma) {
  const accounts = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { id: true, email: true, phone: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return { adminAccounts: accounts, totalUsers: await prisma.user.count() };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    if (!email && !password) {
      const listing = await listAccounts(prisma);
      console.log(JSON.stringify({
        ...listing,
        nextStep: 'Re-run with SCHOOL_PASSWORD_B64 set to base64 of {"email":"...","password":"..."}.',
      }, null, 2));
      return;
    }
    if (!email) throw new Error('Set an email in the payload');
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
    }

    /** Deliberately the same case-insensitive `findFirst` as `AuthService.validateUser`: accounts
     * predating email normalization can have uppercase stored, and resolving the row differently
     * from the login path is how you rewrite one account's password and leave another one locked. */
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) {
      const listing = await listAccounts(prisma);
      throw new Error(
        `No account matches ${email}. Existing administrators: ${
          listing.adminAccounts.map((account) => account.email || account.phone || account.id).join(', ') || 'none'
        }`,
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { password: passwordHash } });
      /** Both mirror `PasswordResetService.confirm`: a password change that leaves live sessions and
       * unspent reset links behind has not actually taken the account back. */
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: null, actorRole: 'SYSTEM', actorName: 'reset-school-admin-password',
          action: 'PASSWORD_RESET', resource: 'USER', resourceId: user.id,
          resourceLabel: user.email || user.name,
          metadata: { via: 'cli', role: user.role },
        },
      });
    });

    console.log(JSON.stringify({
      updated: { id: user.id, email: user.email, name: user.name, role: user.role },
      sessionsRevoked: true,
      nextStep: 'Sign in with this email and the new password.',
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
