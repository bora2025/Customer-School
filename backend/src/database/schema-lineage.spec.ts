import { assertCompatibleSchemaLineage, CORE_SCHEMA_LINEAGE, LEGACY_SCHEMA_LINEAGE } from './schema-lineage';

function database(rows: unknown[] = []) {
  return { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
}

describe('schema lineage startup guard', () => {
  it('accepts a clean core lineage for the core distribution', async () => {
    const db = database([{ lineage: CORE_SCHEMA_LINEAGE, schema_version: 1 }]);
    await expect(assertCompatibleSchemaLineage(db, 'core')).resolves.toEqual(expect.objectContaining({ lineage: CORE_SCHEMA_LINEAGE }));
  });

  it('allows a marked legacy database to use core composition during migration', async () => {
    const db = database([{ lineage: LEGACY_SCHEMA_LINEAGE, schema_version: 1 }]);
    await expect(assertCompatibleSchemaLineage(db, 'core')).resolves.toBeDefined();
  });

  it('rejects a core-only database in legacy-full mode', async () => {
    const db = database([{ lineage: CORE_SCHEMA_LINEAGE, schema_version: 1 }]);
    await expect(assertCompatibleSchemaLineage(db, 'legacy-full')).rejects.toThrow('incompatible');
  });

  it('fails closed when the marker is absent or cannot be queried', async () => {
    await expect(assertCompatibleSchemaLineage(database(), 'core')).rejects.toThrow('marker is missing');
    const db = { $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
    await expect(assertCompatibleSchemaLineage(db, 'core')).rejects.toThrow('run the matching Prisma migrations');
  });
});
