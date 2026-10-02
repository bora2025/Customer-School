'use strict';

// Read-only prerequisite for adopting legacy CardTemplate rows. It never creates a
// journal, backup, migration or plugin row. Do not use this report as cutover approval.
const crypto = require('crypto');

const TARGET_TABLE = 'plugin_wattanam_document_designer_template';
const TYPES = new Set(['student', 'staff', 'teacher-part-time', 'certificate-student', 'certificate-staff', 'qr-sheet', 'general']);
const LEGACY_ASSET_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const LEGACY_ASSET_MAX_BYTES = 1024 * 1024;

function inspectLegacyAsset(value, location, inventory, blockers) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string') {
    blockers.push(`invalid legacy asset reference at ${location}`);
    return;
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) {
    blockers.push(`non-portable legacy asset reference at ${location}; embed it before adoption`);
    return;
  }
  const mimeType = match[1].toLowerCase();
  if (!LEGACY_ASSET_MIMES.has(mimeType)) {
    blockers.push(`unsupported legacy asset MIME ${mimeType} at ${location}`);
    return;
  }
  const base64 = match[2];
  if (base64.length % 4 !== 0) {
    blockers.push(`invalid legacy asset base64 at ${location}`);
    return;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || bytes.byteLength === 0) {
    blockers.push(`invalid legacy asset base64 at ${location}`);
    return;
  }
  if (bytes.byteLength > LEGACY_ASSET_MAX_BYTES) {
    blockers.push(`legacy asset exceeds ${LEGACY_ASSET_MAX_BYTES} bytes at ${location}`);
    return;
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const existing = inventory.get(sha256);
  if (existing) existing.references.push(location);
  else inventory.set(sha256, { sha256, mimeType, sizeBytes: bytes.byteLength, references: [location] });
}

function inspectLegacyDesignAssets(design, templateId, inventory, blockers) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return;
  if (design.logos !== undefined && !Array.isArray(design.logos)) {
    blockers.push(`invalid logos collection for template ${templateId}`);
    return;
  }
  for (const [index, logo] of (design.logos || []).entries()) {
    if (!logo || typeof logo !== 'object' || Array.isArray(logo)) {
      blockers.push(`invalid logo ${index + 1} for template ${templateId}`);
      continue;
    }
    inspectLegacyAsset(logo.src, `template ${templateId} logo ${index + 1} src`, inventory, blockers);
    inspectLegacyAsset(logo.originalSrc, `template ${templateId} logo ${index + 1} originalSrc`, inventory, blockers);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');
  const hash = crypto.createHash('sha256');
  const blockers = [];
  const activeByType = new Map();
  const countsByType = Object.create(null);
  let cursor = null;
  let rowCount = 0;
  let designBytes = 0;
  let previousId = null;
  const assetInventory = new Map();

  while (true) {
    const rows = await adapter.readSourceChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('source adapter returned an invalid chunk');
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousId !== null && row.id <= previousId)) throw new Error('source rows must have strictly increasing IDs');
      previousId = row.id;
      rowCount++;
      countsByType[row.cardType] = (countsByType[row.cardType] || 0) + 1;
      if (!TYPES.has(row.cardType)) blockers.push(`unsupported cardType for template ${row.id}`);
      if (!row.design || typeof row.design !== 'object' || Array.isArray(row.design)) blockers.push(`invalid design for template ${row.id}`);
      if (row.design?.cardType && row.design.cardType !== row.cardType) blockers.push(`cardType/design mismatch for template ${row.id}`);
      inspectLegacyDesignAssets(row.design, row.id, assetInventory, blockers);
      if (row.name === '__active__') {
        const prior = activeByType.get(row.cardType);
        if (prior) blockers.push(`duplicate active templates for ${row.cardType}: ${prior}, ${row.id}`);
        activeByType.set(row.cardType, row.id);
      }
      const design = JSON.stringify(canonical(row.design));
      designBytes += Buffer.byteLength(design);
      hash.update(JSON.stringify([row.id, row.name, row.cardType, canonical(row.design), row.createdAt?.toISOString?.() || row.createdAt, row.updatedAt?.toISOString?.() || row.updatedAt]));
      hash.update('\n');
    }
    cursor = rows.at(-1).id;
  }

  const targetExists = await adapter.targetExists();
  if (!targetExists) blockers.push(`target table ${TARGET_TABLE} is absent; install the signed plugin first`);
  const assets = [...assetInventory.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
  return {
    format: 'wattanam-document-designer-adoption-preflight-v1',
    readOnly: true, ready: blockers.length === 0, blockers,
    source: { rowCount, countsByType, activeByType: Object.fromEntries(activeByType), designBytes, sha256: hash.digest('hex') },
    assets: {
      uniqueCount: assets.length,
      referenceCount: assets.reduce((sum, asset) => sum + asset.references.length, 0),
      totalBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
      items: assets,
      portable: !blockers.some((blocker) => blocker.includes('legacy asset') || blocker.includes('logos collection') || blocker.includes('logo ')),
    },
    target: { table: TARGET_TABLE, exists: targetExists },
    nextStep: 'Take a school-bound recovery backup; run the guarded copy only on a controlled environment before any cutover',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await inspect({
      readSourceChunk: ({ after, limit }) => prisma.cardTemplate.findMany({
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: { id: 'asc' }, take: limit,
        select: { id: true, name: true, cardType: true, design: true, createdAt: true, updatedAt: true },
      }),
      targetExists: async () => {
        const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`);
        return rows[0]?.exists === true;
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Preflight failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { inspect, inspectLegacyAsset, inspectLegacyDesignAssets, TARGET_TABLE, TYPES, LEGACY_ASSET_MIMES, LEGACY_ASSET_MAX_BYTES };
