'use strict';

const fs = require('fs');
const path = require('path');
const { fail, flagValue } = require('../util');

/**
 * Calls the real, existing official-repository admin endpoint
 * (POST /admin/v1/plugin-releases). This is the "submitted using public
 * tooling" step of C-008 -- it does NOT open third-party self-service
 * submission (that's F-003, deliberately gated behind Gate F0 per DEC-007).
 * The admin token is an operator credential; a real deployment keeps it
 * secret the same way MARKETPLACE_ADMIN_TOKEN already is.
 */
async function publish({ packageFile, repositoryUrl, adminToken, channel, changelog, paid }) {
  const buffer = fs.readFileSync(path.resolve(packageFile));
  const form = new FormData();
  form.set('channel', channel || 'STABLE');
  form.set('paid', paid ? 'true' : 'false');
  if (changelog) form.set('changelog', changelog);
  form.set('package', new Blob([buffer]), path.basename(packageFile));

  const response = await fetch(new URL('/admin/v1/plugin-releases', repositoryUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Publish failed (${response.status}): ${body.message || JSON.stringify(body)}`);
  return body;
}

async function run(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin publish --package <file.wtp> --repository-url <url> --admin-token <token> [--channel stable|beta] [--changelog <text>]\n');
    return;
  }
  const packageFile = flagValue(argv, '--package');
  const repositoryUrl = flagValue(argv, '--repository-url');
  const adminToken = flagValue(argv, '--admin-token');
  const channel = flagValue(argv, '--channel') || 'stable';
  const changelog = flagValue(argv, '--changelog');
  if (!packageFile || !repositoryUrl || !adminToken) fail('Missing required argument; use --help');
  const result = await publish({ packageFile, repositoryUrl, adminToken, channel: channel.toUpperCase(), changelog, paid: false });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { run, publish };
