'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function configuration(env = process.env) {
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  if (!env.RECOVERY_DRILL_DATABASE_URL) throw new Error('RECOVERY_DRILL_DATABASE_URL is required');
  const source = new URL(env.DATABASE_URL || '');
  const target = new URL(env.RECOVERY_DRILL_DATABASE_URL);
  const targetDatabase = decodeURIComponent(target.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !targetDatabase) throw new Error('RECOVERY_DRILL_DATABASE_URL must name a PostgreSQL database');
  if (source.toString() === target.toString()) throw new Error('recovery drill target must differ from the live database');
  if (!/(?:recovery[-_]?drill|restore[-_]?test|rehearsal)/i.test(targetDatabase)) throw new Error('recovery drill database name must identify itself as recovery-drill, restore-test, or rehearsal');
  const confirmation = env.RECOVERY_DRILL_CONFIRM_TARGET?.trim();
  if (!confirmation) throw new Error('RECOVERY_DRILL_CONFIRM_TARGET is required (EMPTY for the first drill, then the restored school slug)');
  return { backupDir, targetUrl: target.toString(), targetDatabase, confirmation };
}
function latestRecoverySet(directory) {
  const candidates = fs.readdirSync(directory).filter((name) => /^wattanam-recovery-.*\.recovery-set\.json$/.test(name));
  const journals = candidates.map((name) => {
    const file = path.join(directory, name); const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, value };
  }).filter(({ value }) => value.format === 'wattanam-recovery-set-v2' && value.contractVerification?.verified === true && value.contractVerification?.legacyExceptionCount === 0);
  journals.sort((a, b) => String(b.value.createdAt).localeCompare(String(a.value.createdAt)));
  if (!journals[0]) throw new Error('no strict recovery-set v2 journal is available for rehearsal');
  return journals[0];
}
/** Hosted Postgres services start with only their default database, so the first drill creates the
 * recovery-named target database on the rehearsal server. It connects to the server's `postgres`
 * maintenance database, never the target, and only creates (never drops). */
function ensureTargetDatabase(targetUrl, targetDatabase, spawn = spawnSync) {
  if (!/^[A-Za-z0-9_]+$/.test(targetDatabase)) throw new Error('recovery drill database name may contain only letters, digits and underscores');
  const url = new URL(targetUrl);
  const environment = {
    ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: 'postgres',
    ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
  };
  const psql = (sql) => {
    const result = spawn('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], { env: environment, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`could not prepare recovery drill database: ${(result.stderr || '').trim()}`);
    return (result.stdout || '').trim();
  };
  if (psql(`SELECT 1 FROM pg_database WHERE datname = '${targetDatabase}'`) === '1') return false;
  psql(`CREATE DATABASE "${targetDatabase}"`);
  return true;
}

function run(env = process.env) {
  const config = configuration(env);
  const selected = latestRecoverySet(config.backupDir);
  // A database created just now is guaranteed empty; otherwise the operator-configured school slug
  // must match what the previous drill restored there.
  const confirmation = ensureTargetDatabase(config.targetUrl, config.targetDatabase) ? 'EMPTY' : config.confirmation;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-recovery-drill-'));
  const startedAt = new Date().toISOString();
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'restore-recovery-set.js'), '--from', selected.file, '--confirm-target', confirmation, '--yes-replace', '--use-restore-database-url', '--plugin-dir', path.join(stage, 'plugins'), '--plugin-data-dir', path.join(stage, 'plugin-data')], {
      env: { ...env, RESTORE_DATABASE_URL: config.targetUrl, PLUGIN_STORAGE_PROVIDER: 'local' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || `restore exited ${result.status}`).trim());
    const evidence = {
      format: 'wattanam-scheduled-recovery-drill-v1', passed: true, startedAt, completedAt: new Date().toISOString(),
      targetDatabase: config.targetDatabase, journalFile: path.basename(selected.file), journalCreatedAt: selected.value.createdAt,
      pluginContractCount: selected.value.pluginContracts?.length || 0,
    };
    const evidenceFile = path.join(config.backupDir, `recovery-drill-${Date.now()}.json`);
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { ...evidence, evidenceFile: path.basename(evidenceFile) };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) { try { if (process.argv.includes('--help')) process.stdout.write('Usage: npm run recovery-set:drill\nRequires BACKUP_DIR, DATABASE_URL, RECOVERY_DRILL_DATABASE_URL, and RECOVERY_DRILL_CONFIRM_TARGET.\n'); else process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`); } catch (error) { process.stderr.write(`Scheduled recovery drill failed: ${error.message}\n`); process.exitCode = 1; } }
module.exports = { configuration, ensureTargetDatabase, latestRecoverySet, run };
