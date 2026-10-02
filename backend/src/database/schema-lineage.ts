import type { Distribution } from '../config/environment';

export const CORE_SCHEMA_LINEAGE = 'wattanam-core-v1';
export const LEGACY_SCHEMA_LINEAGE = 'wattanam-legacy-v1';

type LineageRow = { lineage: string; schema_version: number };
type LineageReader = { $queryRawUnsafe<T>(query: string): Promise<T> };

export function acceptedSchemaLineages(distribution: Distribution): ReadonlySet<string> {
  // A legacy database may temporarily run the core composition during a safe module cutover.
  return distribution === 'core'
    ? new Set([CORE_SCHEMA_LINEAGE, LEGACY_SCHEMA_LINEAGE])
    : new Set([LEGACY_SCHEMA_LINEAGE]);
}

export async function assertCompatibleSchemaLineage(
  database: LineageReader,
  distribution: Distribution,
): Promise<LineageRow> {
  let rows: LineageRow[];
  try {
    rows = await database.$queryRawUnsafe<LineageRow[]>(
      'SELECT "lineage", "schema_version" FROM "_wattanam_schema_lineage" WHERE "id" = \'singleton\'',
    );
  } catch {
    throw new Error(
      `Database schema lineage is unavailable for ${distribution}; run the matching Prisma migrations before startup`,
    );
  }

  const row = rows[0];
  if (!row) throw new Error(`Database schema lineage marker is missing for ${distribution}`);
  if (!acceptedSchemaLineages(distribution).has(row.lineage)) {
    throw new Error(`Database schema lineage ${row.lineage} is incompatible with ${distribution}`);
  }
  if (!Number.isInteger(row.schema_version) || row.schema_version < 1) {
    throw new Error(`Database schema lineage ${row.lineage} has an invalid schema version`);
  }
  return row;
}
