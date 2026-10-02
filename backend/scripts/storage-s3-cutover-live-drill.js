/**
 * Live drill closing B-015's stated "open acceptance work": local->dual->S3 migration,
 * post-cutover write/read, recovery-set S3-only rejection, S3->local rollback, checksum
 * comparison, and denied cross-prefix access -- all against a real S3-compatible service
 * (MinIO), using the real, unmodified production functions
 * (createPluginStorageProvider/copyAndVerifyStorage/S3StorageProvider/LocalVolumeStorageProvider
 * from src/storage), not reimplemented logic.
 *
 * Run (from backend/, after `npm run build`, against a real MinIO instance):
 *   PLUGIN_STORAGE_S3_ENDPOINT=http://localhost:PORT \
 *   PLUGIN_STORAGE_S3_ACCESS_KEY_ID=... PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY=... \
 *   PLUGIN_STORAGE_S3_BUCKET=wattanam-drill \
 *   node scripts/storage-s3-cutover-live-drill.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createPluginStorageProvider } = require('../dist/storage/storage-config');
const { copyAndVerifyStorage } = require('../dist/storage/storage-migration');
const { S3StorageProvider } = require('../dist/storage/object-storage');

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

function baseS3Env(overrides) {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    PLUGIN_STORAGE_S3_ENDPOINT: process.env.PLUGIN_STORAGE_S3_ENDPOINT,
    PLUGIN_STORAGE_S3_BUCKET: process.env.PLUGIN_STORAGE_S3_BUCKET,
    PLUGIN_STORAGE_S3_REGION: process.env.PLUGIN_STORAGE_S3_REGION || 'us-east-1',
    PLUGIN_STORAGE_S3_ACCESS_KEY_ID: process.env.PLUGIN_STORAGE_S3_ACCESS_KEY_ID,
    PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY: process.env.PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY,
    PLUGIN_STORAGE_S3_FORCE_PATH_STYLE: 'true',
    ...overrides,
  };
}

async function ensureBucket() {
  const client = new S3Client({
    endpoint: process.env.PLUGIN_STORAGE_S3_ENDPOINT,
    region: process.env.PLUGIN_STORAGE_S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.PLUGIN_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY },
  });
  try { await client.send(new HeadBucketCommand({ Bucket: process.env.PLUGIN_STORAGE_S3_BUCKET })); }
  catch { await client.send(new CreateBucketCommand({ Bucket: process.env.PLUGIN_STORAGE_S3_BUCKET })); }
  return client;
}

async function main() {
  for (const name of ['PLUGIN_STORAGE_S3_ENDPOINT', 'PLUGIN_STORAGE_S3_BUCKET', 'PLUGIN_STORAGE_S3_ACCESS_KEY_ID', 'PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY']) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }
  const s3Client = await ensureBucket();
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-drill-local-'));
  const rollbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-drill-rollback-'));

  console.log('== Part 1: seed real objects under a local-only provider ==');
  const localOnlyEnv = { PLUGIN_STORAGE_PROVIDER: 'local', PLUGIN_DATA_DIR: localRoot };
  const localOnly = createPluginStorageProvider(localOnlyEnv);
  const seedFiles = {
    'installation-a/report.pdf': Buffer.from('installation-a report contents'),
    'installation-a/photos/1.jpg': Buffer.from('installation-a photo bytes'),
    'installation-a/settings.json': Buffer.from(JSON.stringify({ theme: 'default' })),
  };
  for (const [key, value] of Object.entries(seedFiles)) await localOnly.put(key, value);
  const seededList = await localOnly.list();
  check('all seeded objects are visible under the local-only provider', seededList.length === Object.keys(seedFiles).length);

  console.log('\n== Part 2: local -> dual (local-primary, S3-secondary) -- new writes land in both ==');
  const dualEnv = baseS3Env({ PLUGIN_STORAGE_PROVIDER: 'dual-local-primary', PLUGIN_DATA_DIR: localRoot, PLUGIN_STORAGE_S3_PREFIX: 'installation-a-drill' });
  const dual = createPluginStorageProvider(dualEnv);
  const newDualKey = 'installation-a/new-during-dual.txt';
  const newDualValue = Buffer.from('written while in dual mode');
  await dual.put(newDualKey, newDualValue);
  const s3SideOfDual = createPluginStorageProvider(baseS3Env({ PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_PREFIX: 'installation-a-drill' }));
  const s3CopyOfNewKey = await s3SideOfDual.get(newDualKey);
  check('a write made while in dual mode really landed in S3 too, not just locally', s3CopyOfNewKey && s3CopyOfNewKey.equals(newDualValue));
  const preMigrationS3List = await s3SideOfDual.list();
  check('objects seeded BEFORE dual mode are correctly NOT yet in S3 (dual-write only covers new writes, migration backfills the rest)', preMigrationS3List.length === 1);

  console.log('\n== Part 3: backfill pre-existing objects into S3 via the real migration function ==');
  const localForMigration = createPluginStorageProvider({ PLUGIN_STORAGE_PROVIDER: 'local', PLUGIN_DATA_DIR: localRoot });
  const s3ForMigration = createPluginStorageProvider(baseS3Env({ PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_PREFIX: 'installation-a-drill' }));
  const migrationResult = await copyAndVerifyStorage(localForMigration, s3ForMigration);
  check('migration copied exactly the objects not already in S3 (3 pre-existing, the dual-mode one already matched)', migrationResult.copied === 3 && migrationResult.alreadyMatching === 1);
  check('every migrated object was checksum-verified against the source', migrationResult.verified === migrationResult.total);
  const postMigrationS3List = await s3ForMigration.list();
  check('all 4 objects are now present in S3 after migration', postMigrationS3List.length === 4);
  for (const [key, value] of Object.entries(seedFiles)) {
    const fromS3 = await s3ForMigration.get(key);
    check(`migrated object ${key} is byte-identical in S3 to the local original`, fromS3 && fromS3.equals(value));
  }

  console.log('\n== Part 4: cutover to pure S3 mode -- post-cutover write/read ==');
  const pureS3Env = baseS3Env({ PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_PREFIX: 'installation-a-drill' });
  const pureS3 = createPluginStorageProvider(pureS3Env);
  const postCutoverKey = 'installation-a/written-after-cutover.txt';
  const postCutoverValue = Buffer.from('written entirely post-cutover, local never touched');
  await pureS3.put(postCutoverKey, postCutoverValue);
  const readBack = await pureS3.get(postCutoverKey);
  check('a write made after cutover to pure S3 mode reads back correctly', readBack && readBack.equals(postCutoverValue));
  const localStillHasOldDataOnly = await localForMigration.list();
  check('local storage was never touched by the cutover -- it still only has the pre-cutover objects (source retained)', localStillHasOldDataOnly.length === 4);

  console.log('\n== Part 5: recovery-set scripts reject S3-only mode rather than silently omitting remote data ==');
  const { spawnSync } = require('child_process');
  const recoveryResult = spawnSync(process.execPath, [path.join(__dirname, 'backup-recovery-set.js')], {
    env: { ...process.env, PLUGIN_STORAGE_PROVIDER: 's3', DATABASE_URL: process.env.DATABASE_URL || 'postgresql://invalid/unused' },
    encoding: 'utf8',
  });
  check('backup-recovery-set.js exits non-zero under PLUGIN_STORAGE_PROVIDER=s3', recoveryResult.status !== 0);
  check('backup-recovery-set.js names the real remediation (storage:migrate + dual-s3-primary) rather than a generic error', (recoveryResult.stdout + recoveryResult.stderr).includes('storage:migrate') && (recoveryResult.stdout + recoveryResult.stderr).includes('dual-s3-primary'));

  console.log('\n== Part 6: S3 -> local rollback, checksum comparison ==');
  const localRollbackTarget = createPluginStorageProvider({ PLUGIN_STORAGE_PROVIDER: 'local', PLUGIN_DATA_DIR: rollbackRoot });
  const rollbackResult = await copyAndVerifyStorage(pureS3, localRollbackTarget);
  check('rollback copied all 5 objects (4 migrated + 1 post-cutover) from S3 back to a fresh local target', rollbackResult.copied === 5 && rollbackResult.total === 5);
  const postRollbackList = await localRollbackTarget.list();
  check('every object exists in the rolled-back local target', postRollbackList.length === 5);
  for (const [key, value] of Object.entries(seedFiles)) {
    const restored = await localRollbackTarget.get(key);
    check(`rolled-back object ${key} is byte-identical to the S3 copy (checksum comparison)`, restored && restored.equals(value));
  }
  const s3StillHasEverything = await pureS3.list();
  check('rollback never deleted the S3 source -- all 5 objects remain in S3', s3StillHasEverything.length === 5);

  console.log('\n== Part 7: negative control -- migration verification catches real corruption ==');
  await rejects('copyAndVerifyStorage throws if the target ends up with a mismatched checksum after a write',
    async () => {
      const corruptingS3 = new S3StorageProvider(s3Client, process.env.PLUGIN_STORAGE_S3_BUCKET, 'installation-a-corrupt-drill');
      // Simulate a corrupted write reaching the target: put() succeeds, but the object that
      // actually lands (and whatever checksum() reports for it) doesn't match what was sent --
      // exactly the class of failure real transport/media corruption would produce.
      corruptingS3.checksum = async () => '0'.repeat(64);
      const freshLocal = createPluginStorageProvider({ PLUGIN_STORAGE_PROVIDER: 'local', PLUGIN_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'storage-drill-corrupt-')) });
      await freshLocal.put('x.txt', Buffer.from('original content'));
      await copyAndVerifyStorage(freshLocal, corruptingS3);
    },
    'Checksum verification failed');

  console.log('\n== Part 8: denied cross-prefix access -- two installations sharing one bucket cannot see each other ==');
  const installationBEnv = baseS3Env({ PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_PREFIX: 'installation-b-drill' });
  const installationB = createPluginStorageProvider(installationBEnv);
  await installationB.put('installation-b/secret.txt', Buffer.from('installation B private data'));
  const crossRead = await pureS3.get('installation-b/secret.txt');
  check('installation A\'s provider cannot read an object under installation B\'s prefix (returns null, not the data)', crossRead === null);
  const crossList = await pureS3.list();
  check('installation A\'s list() never returns installation B\'s keys even though they share one bucket', !crossList.some((item) => item.key.includes('secret.txt')));
  const bList = await installationB.list();
  check('installation B does see its own object under its own prefix', bList.length === 1 && bList[0].key === 'installation-b/secret.txt');

  fs.rmSync(localRoot, { recursive: true, force: true });
  fs.rmSync(rollbackRoot, { recursive: true, force: true });

  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${passed}/${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
