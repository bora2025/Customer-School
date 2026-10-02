'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const blueprintPath = arg('blueprint');
if (!blueprintPath) throw new Error('--blueprint is required');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
const repository = blueprint.release?.repository;
const workflowRef = blueprint.release?.workflowRef;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Release repository identity is missing');
const expectedWorkflowRef = `${repository}/.github/workflows/core-release.yml@refs/heads/main`;
if (workflowRef !== expectedWorkflowRef) throw new Error('Release workflow identity is invalid');

const identity = `https://github.com/${workflowRef}`;
const issuer = 'https://token.actions.githubusercontent.com';
const environmentPath = arg('env-file');
if (environmentPath) {
  const environment = {};
  for (const rawLine of fs.readFileSync(environmentPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Environment file contains a malformed line');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    environment[key] = value;
  }
  const bindings = { API_IMAGE: 'api', WEB_IMAGE: 'web', GATEWAY_IMAGE: 'gateway' };
  for (const [variable, service] of Object.entries(bindings)) {
    if (environment[variable] !== blueprint.services?.[service]?.image) throw new Error(`${variable} does not match the signed release blueprint`);
  }
  if (environment.APP_VERSION !== blueprint.release?.version) throw new Error('APP_VERSION does not match the signed release blueprint');
  if (environment.POSTGRES_IMAGE !== blueprint.services?.postgres?.image) throw new Error('POSTGRES_IMAGE does not match the signed release blueprint');
}
const commands = [];
for (const name of ['api', 'web', 'gateway']) {
  const image = blueprint.services?.[name]?.image || '';
  if (!/^ghcr\.io\/.+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error(`${name} image must be a digest-pinned GHCR reference`);
  commands.push(['cosign', 'verify', '--certificate-identity', identity, '--certificate-oidc-issuer', issuer, image]);
}

if (process.argv.includes('--plan')) {
  process.stdout.write(`${JSON.stringify({ valid: true, repository, workflowRef, environmentBound: Boolean(environmentPath), commands }, null, 2)}\n`);
  process.exit(0);
}

for (const command of commands) {
  const executable = process.platform === 'win32' ? 'cosign.exe' : 'cosign';
  const result = spawnSync(executable, command.slice(1), { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error('cosign is required to verify release image signatures');
  if (result.status !== 0) throw new Error(`Signature verification failed for ${command.at(-1)}: ${(result.stderr || result.stdout).trim()}`);
}
process.stdout.write(`${JSON.stringify({ valid: true, repository, workflowRef, images: commands.map((command) => command.at(-1)) })}\n`);
