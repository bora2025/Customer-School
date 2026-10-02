/**
 * Live drill for the JWT_SECRET overlap-capable rotation added to
 * docs/operations/secret-rotation-runbooks.md, mirroring the rigor already applied there to the
 * repository and entitlement signing keys. Uses the real, unmodified JwtService (from
 * @nestjs/jwt, the same class AuthModule wires up) and the real, unmodified
 * resolveJwtVerificationSecret/verifyJwtWithRotationSupport functions from
 * src/auth/jwt-verification.ts, driven by the same environment variables production reads --
 * no reimplemented logic, no live server or database needed since JWT signing/verification is a
 * pure cryptographic operation.
 *
 * Run (from backend/, after `npm run build`):
 *   node scripts/jwt-secret-rotation-live-drill.js
 */
'use strict';

const { JwtService } = require('@nestjs/jwt');
const { verifyJwtWithRotationSupport } = require('../dist/auth/jwt-verification');

let passed = 0;
let failed = 0;
function check(description, condition) {
  if (condition) { passed += 1; console.log(`PASS ${description}`); }
  else { failed += 1; console.log(`FAIL ${description}`); }
}
async function rejects(description, run, expectedSubstring) {
  try {
    await run();
    failed += 1;
    console.log(`FAIL ${description} (expected a rejection, got success)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedSubstring)) { passed += 1; console.log(`PASS ${description}`); }
    else { failed += 1; console.log(`FAIL ${description} (rejected with unexpected message: ${message})`); }
  }
}

function deploy(env) {
  for (const key of ['JWT_KEY_ID', 'JWT_SECRET', 'JWT_SECONDARY_SECRETS_JSON']) delete process.env[key];
  Object.assign(process.env, env);
}

async function main() {
  const secretV1 = 'jwt-secret-v1-at-least-32-characters-long';
  const secretV2 = 'jwt-secret-v2-at-least-32-characters-long';
  const payload = { sub: 'user-1', email: 'drill@example.test', role: 'ADMIN' };

  console.log('== Step 0: day-1 deploy -- a token signed before rotation support existed has no kid at all ==');
  const preRotationJwt = new JwtService({ secret: secretV1, signOptions: { expiresIn: '2h' } }); // no keyid configured
  const tokenNoKid = await preRotationJwt.signAsync(payload);
  deploy({ JWT_SECRET: secretV1 }); // JWT_KEY_ID defaults to jwt-v1, no secondary secrets configured
  const noKidResult = await verifyJwtWithRotationSupport(preRotationJwt, tokenNoKid);
  check('a token with no kid at all verifies against the active secret (the only sane default before this feature existed)', noKidResult?.sub === 'user-1');

  console.log('\n== Step 1: baseline -- jwt-v1 is active, no rotation happening yet ==');
  const jwtV1 = new JwtService({ secret: secretV1, signOptions: { expiresIn: '2h', keyid: 'jwt-v1' } });
  const tokenOld = await jwtV1.signAsync(payload);
  deploy({ JWT_KEY_ID: 'jwt-v1', JWT_SECRET: secretV1 });
  const baseline = await verifyJwtWithRotationSupport(jwtV1, tokenOld);
  check('a token signed under jwt-v1 verifies while jwt-v1 is still active', baseline?.sub === 'user-1');

  console.log('\n== Step 2 (runbook step 2): jwt-v2 becomes the new active signer, jwt-v1 stays trusted as a secondary ==');
  const jwtV2 = new JwtService({ secret: secretV2, signOptions: { expiresIn: '2h', keyid: 'jwt-v2' } });
  const tokenNew = await jwtV2.signAsync(payload);
  deploy({ JWT_KEY_ID: 'jwt-v2', JWT_SECRET: secretV2, JWT_SECONDARY_SECRETS_JSON: JSON.stringify({ 'jwt-v1': secretV1 }) });

  const oldStillVerifies = await verifyJwtWithRotationSupport(jwtV1, tokenOld);
  check('the OLD token (signed under jwt-v1, not yet expired) still verifies once jwt-v2 becomes active -- this is the actual point of overlap', oldStillVerifies?.sub === 'user-1');
  const newVerifiesDuringOverlap = await verifyJwtWithRotationSupport(jwtV2, tokenNew);
  check('a freshly issued token (signed under jwt-v2) verifies at the same time', newVerifiesDuringOverlap?.sub === 'user-1');

  console.log('\n== Step 3 (runbook step 6): overlap window closes -- jwt-v1 removed from the trusted secondary set ==');
  deploy({ JWT_KEY_ID: 'jwt-v2', JWT_SECRET: secretV2 });
  const newStillVerifiesAfterRotation = await verifyJwtWithRotationSupport(jwtV2, tokenNew);
  check('the new token (jwt-v2) still verifies after jwt-v1 is dropped', newStillVerifiesAfterRotation?.sub === 'user-1');
  await rejects('the OLD token (jwt-v1) now fails closed once its key is no longer trusted -- proving why the runbook says to wait out the token lifetime before this step',
    () => verifyJwtWithRotationSupport(jwtV1, tokenOld),
    'JWT signing key is not trusted');

  console.log('\n== Negative control: an unknown/never-configured kid is rejected outright ==');
  deploy({ JWT_KEY_ID: 'jwt-v2', JWT_SECRET: secretV2, JWT_SECONDARY_SECRETS_JSON: JSON.stringify({ 'jwt-v1': secretV1 }) });
  const jwtUnknown = new JwtService({ secret: 'some-other-secret-entirely-unrelated-32chars', signOptions: { expiresIn: '2h', keyid: 'jwt-imposter' } });
  const tokenFromUnknownKey = await jwtUnknown.signAsync(payload);
  await rejects('a token signed by a key id the school has never been told to trust is rejected',
    () => verifyJwtWithRotationSupport(jwtUnknown, tokenFromUnknownKey),
    'JWT signing key is not trusted');

  console.log('\n== Negative control: standard JWT signature tampering is still caught (this feature did not weaken it) ==');
  const tamperedToken = tokenNew.slice(0, -4) + 'AAAA';
  await rejects('a token with a tampered signature still fails verification, not just an untrusted-key check',
    () => verifyJwtWithRotationSupport(jwtV2, tamperedToken),
    'invalid signature');

  for (const key of ['JWT_KEY_ID', 'JWT_SECRET', 'JWT_SECONDARY_SECRETS_JSON']) delete process.env[key];
  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${passed}/${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
