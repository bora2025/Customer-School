import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { ObjectStorageProvider, S3StorageProvider } from '../storage/object-storage';

/**
 * Off-site copies of recovery sets. A backup that lives only on the worker's volume dies with that
 * volume or with the hosting project, so every nightly recovery set is also uploaded to an
 * S3-compatible bucket that should belong to a different provider (R2, B2, S3, ...).
 *
 * Every file is encrypted client-side with AES-256-GCM before upload: the bucket and its
 * credentials never see school data in the clear. Format of an `.enc` object:
 *   "WTNOB1" (6 bytes) | IV (12 bytes) | ciphertext | GCM auth tag (16 bytes)
 * `scripts/fetch-offsite-backup.js` implements the matching decryption for restores.
 */
export const OFFSITE_BACKUP = Symbol('OFFSITE_BACKUP');
export const OFFSITE_MAGIC = Buffer.from('WTNOB1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Files are encrypted in memory; refuse anything a single Buffer cannot safely hold. */
export const OFFSITE_MAX_FILE_BYTES = 1024 * 1024 * 1024;

export interface OffsiteBackupConfig {
  storage: ObjectStorageProvider;
  key: Buffer;
  retentionDays: number;
}

export interface OffsiteSetFile { name: string; key: string; sha256: string; sizeBytes: number }
export interface OffsiteSetRecord {
  format: 'wattanam-offsite-set-v1';
  setId: string;
  journalFile: string;
  createdAt: string;
  uploadedAt: string;
  files: OffsiteSetFile[];
}

interface JournalLike {
  journalFile: string;
  createdAt: string;
  database: { file: string };
  pluginFiles?: { archive?: { file?: string } };
  pluginData?: { archive?: { file?: string } };
}

export function encryptOffsite(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([OFFSITE_MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptOffsite(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < OFFSITE_MAGIC.length + IV_BYTES + TAG_BYTES || !sealed.subarray(0, OFFSITE_MAGIC.length).equals(OFFSITE_MAGIC)) {
    throw new Error('Not a Wattanam off-site backup object');
  }
  const iv = sealed.subarray(OFFSITE_MAGIC.length, OFFSITE_MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(OFFSITE_MAGIC.length + IV_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function sha256(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when BACKUP_OFFSITE_S3_BUCKET is set`);
  return value;
}

/** Returns null when off-site backup is not configured (BACKUP_OFFSITE_S3_BUCKET unset). */
export function readOffsiteBackupConfig(env: NodeJS.ProcessEnv = process.env, storage?: ObjectStorageProvider): OffsiteBackupConfig | null {
  const bucket = env.BACKUP_OFFSITE_S3_BUCKET?.trim();
  if (!bucket) return null;
  const key = Buffer.from(required(env, 'BACKUP_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  const retentionDays = Number(env.BACKUP_OFFSITE_RETENTION_DAYS?.trim() || 35);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_OFFSITE_RETENTION_DAYS must be an integer between 1 and 3650');
  }
  if (storage) return { storage, key, retentionDays };
  const endpoint = env.BACKUP_OFFSITE_S3_ENDPOINT?.trim() || undefined;
  if (endpoint && env.NODE_ENV === 'production' && new URL(endpoint).protocol !== 'https:') {
    throw new Error('BACKUP_OFFSITE_S3_ENDPOINT must use HTTPS in production');
  }
  const client = new S3Client({
    endpoint,
    region: required(env, 'BACKUP_OFFSITE_S3_REGION'),
    forcePathStyle: env.BACKUP_OFFSITE_S3_FORCE_PATH_STYLE?.trim() === 'true',
    credentials: {
      accessKeyId: required(env, 'BACKUP_OFFSITE_S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY'),
    },
  });
  return { storage: new S3StorageProvider(client, bucket, env.BACKUP_OFFSITE_S3_PREFIX?.trim() || 'school-backups'), key, retentionDays };
}

export class OffsiteBackupUploader {
  constructor(private readonly config: OffsiteBackupConfig) {}

  /** Uploads artifacts first and the set record + latest pointer last, so `latest.json` only ever
   * names a complete set. Throws on any failure; the local recovery set is untouched. */
  async upload(directory: string, journal: JournalLike, now = new Date()): Promise<OffsiteSetRecord> {
    const setId = journal.journalFile.replace(/\.recovery-set\.json$/, '');
    if (!/^[A-Za-z0-9._-]+$/.test(setId)) throw new Error(`Unsafe recovery set id: ${setId}`);
    // restore-database.js refuses a dump without its sibling manifest (checksum + schema lineage),
    // and the journal does not list it, so it must be uploaded explicitly. Found by the first
    // restore drill (2026-11-10): sets uploaded without it were not restorable.
    const databaseManifest = journal.database.file.replace(/\.dump$/, '.manifest.json');
    if (databaseManifest === journal.database.file) throw new Error(`Unexpected database archive name: ${journal.database.file}`);
    try { await fs.access(path.join(directory, databaseManifest)); } catch {
      throw new Error(`Database manifest ${databaseManifest} is missing; refusing to upload an unrestorable set`);
    }
    const names = [journal.database.file, databaseManifest, journal.pluginFiles?.archive?.file, journal.pluginData?.archive?.file, journal.journalFile]
      .filter((name): name is string => !!name);
    const files: OffsiteSetFile[] = [];
    for (const name of names) {
      if (path.basename(name) !== name) throw new Error(`Recovery set file must be a plain file name: ${name}`);
      const filePath = path.join(directory, name);
      const { size } = await fs.stat(filePath);
      if (size > OFFSITE_MAX_FILE_BYTES) throw new Error(`${name} is ${size} bytes; off-site upload supports up to ${OFFSITE_MAX_FILE_BYTES}`);
      const plaintext = await fs.readFile(filePath);
      const key = `sets/${setId}/${name}.enc`;
      await this.config.storage.put(key, encryptOffsite(plaintext, this.config.key));
      files.push({ name, key, sha256: sha256(plaintext), sizeBytes: plaintext.length });
    }
    const record: OffsiteSetRecord = {
      format: 'wattanam-offsite-set-v1', setId, journalFile: journal.journalFile,
      createdAt: journal.createdAt, uploadedAt: now.toISOString(), files,
    };
    const body = Buffer.from(JSON.stringify(record, null, 2));
    await this.config.storage.put(`sets/${setId}/set.json`, body);
    await this.config.storage.put('latest.json', body);
    return record;
  }

  /** Small plain-JSON records next to the sets (restore-drill evidence). Keys are restricted so this
   * can never overwrite or read an encrypted set. They hold no school data. */
  async writeRecord(key: 'drills/latest.json' | 'drills/last-success.json', value: unknown): Promise<void> {
    await this.config.storage.put(key, Buffer.from(JSON.stringify(value, null, 2)));
  }

  async readRecord<T>(key: 'drills/latest.json' | 'drills/last-success.json'): Promise<T | null> {
    const raw = await this.config.storage.get(key);
    return raw ? JSON.parse(raw.toString('utf8')) as T : null;
  }

  async latest(): Promise<OffsiteSetRecord | null> {
    const raw = await this.config.storage.get('latest.json');
    if (!raw) return null;
    const record = JSON.parse(raw.toString('utf8')) as OffsiteSetRecord;
    if (record.format !== 'wattanam-offsite-set-v1' || !record.createdAt) throw new Error('Off-site latest.json is invalid');
    return record;
  }

  /** Deletes sets whose recovery point is older than the retention window. Never deletes the set
   * `latest.json` points to, so a stalled backup job cannot prune its way to zero copies. */
  async prune(now = new Date()): Promise<string[]> {
    const latest = await this.latest();
    const cutoff = now.getTime() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const objects = await this.config.storage.list('sets/');
    const setIds = [...new Set(objects.map((object) => object.key.split('/')[1]).filter(Boolean))];
    const removed: string[] = [];
    for (const setId of setIds) {
      if (setId === latest?.setId) continue;
      const raw = await this.config.storage.get(`sets/${setId}/set.json`);
      if (raw) {
        const createdAt = Date.parse((JSON.parse(raw.toString('utf8')) as OffsiteSetRecord).createdAt);
        if (!(createdAt < cutoff)) continue;
      } else if (!latest) {
        // No set.json means an interrupted upload (set.json is written last). Uploads and pruning
        // run sequentially in one job, so it is safe to reclaim, but only once a complete set exists.
        continue;
      }
      for (const object of objects.filter((item) => item.key.startsWith(`sets/${setId}/`))) await this.config.storage.delete(object.key);
      removed.push(setId);
    }
    return removed;
  }
}
