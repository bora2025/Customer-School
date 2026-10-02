import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createPluginStorageProvider } from './storage-config';
import { copyAndVerifyStorage } from './storage-migration';

function argument(name: string) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; }

export async function runStorageMigrationCli() {
  const direction = argument('direction');
  const installation = argument('installation');
  const execute = process.argv.includes('--execute');
  if (!['local-to-s3', 's3-to-local'].includes(direction || '')) throw new Error('--direction must be local-to-s3 or s3-to-local');
  if (!installation || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(installation)) throw new Error('--installation must be a lowercase kebab-case installation slug');
  if (execute && argument('confirm-installation') !== installation) throw new Error('--confirm-installation must exactly match --installation');
  const sourceMode = direction === 'local-to-s3' ? 'local' : 's3';
  const targetMode = direction === 'local-to-s3' ? 's3' : 'local';
  const source = createPluginStorageProvider({ ...process.env, PLUGIN_STORAGE_PROVIDER: sourceMode });
  const target = createPluginStorageProvider({ ...process.env, PLUGIN_STORAGE_PROVIDER: targetMode });
  if (!execute) {
    const objects = await source.list();
    return { mode: 'dry-run', direction, installation, objects: objects.length, bytes: objects.reduce((total, item) => total + item.size, 0), writes: 0 };
  }
  const startedAt = new Date().toISOString();
  const result = await copyAndVerifyStorage(source, target);
  const journal = { schemaVersion: 1, installation, direction, startedAt, completedAt: new Date().toISOString(), sourceRetained: true, cutoverRequired: true, result };
  const journalDirectory = path.resolve(process.env.STORAGE_MIGRATION_JOURNAL_DIR || process.env.BACKUP_DIR || './backups');
  await fs.mkdir(journalDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(journalDirectory, `storage-migration-${installation}-${Date.now()}.json`);
  await fs.writeFile(file, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { mode: 'executed', journal: file, ...result };
}

if (require.main === module) runStorageMigrationCli().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
