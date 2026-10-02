import { createHash } from 'node:crypto';
import { ObjectStorageProvider } from './object-storage';
import { copyAndVerifyStorage } from './storage-migration';

describe('storage migration', () => {
  it('copies, verifies, resumes idempotently, and leaves the source untouched for rollback', async () => {
    const source = memory('local'); const target = memory('s3');
    await source.put('one.txt', Buffer.from('one')); await source.put('nested/two.txt', Buffer.from('two'));
    const first = await copyAndVerifyStorage(source, target);
    expect(first).toMatchObject({ total: 2, copied: 2, alreadyMatching: 0, verified: 2 });
    const second = await copyAndVerifyStorage(source, target);
    expect(second).toMatchObject({ total: 2, copied: 0, alreadyMatching: 2, verified: 2 });
    expect(await source.list()).toHaveLength(2);
    expect(await target.get('nested/two.txt')).toEqual(Buffer.from('two'));
  });

  it('fails closed when the target reports a different post-write checksum', async () => {
    const source = memory('local'); const target = memory('s3');
    await source.put('one.txt', Buffer.from('one'));
    target.checksum = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('bad');
    await expect(copyAndVerifyStorage(source, target)).rejects.toThrow('Checksum verification failed');
  });
});

function memory(kind: string): ObjectStorageProvider {
  const map = new Map<string, Buffer>(); const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  return { kind, async get(key) { return map.get(key) ?? null; }, async put(key, value) { map.set(key, Buffer.from(value)); return { key, size: value.length, sha256: digest(value) }; },
    async delete(key) { map.delete(key); }, async list(prefix = '') { return [...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.length, sha256: digest(value) })); },
    async checksum(key) { const value = map.get(key); return value ? digest(value) : null; } };
}
