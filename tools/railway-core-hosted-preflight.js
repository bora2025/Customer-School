'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TRUST_ANCHORS = ['MARKETPLACE_URL', 'UPDATE_REPOSITORY_KEY_ID', 'UPDATE_REPOSITORY_PUBLIC_KEY', 'UPDATE_REPOSITORY_PUBLIC_KEYS_JSON', 'ENTITLEMENT_KEY_ID', 'ENTITLEMENT_PUBLIC_KEY', 'ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON', 'PLUGIN_REVOKED_PUBLISHER_KEYS_JSON'];
const REQUIRED_CONNECTED_TRUST_ANCHORS = new Set(['MARKETPLACE_URL', 'UPDATE_REPOSITORY_KEY_ID', 'UPDATE_REPOSITORY_PUBLIC_KEY', 'ENTITLEMENT_KEY_ID', 'ENTITLEMENT_PUBLIC_KEY']);
const REQUIRED_RUNTIME_CONTROLS = [
  'PLUGIN_SQL_STATEMENT_TIMEOUT_MS', 'PLUGIN_SQL_LOCK_TIMEOUT_MS',
  'PLUGIN_MIGRATION_STATEMENT_TIMEOUT_MS', 'PLUGIN_MIGRATION_LOCK_TIMEOUT_MS',
  'PLUGIN_REQUEST_QUOTA_PER_MINUTE', 'PLUGIN_SQL_QUOTA_PER_MINUTE',
  'PLUGIN_REALTIME_QUOTA_PER_MINUTE', 'PLUGIN_JOB_QUOTA_PER_PLUGIN',
  'PLUGIN_NOTIFICATION_DAILY_LIMIT', 'PLUGIN_EVENT_MAX_BYTES',
  'PLUGIN_READ_MODEL_MAX_BYTES', 'PLUGIN_REVOKED_PUBLISHER_KEYS_JSON',
];

function railwayBinary(platform = process.platform) { return platform === 'win32' ? 'railway.cmd' : 'railway'; }
function host(value) { try { return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).host; } catch { return null; } }
function option(argv, name) { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; }
function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  return value;
}
function canonicalTrustValue(name, value) {
  if (!value) return null;
  const text = String(value).trim().replace(/^\uFEFF/, '');
  if (name.endsWith('_PUBLIC_KEY')) return text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if (name.endsWith('_JSON')) {
    try {
      const parsed = JSON.parse(text);
      for (const [key, item] of Object.entries(parsed)) if (typeof item === 'string') parsed[key] = item.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
      return JSON.stringify(stableJson(parsed));
    } catch { return text; }
  }
  return text;
}
function fingerprint(name, value) { const canonical = canonicalTrustValue(name, value); return canonical ? crypto.createHash('sha256').update(canonical).digest('hex') : null; }

function certificationTarget(argv = process.argv.slice(2)) {
  const environment = option(argv, 'environment');
  if (!environment) throw new Error('--environment is required');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(environment)) throw new Error('--environment must be lowercase kebab-case');
  if (environment === 'production') {
    if (option(argv, 'confirm-production') !== environment) throw new Error('--confirm-production must exactly match production');
  } else if (option(argv, 'confirm-isolated') !== environment) throw new Error('--confirm-isolated must exactly match --environment');
  return { environment };
}
function deploymentSummary(deployment) { return { id: deployment?.id || null, status: deployment?.status || null, imageDigest: deployment?.meta?.imageDigest || null, createdAt: deployment?.createdAt || null }; }

function trustAnchorParity(api, worker, required) {
  const anchors = {};
  const failures = [];
  for (const name of TRUST_ANCHORS) {
    const apiHash = fingerprint(name, api[name]);
    const workerHash = fingerprint(name, worker[name]);
    anchors[name] = { configured: Boolean(apiHash), workerConfigured: Boolean(workerHash), matches: Boolean(apiHash && workerHash && apiHash === workerHash), fingerprint: apiHash };
    if (required && REQUIRED_CONNECTED_TRUST_ANCHORS.has(name) && (!apiHash || !workerHash)) failures.push(`${name} must be configured on both API and worker`);
    if ((apiHash || workerHash) && apiHash !== workerHash) failures.push(`${name} differs between API and worker`);
  }
  return { anchors, failures };
}

function runtimeControlReadiness(api, worker) {
  const failures = [];
  const configured = {};
  for (const name of REQUIRED_RUNTIME_CONTROLS) {
    const apiConfigured = api[name] !== undefined && String(api[name]).trim() !== '';
    const workerConfigured = worker[name] !== undefined && String(worker[name]).trim() !== '';
    configured[name] = { api: apiConfigured, worker: workerConfigured };
    if (!apiConfigured || !workerConfigured) failures.push(`${name} must be explicitly configured on both API and worker`);
    else if (name === 'PLUGIN_REVOKED_PUBLISHER_KEYS_JSON' && fingerprint(name, api[name]) !== fingerprint(name, worker[name])) failures.push(`${name} differs between API and worker`);
  }
  const apiDatabase = fingerprint('DATABASE_URL', api.DATABASE_URL);
  const workerDatabase = fingerprint('DATABASE_URL', worker.DATABASE_URL);
  const migrationDatabase = fingerprint('MIGRATION_DATABASE_URL', api.MIGRATION_DATABASE_URL);
  if (!apiDatabase || !workerDatabase) failures.push('API and worker DATABASE_URL must be configured');
  else if (apiDatabase === workerDatabase) failures.push('API and worker DATABASE_URL must use distinct least-privilege identities');
  if (!migrationDatabase) failures.push('API MIGRATION_DATABASE_URL must be configured');
  if (worker.MIGRATION_DATABASE_URL) failures.push('worker must not receive MIGRATION_DATABASE_URL');
  if (migrationDatabase && (migrationDatabase === apiDatabase || migrationDatabase === workerDatabase)) failures.push('MIGRATION_DATABASE_URL must use a separate migration identity');
  return {
    configured,
    database: {
      apiConfigured: Boolean(apiDatabase), workerConfigured: Boolean(workerDatabase), migrationConfigured: Boolean(migrationDatabase),
      runtimeIdentitiesDistinct: Boolean(apiDatabase && workerDatabase && apiDatabase !== workerDatabase),
      migrationIdentityDistinct: Boolean(migrationDatabase && migrationDatabase !== apiDatabase && migrationDatabase !== workerDatabase),
      workerHasMigrationIdentity: Boolean(worker.MIGRATION_DATABASE_URL),
    },
    failures,
  };
}

function evaluate({ variables, workerVariables = {}, deployment, workerDeployment, health, installation, requireMarketplace = false, environment = null }) {
  const distribution = String(variables.WATTANAM_DISTRIBUTION || '').trim();
  const publicHost = host(variables.PUBLIC_APP_URL || '');
  const marketplaceHost = host(variables.MARKETPLACE_URL || '');
  const apiDigest = deployment?.meta?.imageDigest || null;
  const workerDigest = workerDeployment?.meta?.imageDigest || null;
  const trust = trustAnchorParity(variables, workerVariables, requireMarketplace);
  const controls = runtimeControlReadiness(variables, workerVariables);
  const failures = [...trust.failures, ...controls.failures];
  if (distribution !== 'core') failures.push(`WATTANAM_DISTRIBUTION must be core, received ${distribution || '<unset>'}`);
  if (String(workerVariables.WATTANAM_DISTRIBUTION || '').trim() !== 'core') failures.push('worker WATTANAM_DISTRIBUTION must be core');
  if (variables.PROCESS_ROLE !== 'api') failures.push('API PROCESS_ROLE must be api');
  if (workerVariables.PROCESS_ROLE !== 'worker') failures.push('worker PROCESS_ROLE must be worker');
  if (variables.PLUGIN_REQUIRED_RUNTIME_ROLES !== 'api,worker' || workerVariables.PLUGIN_REQUIRED_RUNTIME_ROLES !== 'api,worker') failures.push('API and worker must require api,worker rollout roles');
  if (deployment?.status !== 'SUCCESS') failures.push('latest API deployment is not successful');
  if (workerDeployment?.status !== 'SUCCESS') failures.push('latest worker deployment is not successful');
  if (!apiDigest || !workerDigest) failures.push('API and worker deployment image digests are required');
  else if (apiDigest !== workerDigest) failures.push('API and worker deployment image digests do not match');
  if (health?.status !== 200 || health.body?.status !== 'ok') failures.push('gateway API health check failed');
  if (installation?.status !== 200 || installation.body?.state !== 'installed') failures.push('school installation is not complete');
  if (!publicHost) failures.push('PUBLIC_APP_URL is missing or invalid');
  if (requireMarketplace && !marketplaceHost) failures.push('MARKETPLACE_URL is missing or invalid');
  return {
    format: 'wattanam-railway-core-hosted-preflight-v4', passed: failures.length === 0, checkedAt: new Date().toISOString(), environment,
    distribution, appVersion: variables.APP_VERSION || null, publicHost,
    marketplace: { required: requireMarketplace, configured: Boolean(marketplaceHost), host: marketplaceHost, trustAnchors: trust.anchors },
    controls: { configured: controls.configured, database: controls.database },
    runtime: { requiredRoles: ['api', 'worker'], sameImageDigest: Boolean(apiDigest && apiDigest === workerDigest), api: deploymentSummary(deployment), worker: deploymentSummary(workerDeployment) },
    health: { status: health?.status || null, service: health?.body?.service || null },
    installation: { status: installation?.status || null, state: installation?.body?.state || null, schoolSlug: installation?.body?.installation?.schoolSlug || null, coreVersion: installation?.body?.installation?.coreVersion || null },
    failures,
  };
}

function command(args) {
  const executable = railwayBinary();
  const output = process.platform === 'win32' ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [executable, ...args].join(' ')], { encoding: 'utf8', windowsHide: true }) : execFileSync(executable, args, { encoding: 'utf8' });
  return JSON.parse(output);
}
async function request(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(20000) }); const text = await response.text(); let body = null; try { body = JSON.parse(text); } catch {} return { status: response.status, body }; }
  catch (error) { return { status: null, body: null, error: error.message }; }
}
async function run({ requireMarketplace = process.argv.includes('--require-marketplace'), environment = certificationTarget().environment } = {}) {
  const variables = command(['variables', '--service', 'api', '--environment', environment, '--json']);
  const workerVariables = command(['variables', '--service', 'worker', '--environment', environment, '--json']);
  const deployments = command(['deployment', 'list', '--service', 'api', '--environment', environment, '--json']);
  const workerDeployments = command(['deployment', 'list', '--service', 'worker', '--environment', environment, '--json']);
  const publicHost = host(variables.PUBLIC_APP_URL || ''); const base = publicHost ? `https://${publicHost}` : '';
  const [health, installation] = await Promise.all([request(`${base}/api/health`), request(`${base}/api/installation/status`)]);
  return evaluate({ variables, workerVariables, deployment: deployments[0], workerDeployment: workerDeployments[0], health, installation, requireMarketplace, environment });
}
async function main() {
  const result = await run(); const index = process.argv.indexOf('--out');
  if (index >= 0) { const output = process.argv[index + 1]; if (!output) throw new Error('--out requires a report path'); const target = path.resolve(output); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }); }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (!result.passed) process.exitCode = 2;
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Railway core hosted preflight failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { certificationTarget, evaluate, fingerprint, host, railwayBinary, run, runtimeControlReadiness, trustAnchorParity };
