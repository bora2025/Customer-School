#!/usr/bin/env node
'use strict';

// Downloads an off-site recovery set (written by src/backup/offsite-backup.ts), decrypts every file,
// verifies each plaintext SHA-256 against the set record, and writes the files to --out. Then
// restore it with: node scripts/restore-recovery-set.js --from <out>/<journalFile> ...
//
// Usage: node scripts/fetch-offsite-backup.js --out <empty dir> [--set <setId>]
// Env:   BACKUP_ENCRYPTION_KEY, BACKUP_OFFSITE_S3_BUCKET, BACKUP_OFFSITE_S3_REGION,
//        BACKUP_OFFSITE_S3_ACCESS_KEY_ID, BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY,
//        optional BACKUP_OFFSITE_S3_ENDPOINT, BACKUP_OFFSITE_S3_PREFIX, BACKUP_OFFSITE_S3_FORCE_PATH_STYLE

const fs = require('fs');
const path = require('path');
const { createDecipheriv, createHash } = require('crypto');

const MAGIC = Buffer.from('WTNOB1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decryptOffsite(sealed, key) {
  if (sealed.length < MAGIC.length + IV_BYTES + TAG_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a Wattanam off-site backup object');
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(MAGIC.length + IV_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function required(env, name) {
  const value = env[name] && env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** `get(key) -> Buffer|null` abstracts the bucket so the restore path is testable offline. */
async function fetchSet({ get, key, setId, out }) {
  const pointer = setId ? `sets/${setId}/set.json` : 'latest.json';
  const raw = await get(pointer);
  if (!raw) throw new Error(`Off-site object not found: ${pointer}`);
  const record = JSON.parse(raw.toString('utf8'));
  if (record.format !== 'wattanam-offsite-set-v1' || !Array.isArray(record.files)) throw new Error(`${pointer} is not an off-site set record`);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  if (fs.readdirSync(out).length) throw new Error(`--out must be an empty directory: ${out}`);
  for (const file of record.files) {
    if (path.basename(file.name) !== file.name) throw new Error(`Unsafe file name in set record: ${file.name}`);
    const sealed = await get(file.key);
    if (!sealed) throw new Error(`Off-site object missing: ${file.key}`);
    const plaintext = decryptOffsite(sealed, key);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    if (digest !== file.sha256) throw new Error(`Checksum mismatch for ${file.name}`);
    fs.writeFileSync(path.join(out, file.name), plaintext, { flag: 'wx', mode: 0o600 });
  }
  return record;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const out = argument(argv, '--out');
  if (!out) throw new Error('Usage: node scripts/fetch-offsite-backup.js --out <empty dir> [--set <setId>]');
  const key = Buffer.from(required(env, 'BACKUP_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: env.BACKUP_OFFSITE_S3_ENDPOINT && env.BACKUP_OFFSITE_S3_ENDPOINT.trim() || undefined,
    region: required(env, 'BACKUP_OFFSITE_S3_REGION'),
    forcePathStyle: (env.BACKUP_OFFSITE_S3_FORCE_PATH_STYLE || '').trim() === 'true',
    credentials: { accessKeyId: required(env, 'BACKUP_OFFSITE_S3_ACCESS_KEY_ID'), secretAccessKey: required(env, 'BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY') },
  });
  const bucket = required(env, 'BACKUP_OFFSITE_S3_BUCKET');
  const prefix = ((env.BACKUP_OFFSITE_S3_PREFIX || 'school-backups').trim()).replace(/\/$/, '');
  const get = async (objectKey) => {
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/${objectKey}` }));
      return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0);
    } catch (error) {
      if (error && (error.name === 'NoSuchKey' || (error.$metadata && error.$metadata.httpStatusCode === 404))) return null;
      throw error;
    }
  };
  const record = await fetchSet({ get, key, setId: argument(argv, '--set'), out: path.resolve(out) });
  process.stdout.write(`${JSON.stringify({ status: 'fetched', setId: record.setId, createdAt: record.createdAt, journal: path.join(path.resolve(out), record.journalFile) })}\n`);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}

module.exports = { decryptOffsite, fetchSet };
