import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type StoredObject = { key: string; size: number; sha256: string };

export interface ObjectStorageProvider {
  readonly kind: string;
  get(key: string): Promise<Buffer | null>;
  put(key: string, value: Buffer): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<StoredObject[]>;
  checksum(key: string): Promise<string | null>;
}

export function safeObjectKey(key: string) {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('\0') || key.split('/').includes('..')) throw new Error('Storage object key is invalid');
  return key;
}

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export class LocalVolumeStorageProvider implements ObjectStorageProvider {
  readonly kind = 'local';
  constructor(private readonly root: string) {
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root) throw new Error('Storage root cannot be a filesystem root');
    this.root = resolved;
  }
  private file(key: string) {
    safeObjectKey(key);
    const file = path.resolve(this.root, key);
    if (!file.startsWith(`${this.root}${path.sep}`)) throw new Error('Storage object escapes its root');
    return file;
  }
  async get(key: string) { try { return await fs.readFile(this.file(key)); } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; } }
  async put(key: string, value: Buffer) {
    const file = this.file(key); await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
    const temporary = `${file}.${randomUUID()}.partial`;
    try { await fs.writeFile(temporary, value, { flag: 'wx', mode: 0o640 }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
    return { key, size: value.length, sha256: sha256(value) };
  }
  async delete(key: string) { await fs.rm(this.file(key), { force: true }); }
  async list(prefix = '') {
    if (prefix) safeObjectKey(prefix);
    const output: StoredObject[] = [];
    const visit = async (directory: string) => {
      let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error: any) { if (error?.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && !entry.name.endsWith('.partial')) {
          const key = path.relative(this.root, absolute).split(path.sep).join('/');
          if (key.startsWith(prefix)) { const value = await fs.readFile(absolute); output.push({ key, size: value.length, sha256: sha256(value) }); }
        }
      }
    };
    await visit(this.root); return output.sort((a, b) => a.key.localeCompare(b.key));
  }
  async checksum(key: string) { const value = await this.get(key); return value ? sha256(value) : null; }
}

export class S3StorageProvider implements ObjectStorageProvider {
  readonly kind = 's3';
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly keyPrefix = '') {}
  private key(key: string) { safeObjectKey(key); return this.keyPrefix ? `${this.keyPrefix.replace(/\/$/, '')}/${key}` : key; }
  private listPrefix(prefix: string) { if (prefix) safeObjectKey(prefix); const root = this.keyPrefix.replace(/\/$/, ''); return root ? `${root}/${prefix}` : prefix; }
  private externalKey(key: string) { return this.keyPrefix ? key.slice(this.keyPrefix.replace(/\/$/, '').length + 1) : key; }
  async get(key: string) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      if (!result.Body) return Buffer.alloc(0);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error: any) { if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null; throw error; }
  }
  async put(key: string, value: Buffer) {
    const digest = sha256(value);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: value, Metadata: { sha256: digest } }));
    return { key, size: value.length, sha256: digest };
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) })); }
  async list(prefix = '') {
    if (prefix) safeObjectKey(prefix);
    const output: StoredObject[] = []; let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.listPrefix(prefix), ContinuationToken: token }));
      for (const item of page.Contents || []) if (item.Key) output.push({ key: this.externalKey(item.Key), size: item.Size || 0, sha256: await this.checksum(this.externalKey(item.Key)) || '' });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return output.sort((a, b) => a.key.localeCompare(b.key));
  }
  async checksum(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      if (head.Metadata?.sha256) return head.Metadata.sha256;
      const value = await this.get(key); return value ? sha256(value) : null;
    } catch (error: any) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null; throw error; }
  }
}

export class DualWriteStorageProvider implements ObjectStorageProvider {
  readonly kind: string;
  constructor(private readonly primary: ObjectStorageProvider, private readonly secondary: ObjectStorageProvider) { this.kind = `dual:${primary.kind}`; }
  async get(key: string) { return (await this.primary.get(key)) ?? this.secondary.get(key); }
  async put(key: string, value: Buffer) {
    const [primary, secondary] = await Promise.all([this.primary.put(key, value), this.secondary.put(key, value)]);
    if (primary.sha256 !== secondary.sha256) throw new Error(`Dual-write checksum mismatch for ${key}`);
    return primary;
  }
  async delete(key: string) { await Promise.all([this.primary.delete(key), this.secondary.delete(key)]); }
  async list(prefix = '') {
    const [a, b] = await Promise.all([this.primary.list(prefix), this.secondary.list(prefix)]);
    return [...new Map([...a, ...b].map((entry) => [entry.key, entry])).values()].sort((x, y) => x.key.localeCompare(y.key));
  }
  async checksum(key: string) { return (await this.primary.checksum(key)) ?? this.secondary.checksum(key); }
}
