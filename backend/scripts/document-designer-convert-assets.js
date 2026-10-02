'use strict';

// Post-adoption conversion for portable embedded legacy images. It is deliberately additive:
// binaries are copied into plugin-scoped storage and deterministic asset IDs are added to the
// plugin-owned design, while the legacy src/originalSrc values remain intact for visual parity and
// rollback. Source CardTemplate rows are never changed.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLE } = require('./document-designer-adoption-preflight');
const { parseConfirmation, verifyRecoveryBackup } = require('./document-designer-adopt');

const PLUGIN_ID = 'wattanam.document-designer';

function deterministicAssetId(sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('asset SHA-256 is invalid');
  const hex = `${sha256.slice(0, 12)}5${sha256.slice(13, 16)}${((parseInt(sha256[16], 16) & 3) | 8).toString(16)}${sha256.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeEmbeddedAsset(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) return null;
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { id: deterministicAssetId(sha256), sha256, mimeType: match[1], bytes };
}

function conversionPlan(design) {
  const converted = structuredClone(design);
  const assets = new Map();
  let references = 0;
  for (const logo of Array.isArray(converted?.logos) ? converted.logos : []) {
    for (const [sourceField, idField] of [['src', 'assetId'], ['originalSrc', 'originalAssetId']]) {
      const asset = decodeEmbeddedAsset(logo[sourceField]);
      if (!asset) continue;
      logo[idField] = asset.id;
      assets.set(asset.sha256, asset);
      references++;
    }
  }
  return { design: converted, assets: [...assets.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)), references };
}

async function convertAssets({ adapter, sourceAdapter, confirmation, backup }) {
  const source = await inspect(sourceAdapter);
  if (!source.ready || source.source.sha256 !== confirmation.sourceSha256) throw new Error('source preflight is blocked or fingerprint changed');
  if (backup.schoolSlug !== confirmation.slug) throw new Error('backup does not belong to the confirmed school');
  if (backup.sourceSha256 !== confirmation.sourceSha256 || backup.stage !== 'reconciled') throw new Error('a reconciled adoption journal for this source is required');

  let cursor = null;
  let convertedTemplates = 0;
  let references = 0;
  const uniqueAssets = new Map();
  while (true) {
    const rows = await adapter.readTargetChunk({ after: cursor, limit: 100 });
    if (!rows.length) break;
    for (const row of rows) {
      const plan = conversionPlan(row.design);
      for (const asset of plan.assets) {
        await adapter.putAsset(asset);
        uniqueAssets.set(asset.sha256, asset.id);
      }
      if (plan.references) {
        const updated = await adapter.updateTargetDesign(row, plan.design);
        if (!updated) throw new Error(`template ${row.id} changed during asset conversion`);
        convertedTemplates++;
        references += plan.references;
      }
    }
    cursor = rows.at(-1).id;
  }
  return {
    format: 'wattanam-document-designer-asset-conversion-v1',
    additive: true,
    sourcePreserved: true,
    schoolSlug: confirmation.slug,
    convertedTemplates,
    uniqueAssets: uniqueAssets.size,
    references,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const confirmation = parseConfirmation(process.env);
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR is required');
  const backupName = process.env.DOCUMENT_DESIGNER_BACKUP_FILE;
  const verified = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const journalPath = path.join(directory, `document-designer-${confirmation.slug}.journal.json`);
  if (!fs.existsSync(journalPath)) throw new Error('reconciled adoption journal is required');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (journal.backupSha256 !== verified.sha256) throw new Error('adoption journal backup mismatch');

  const { PrismaClient } = require('@prisma/client');
  const { createPluginStorageProvider } = require('../dist/storage/storage-config');
  const prisma = new PrismaClient();
  const storage = createPluginStorageProvider(process.env);
  const readSourceChunk = ({ after, limit }) => prisma.cardTemplate.findMany({
    ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit,
    select: { id: true, name: true, cardType: true, design: true, createdAt: true, updatedAt: true },
  });
  try {
    const result = await convertAssets({
      confirmation,
      backup: { schoolSlug: confirmation.slug, sourceSha256: confirmation.sourceSha256, stage: journal.stage },
      sourceAdapter: {
        readSourceChunk,
        targetExists: async () => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`))[0]?.exists === true,
      },
      adapter: {
        readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
          `SELECT "id", "design", "updatedAt" FROM ${TARGET_TABLE} WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
        ),
        putAsset: async (asset) => {
          const base = `${PLUGIN_ID}/assets/${asset.id}`;
          const existing = await storage.checksum(`${base}.bin`);
          if (existing && existing !== asset.sha256) throw new Error(`asset collision for ${asset.id}`);
          if (!existing) await storage.put(`${base}.bin`, asset.bytes);
          const metadata = Buffer.from(JSON.stringify({ id: asset.id, name: `legacy-${asset.sha256.slice(0, 12)}`, mimeType: asset.mimeType, size: asset.bytes.length, sha256: asset.sha256, source: 'legacy-embedded' }));
          await storage.put(`${base}.json`, metadata);
        },
        updateTargetDesign: async (row, design) => (await prisma.$executeRawUnsafe(
          `UPDATE ${TARGET_TABLE} SET "design"=$1::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "updatedAt"=$3`,
          JSON.stringify(design), row.id, row.updatedAt,
        )) === 1,
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Document Designer asset conversion failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { conversionPlan, convertAssets, decodeEmbeddedAsset, deterministicAssetId };
