'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const blueprintPath = arg('blueprint');
const slug = arg('school-slug');
const schoolName = arg('school-name');
const workspace = arg('workspace');
// Every newly provisioned school starts as a lean core. Existing schools that still need the
// compatibility bundle must opt in explicitly with --distribution legacy-full while they migrate.
const distribution = arg('distribution') || 'core';
const legacyApproval = {
  reason: arg('legacy-approval-reason')?.trim(),
  approvedUntil: arg('legacy-approved-until')?.trim(),
};
const execute = process.argv.includes('--execute');
const sharedStorage = {
  bucket: process.env.WATTANAM_PROVISION_S3_BUCKET?.trim(),
  region: process.env.WATTANAM_PROVISION_S3_REGION?.trim(),
  endpoint: process.env.WATTANAM_PROVISION_S3_ENDPOINT?.trim(),
  accessKeyId: process.env.WATTANAM_PROVISION_S3_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.WATTANAM_PROVISION_S3_SECRET_ACCESS_KEY?.trim(),
  prefix: process.env.WATTANAM_PROVISION_S3_PREFIX?.trim() || `schools/${slug || 'unknown'}`,
};
const marketplaceTrust = {
  MARKETPLACE_URL: process.env.WATTANAM_PROVISION_MARKETPLACE_URL?.trim(),
  UPDATE_REPOSITORY_KEY_ID: process.env.WATTANAM_PROVISION_UPDATE_REPOSITORY_KEY_ID?.trim(),
  UPDATE_REPOSITORY_PUBLIC_KEY: process.env.WATTANAM_PROVISION_UPDATE_REPOSITORY_PUBLIC_KEY?.trim(),
  UPDATE_REPOSITORY_PUBLIC_KEYS_JSON: process.env.WATTANAM_PROVISION_UPDATE_REPOSITORY_PUBLIC_KEYS_JSON?.trim(),
  ENTITLEMENT_KEY_ID: process.env.WATTANAM_PROVISION_ENTITLEMENT_KEY_ID?.trim(),
  ENTITLEMENT_PUBLIC_KEY: process.env.WATTANAM_PROVISION_ENTITLEMENT_PUBLIC_KEY?.trim(),
  ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON: process.env.WATTANAM_PROVISION_ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON?.trim(),
};
const requiredMarketplaceTrust = ['MARKETPLACE_URL', 'UPDATE_REPOSITORY_KEY_ID', 'UPDATE_REPOSITORY_PUBLIC_KEY', 'ENTITLEMENT_KEY_ID', 'ENTITLEMENT_PUBLIC_KEY'];
const marketplaceConfigured = Object.values(marketplaceTrust).some(Boolean);
if (!blueprintPath || !slug || !schoolName) throw new Error('--blueprint, --school-slug, and --school-name are required');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('school slug must be lowercase kebab-case');
if (!['core', 'legacy-full'].includes(distribution)) throw new Error('--distribution must be core or legacy-full');
if (distribution === 'legacy-full') {
  if (!legacyApproval.reason || legacyApproval.reason.length < 8) throw new Error('--legacy-approval-reason is required for legacy-full');
  if (!legacyApproval.approvedUntil || !/^\d{4}-\d{2}-\d{2}$/.test(legacyApproval.approvedUntil)) throw new Error('--legacy-approved-until must be a YYYY-MM-DD date for legacy-full');
  const expiry = Date.parse(`${legacyApproval.approvedUntil}T23:59:59.999Z`);
  if (!Number.isFinite(expiry) || expiry < Date.now()) throw new Error('--legacy-approved-until must be in the future');
}
if (execute && arg('confirm-slug') !== slug) throw new Error('--confirm-slug must exactly match --school-slug for execution');
if (execute && (!sharedStorage.bucket || !sharedStorage.region)) throw new Error('WATTANAM_PROVISION_S3_BUCKET and WATTANAM_PROVISION_S3_REGION are required for split runtime execution');
if (execute && Boolean(sharedStorage.accessKeyId) !== Boolean(sharedStorage.secretAccessKey)) throw new Error('WATTANAM_PROVISION_S3_ACCESS_KEY_ID and WATTANAM_PROVISION_S3_SECRET_ACCESS_KEY must be configured together');
if (marketplaceConfigured) {
  const missing = requiredMarketplaceTrust.filter((name) => !marketplaceTrust[name]);
  if (missing.length) throw new Error(`Marketplace trust configuration is incomplete: ${missing.join(', ')}`);
}

const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
if (blueprint.invariants?.tenancy !== 'one-school-per-project') throw new Error('Blueprint does not enforce one-school-per-project');
for (const name of ['api', 'worker', 'web', 'gateway']) {
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(blueprint.services?.[name]?.image || '')) throw new Error(`${name} image is not digest-pinned`);
}
for (const name of ['api', 'worker', 'web']) {
  const declared = blueprint.services?.[name]?.variables?.WATTANAM_DISTRIBUTION;
  if (declared && declared !== distribution) throw new Error(`${name} blueprint distribution ${declared} does not match requested ${distribution}`);
}
if (execute) {
  const verification = spawnSync(process.execPath, [path.join(__dirname, 'verify-core-image-signatures.js'), '--blueprint', path.resolve(blueprintPath)], { encoding: 'utf8' });
  if (verification.status !== 0) throw new Error(`Core image signature verification failed: ${(verification.stderr || verification.stdout).trim()}`);
}

const projectName = `Wattanam - ${schoolName} - Production`;
const plan = [
  ['init', '--name', projectName, ...(workspace ? ['--workspace', workspace] : []), '--json'],
  ['add', '--database', 'postgres', '--json'],
  ['add', '--image', blueprint.services.api.image, '--service', 'api', '--json'],
  ['add', '--image', blueprint.services.worker.image, '--service', 'worker', '--json'],
  ['add', '--image', blueprint.services.web.image, '--service', 'web', '--json'],
  ['add', '--image', blueprint.services.gateway.image, '--service', 'gateway', '--json'],
  ['volume', 'add', '--service', 'api', '--mount-path', '/data', '--json'],
  ['volume', 'add', '--service', 'worker', '--mount-path', '/data', '--json'],
  ['domain', '--service', 'gateway', '--port', '8080', '--json'],
];

if (!execute) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', projectName, slug, distribution, ...(distribution === 'legacy-full' ? { legacyApproval } : {}), release: blueprint.release, runtimeRoles: ['api', 'worker'], requiredExecutionEnvironment: ['WATTANAM_PROVISION_S3_BUCKET', 'WATTANAM_PROVISION_S3_REGION'], optionalExecutionEnvironment: ['WATTANAM_PROVISION_S3_ENDPOINT', 'WATTANAM_PROVISION_S3_ACCESS_KEY_ID', 'WATTANAM_PROVISION_S3_SECRET_ACCESS_KEY', 'WATTANAM_PROVISION_S3_PREFIX', ...Object.keys(marketplaceTrust).map((name) => `WATTANAM_PROVISION_${name}`)], marketplaceTrustAtomic: true, commands: plan.map((parts) => ['railway', ...parts]) }, null, 2)}\n`);
  process.exit(0);
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `wattanam-${slug}-`));
const journal = { schemaVersion: 1, slug, projectName, distribution, release: blueprint.release, startedAt: new Date().toISOString(), steps: [] };
function railway(args, input) {
  const result = spawnSync(process.platform === 'win32' ? 'railway.cmd' : 'railway', args, { cwd: workdir, input, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`Railway command failed (${args[0]}): ${(result.stderr || result.stdout).trim()}`);
  journal.steps.push({ command: args[0], completedAt: new Date().toISOString() });
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
function setSecret(service, key, value) {
  railway(['variable', 'set', key, '--stdin', '--service', service, '--skip-deploys', '--json'], `${value}\n`);
}
function setVariables(service, values) {
  const pairs = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  railway(['variable', 'set', ...pairs, '--service', service, '--skip-deploys', '--json']);
}

try {
  const project = railway(plan[0]);
  journal.projectId = project.id || project.projectId;
  railway(plan[1]); railway(plan[2]); railway(plan[3]); railway(plan[4]); railway(plan[5]); railway(plan[6]); railway(plan[7]);
  const domainResult = railway(plan[8]);
  const domain = domainResult.domain || domainResult.serviceDomain || domainResult.url;
  if (!domain) throw new Error('Railway did not return the generated gateway domain');
  const jwtSecret = crypto.randomBytes(48).toString('base64url');
  setSecret('api', 'JWT_SECRET', jwtSecret);
  setSecret('worker', 'JWT_SECRET', jwtSecret);
  if (sharedStorage.accessKeyId) {
    setSecret('api', 'PLUGIN_STORAGE_S3_ACCESS_KEY_ID', sharedStorage.accessKeyId);
    setSecret('worker', 'PLUGIN_STORAGE_S3_ACCESS_KEY_ID', sharedStorage.accessKeyId);
    setSecret('api', 'PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY', sharedStorage.secretAccessKey);
    setSecret('worker', 'PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY', sharedStorage.secretAccessKey);
  }
  if (marketplaceConfigured) {
    // Apply one validated trust bundle to both runtime roles without exposing key material in argv.
    for (const service of ['api', 'worker']) {
      for (const [name, value] of Object.entries(marketplaceTrust)) {
        if (value) setSecret(service, name, value);
      }
    }
  }
  const storageVariables = {
    PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_BUCKET: sharedStorage.bucket,
    PLUGIN_STORAGE_S3_REGION: sharedStorage.region, PLUGIN_STORAGE_S3_PREFIX: sharedStorage.prefix,
    ...(sharedStorage.endpoint ? { PLUGIN_STORAGE_S3_ENDPOINT: sharedStorage.endpoint, PLUGIN_STORAGE_S3_FORCE_PATH_STYLE: 'true' } : {}),
  };
  const pluginRuntimeControls = {
    PLUGIN_SQL_STATEMENT_TIMEOUT_MS: '5000', PLUGIN_SQL_LOCK_TIMEOUT_MS: '1000',
    PLUGIN_MIGRATION_STATEMENT_TIMEOUT_MS: '30000', PLUGIN_MIGRATION_LOCK_TIMEOUT_MS: '5000',
    PLUGIN_REQUEST_QUOTA_PER_MINUTE: '600', PLUGIN_SQL_QUOTA_PER_MINUTE: '300',
    PLUGIN_REALTIME_QUOTA_PER_MINUTE: '600', PLUGIN_JOB_QUOTA_PER_PLUGIN: '2',
    PLUGIN_JOB_DRAIN_TIMEOUT_MS: '30000', PLUGIN_NOTIFICATION_DAILY_LIMIT: '200',
    PLUGIN_EVENT_MAX_BYTES: '65536', PLUGIN_READ_MODEL_MAX_BYTES: '262144',
    PLUGIN_STORAGE_MAX_FILE_BYTES: '1048576', PLUGIN_STORAGE_MAX_TOTAL_BYTES: '104857600',
    PLUGIN_REVOKED_PUBLISHER_KEYS_JSON: '[]',
  };
  const legacyApprovalVariables = distribution === 'legacy-full' ? {
    LEGACY_FULL_APPROVAL_REASON: legacyApproval.reason,
    LEGACY_FULL_APPROVED_UNTIL: legacyApproval.approvedUntil,
  } : {};
  setVariables('api', {
    NODE_ENV: 'production', PORT: '3001', APP_VERSION: blueprint.release.version, GIT_COMMIT: blueprint.release.commit,
    // New schools are core-first. legacy-full is an explicit migration/rollback compatibility mode.
    WATTANAM_DISTRIBUTION: distribution, ...legacyApprovalVariables, PROCESS_ROLE: 'api', PLUGIN_REQUIRED_RUNTIME_ROLES: 'api,worker',
    DATABASE_URL: '${{Postgres.DATABASE_URL}}', CORS_ORIGINS: `https://${domain}`, PUBLIC_APP_URL: `https://${domain}`, COOKIE_SECURE: 'true',
    BACKUP_DIR: '/data/backups', PLUGIN_DIR: '/data/plugins', PLUGIN_DATA_DIR: '/data/plugin-data', ...storageVariables, ...pluginRuntimeControls,
  });
  setVariables('worker', {
    NODE_ENV: 'production', WORKER_PORT: '3002', APP_VERSION: blueprint.release.version, GIT_COMMIT: blueprint.release.commit,
    WATTANAM_DISTRIBUTION: distribution, ...legacyApprovalVariables, PROCESS_ROLE: 'worker', PLUGIN_REQUIRED_RUNTIME_ROLES: 'api,worker',
    DATABASE_URL: '${{Postgres.DATABASE_URL}}', CORS_ORIGINS: `https://${domain}`, COOKIE_SECURE: 'true',
    BACKUP_DIR: '/data/backups', PLUGIN_DIR: '/data/plugins',
    PLUGIN_DATA_DIR: '/data/plugin-data', ...storageVariables, ...pluginRuntimeControls,
  });
  setVariables('web', { NODE_ENV: 'production', WATTANAM_DISTRIBUTION: distribution, NEXT_PUBLIC_WATTANAM_DISTRIBUTION: distribution, ...legacyApprovalVariables, PORT: '3000', API_URL: 'http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3001', NEXT_PUBLIC_API_URL: '' });
  setVariables('gateway', { API_UPSTREAM: '${{api.RAILWAY_PRIVATE_DOMAIN}}:3001', WEB_UPSTREAM: '${{web.RAILWAY_PRIVATE_DOMAIN}}:3000' });
  journal.gatewayOrigin = `https://${domain}`;
  journal.completedAt = new Date().toISOString();
  fs.writeFileSync(path.resolve(`railway-school-${slug}.journal.json`), `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ projectId: journal.projectId, gatewayOrigin: journal.gatewayOrigin, journal: `railway-school-${slug}.journal.json` })}\n`);
} catch (error) {
  journal.failedAt = new Date().toISOString();
  journal.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(path.resolve(`railway-school-${slug}.failed.json`), `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  throw error;
}
