'use strict';

const fs = require('node:fs');
const path = require('node:path');

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function digestImage(env, name) {
  const value = required(env, name);
  if (!/^ghcr\.io\/.+@sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a digest-pinned GHCR image`);
  return value;
}
function generate(env = process.env) {
  const backend = digestImage(env, 'BACKEND_IMAGE');
  return {
    schemaVersion: 1,
    invariants: { tenancy: 'one-school-per-project', backendImageParity: true },
    release: {
      version: required(env, 'RELEASE_VERSION'),
      commit: required(env, 'GITHUB_SHA'),
      repository: required(env, 'GITHUB_REPOSITORY'),
      workflowRef: `${required(env, 'GITHUB_REPOSITORY')}/.github/workflows/core-release.yml@refs/heads/main`,
    },
    services: {
      api: { image: backend, variables: { WATTANAM_DISTRIBUTION: 'core', PROCESS_ROLE: 'api', PLUGIN_REQUIRED_RUNTIME_ROLES: 'api,worker' } },
      worker: { image: backend, variables: { WATTANAM_DISTRIBUTION: 'core', PROCESS_ROLE: 'worker', PLUGIN_REQUIRED_RUNTIME_ROLES: 'api,worker' } },
      web: { image: digestImage(env, 'WEB_IMAGE'), variables: { WATTANAM_DISTRIBUTION: 'core' } },
      gateway: { image: digestImage(env, 'GATEWAY_IMAGE') },
      postgres: { image: required(env, 'POSTGRES_IMAGE') },
    },
  };
}
function main() {
  const output = path.resolve(process.argv[2] || 'core-release-blueprint.json');
  const blueprint = generate();
  if (blueprint.services.api.image !== blueprint.services.worker.image) throw new Error('API and worker must use the exact same backend digest');
  fs.writeFileSync(output, `${JSON.stringify(blueprint, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${output}\n`);
}
if (require.main === module) main();
module.exports = { generate };
