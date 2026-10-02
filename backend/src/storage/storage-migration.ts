import { ObjectStorageProvider } from './object-storage';

export type StorageMigrationResult = {
  source: string; target: string; total: number; copied: number; alreadyMatching: number; verified: number;
  objects: Array<{ key: string; size: number; sha256: string; action: 'copied' | 'matched' }>;
};

export async function copyAndVerifyStorage(source: ObjectStorageProvider, target: ObjectStorageProvider): Promise<StorageMigrationResult> {
  if (source.kind === target.kind) throw new Error('Storage migration source and target must be different');
  const objects = await source.list();
  const result: StorageMigrationResult = { source: source.kind, target: target.kind, total: objects.length, copied: 0, alreadyMatching: 0, verified: 0, objects: [] };
  for (const object of objects) {
    const sourceValue = await source.get(object.key);
    if (!sourceValue) throw new Error(`Source object disappeared during migration: ${object.key}`);
    const existing = await target.checksum(object.key);
    const action = existing === object.sha256 ? 'matched' : 'copied';
    if (action === 'copied') { await target.put(object.key, sourceValue); result.copied += 1; }
    else result.alreadyMatching += 1;
    const targetChecksum = await target.checksum(object.key);
    if (targetChecksum !== object.sha256) throw new Error(`Checksum verification failed for ${object.key}`);
    result.verified += 1;
    result.objects.push({ key: object.key, size: object.size, sha256: object.sha256, action });
  }
  return result;
}
