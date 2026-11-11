#!/usr/bin/env node
'use strict';

// End-to-end plugin lifecycle across a REAL school stack and a REAL marketplace, over HTTP only,
// the same calls the school's admin UI and the marketplace's approval page make:
//
//   install school -> owner login -> MFA on -> register installation with marketplace account
//   -> link (start / owner approves on marketplace / exchange) -> catalog -> consented install of
//   the PREVIOUS Academic Management release -> write data -> dependent install (Attendance
//   Manager) -> dependency protection -> in-place upgrade to the latest release while active
//   (new migration applied, data kept, dependent stays active, downgrade refused) -> deactivate /
//   reactivate -> uninstall keeps data -> reinstall sees the same data
//
// The marketplace catalog must offer at least two STABLE Academic Management releases; the newer
// one should add a migration (0.3.3 -> 0.3.4+ adds 062, which seeds default attendance sessions).
//
// Env: SCHOOL_URL (gateway origin), MARKETPLACE_URL, MP_EMAIL, MP_PASSWORD, MP_TOTP_SECRET,
//      MP_ACCOUNT_ID (from apps/marketplace-api/scripts/create-marketplace-account.js).
// Exits non-zero on the first failed check. Prints one line per check.

const crypto = require('node:crypto');

const SCHOOL = (process.env.SCHOOL_URL || 'http://localhost:3000').replace(/\/$/, '');
const MARKET = (process.env.MARKETPLACE_URL || 'http://localhost:3010').replace(/\/$/, '');
const OWNER = { email: 'owner@lifecycle.example', password: 'Lifecycle-pass-2026!' };
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
  if (!condition) { summary(); process.exit(1); }
}
function summary() {
  const passed = results.filter((r) => r.ok).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
}

// Minimal cookie jar for the school's httpOnly session cookies.
const jar = new Map();
async function school(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${SCHOOL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    const value = pair.slice(index + 1);
    if (value) jar.set(pair.slice(0, index), value); else jar.delete(pair.slice(0, index));
  }
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json, setCookies };
}
async function market(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${MARKET}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

// RFC 6238 TOTP (SHA-1, 30s, 6 digits) from a base32 secret.
function totp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pluginState = async (id) => ((await school('GET', '/plugins')).body || []).find((plugin) => plugin.id === id) || null;

// Catalog releases newest first (by SemVer, not by the order the marketplace returns them).
async function catalogReleases(pluginId) {
  const catalog = await school('GET', '/admin/marketplace/catalog');
  const product = Array.isArray(catalog.body) ? catalog.body.find((item) => item.id === pluginId) : null;
  const newer = (a, b) => b.version.split(/[.-]/).map(Number).reduce((order, part, index) => order || (part - (Number(a.version.split(/[.-]/)[index]) || 0)), 0);
  return [...(product?.versions || [])].sort(newer);
}

/** which: 'latest' (default) or 'previous' (the release before the newest one). */
async function installFromCatalog(pluginId, which = 'latest') {
  const catalog = await school('GET', '/admin/marketplace/catalog');
  if (!Array.isArray(catalog.body)) return { status: catalog.status, body: `catalog unavailable: ${JSON.stringify(catalog.body).slice(0, 300)}` };
  const release = (await catalogReleases(pluginId))[which === 'previous' ? 1 : 0];
  if (!release) return { status: 404, body: `${pluginId} has no ${which} release in the catalog` };
  return school('POST', `/admin/marketplace/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(release.version)}/install`, { activate: true, consentDigest: release.consentDigest });
}

async function main() {
  // 1. School installation and owner security
  const status = await school('GET', '/installation/status');
  if (status.body?.state !== 'installed') {
    const install = await school('POST', '/installation/install', {
      schoolName: 'Lifecycle School', schoolSlug: 'lifecycle-school', locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'USD',
      ownerName: 'Lifecycle Owner', ownerEmail: OWNER.email, ownerPassword: OWNER.password,
    });
    check('school installs from a clean core', install.status === 201, `HTTP ${install.status}`);
  }
  let login = await school('POST', '/auth/login', OWNER);
  check('owner can sign in', login.status === 201 || login.status === 200, `HTTP ${login.status}`);
  const setup = await school('POST', '/auth/mfa/setup', { currentPassword: OWNER.password });
  check('owner can start MFA enrollment', !!setup.body?.secret, `HTTP ${setup.status}`);
  const enable = await school('POST', '/auth/mfa/enable', { code: totp(setup.body.secret) });
  check('owner enables MFA with an authenticator code', enable.body?.enabled === true, `HTTP ${enable.status}`);
  await school('POST', '/auth/logout');
  jar.clear();
  const noCode = await school('POST', '/auth/login', OWNER);
  check('sign-in without the MFA code is refused', noCode.status >= 400, `HTTP ${noCode.status}`);
  login = await school('POST', '/auth/login', { ...OWNER, mfaCode: totp(setup.body.secret) });
  check('sign-in with the MFA code succeeds', login.status === 201 || login.status === 200, `HTTP ${login.status}`);
  const sessionCookie = login.setCookies.find((line) => line.startsWith('access_token='));
  check('session cookie is HttpOnly and SameSite=Lax (CSRF)', !!sessionCookie && /HttpOnly/i.test(sessionCookie) && /SameSite=Lax/i.test(sessionCookie), sessionCookie ? sessionCookie.replace(/=[^;]+;/, '=<value>;') : 'no cookie');
  const core = await school('GET', '/plugins');
  check('clean core has no business plugins installed', Array.isArray(core.body) && core.body.length === 0, `${(core.body || []).length} installed`);

  // 2. Marketplace connection
  const registration = await school('POST', '/admin/marketplace/installation/register', { accountId: process.env.MP_ACCOUNT_ID, label: 'Lifecycle School' });
  check('school registers its installation key with the marketplace account', registration.status < 300, `HTTP ${registration.status}`);
  const session = await market('POST', '/v1/sessions', { email: process.env.MP_EMAIL, password: process.env.MP_PASSWORD, code: totp(process.env.MP_TOTP_SECRET || '') });
  const token = session.body?.sessionToken;
  check('marketplace account owner signs in on the marketplace with MFA', session.body?.status === 'authenticated' && !!token, `HTTP ${session.status}`);
  const start = await school('POST', '/admin/marketplace/link/start', { label: 'Lifecycle School' });
  check('school starts a marketplace link and receives an approval URL', !!start.body?.requestId && /\/marketplace\/link\//.test(start.body?.approvalUrl || ''), `HTTP ${start.status}`);
  const approve = await market('POST', `/v1/marketplace-links/${start.body.requestId}/approve`, {}, token);
  check('owner approves the link on the marketplace', approve.status < 300, `HTTP ${approve.status}`);
  const poll = await school('POST', '/admin/marketplace/link/poll', {});
  const linkStatus = await school('GET', '/admin/marketplace/link/status');
  check('school exchanges the approval and reports linked', poll.status < 300 && /linked|active|connected/i.test(JSON.stringify(linkStatus.body)), `poll HTTP ${poll.status}`);

  // 3. Catalog and consented install
  const catalog = await school('GET', '/admin/marketplace/catalog');
  const ids = (catalog.body || []).map((item) => item.id);
  check('linked school sees the plugin catalog', ids.includes('wattanam.academic-management') && ids.includes('wattanam.attendance-manager'), `${ids.length} plugins`);
  const badConsent = await school('POST', `/admin/marketplace/plugins/wattanam.academic-management/${catalog.body.find((p) => p.id === 'wattanam.academic-management').versions[0].version}/install`, { activate: true, consentDigest: '0'.repeat(64) });
  check('install with a stale or forged consent digest is refused', badConsent.status === 400, `HTTP ${badConsent.status}`);
  const dependentFirst = await installFromCatalog('wattanam.attendance-manager');
  check('a dependent plugin cannot be installed before its dependency', dependentFirst.status >= 400, `HTTP ${dependentFirst.status}`);
  // Start one release behind so stage 5 can upgrade a plugin that already holds school data.
  const academicReleases = await catalogReleases('wattanam.academic-management');
  check('catalog offers an earlier Academic Management release to upgrade from', academicReleases.length >= 2, academicReleases.map((release) => release.version).join(', ') || 'none');
  const [latestAcademic, previousAcademic] = academicReleases.map((release) => release.version);
  const academic = await installFromCatalog('wattanam.academic-management', 'previous');
  const academicState = await pluginState('wattanam.academic-management');
  check('Academic Management (previous release) installs and activates with consent', academic.status < 300 && academicState?.status === 'active' && academicState?.version === previousAcademic, `HTTP ${academic.status}, ${academicState?.version}`);

  // 4. Data through the plugin's own API
  const department = await school('POST', '/plugin-api/wattanam.academic-management/departments', { name: 'Lifecycle Science' });
  check('plugin API stores school data (department)', department.status < 300 && department.body?.id, `HTTP ${department.status}`);
  const attendance = await installFromCatalog('wattanam.attendance-manager');
  check('Attendance Manager installs once its dependency is active', attendance.status < 300 && (await pluginState('wattanam.attendance-manager'))?.status === 'active', `HTTP ${attendance.status} ${attendance.status >= 300 ? JSON.stringify(attendance.body).slice(0, 300) : ''}`);
  const removeDependency = await school('DELETE', '/plugins/wattanam.academic-management');
  check('a plugin another active plugin depends on cannot be removed', removeDependency.status >= 400, `HTTP ${removeDependency.status}`);

  // Optional operator rehearsal: E2E_AFTER_PLUGINS_HOOK is a shell command run here, when the school
  // holds two active plugins and data. It may change the deployment underneath (for example the
  // runtime database user cutover: provision-runtime-database-roles.js, then restart the API on
  // the restricted user). Every later stage then proves the school still works afterwards.
  if (process.env.E2E_AFTER_PLUGINS_HOOK) {
    const hook = require('node:child_process').spawnSync(process.env.E2E_AFTER_PLUGINS_HOOK, { shell: true, stdio: 'inherit' });
    check('operator hook completed', hook.status === 0, `exit ${hook.status}`);
    let health = { status: 0 };
    for (let attempt = 0; attempt < 90 && health.status !== 200; attempt += 1) {
      health = await fetch(`${SCHOOL}/api/health`).then((response) => ({ status: response.status })).catch(() => ({ status: 0 }));
      if (health.status !== 200) await sleep(2000);
    }
    check('the school is healthy again after the operator hook', health.status === 200, `HTTP ${health.status}`);
    const stillSignedIn = await school('GET', '/plugins');
    const stillActive = (Array.isArray(stillSignedIn.body) ? stillSignedIn.body : []).filter((plugin) => plugin.status === 'active').map((plugin) => plugin.id).sort();
    check('both plugins are active again after the operator hook', stillActive.join(',') === 'wattanam.academic-management,wattanam.attendance-manager', `HTTP ${stillSignedIn.status}: ${stillActive.join(',') || 'none'}`);
    const dataAfterHook = await school('GET', '/plugin-api/wattanam.academic-management/departments');
    const rowsAfterHook = Array.isArray(dataAfterHook.body) ? dataAfterHook.body : dataAfterHook.body?.items || dataAfterHook.body?.data || [];
    check('plugin data is readable through the plugin API after the operator hook', dataAfterHook.status < 300 && rowsAfterHook.some((item) => item.id === department.body.id), `HTTP ${dataAfterHook.status}, ${rowsAfterHook.length} departments`);
  }

  // 5. In-place upgrade of an active plugin that holds data and has an active dependent.
  // Academic Management 0.3.4 added migration 062, which seeds four default student attendance
  // sessions; upgrading from 0.3.3 must apply it to the populated database.
  const defaultSessions = async () => {
    const response = await school('GET', '/plugin-api/wattanam.academic-management/sessions');
    const rows = Array.isArray(response.body) ? response.body : [];
    return { status: response.status, count: rows.filter((row) => /^student-default-session-[1-4]$/.test(row.id)).length };
  };
  const sessionsBefore = await defaultSessions();
  const upgrade = await installFromCatalog('wattanam.academic-management', 'latest');
  const upgraded = await pluginState('wattanam.academic-management');
  check(`Academic Management upgrades in place ${previousAcademic} -> ${latestAcademic} while active`, upgrade.status < 300 && upgraded?.status === 'active' && upgraded?.version === latestAcademic, `HTTP ${upgrade.status}, ${upgraded?.status} ${upgraded?.version} ${upgrade.status >= 300 ? JSON.stringify(upgrade.body).slice(0, 300) : ''}`);
  const sessionsAfter = await defaultSessions();
  check('the upgrade applied the new migration (default attendance sessions seeded)', sessionsAfter.status < 300 && sessionsAfter.count === 4 && sessionsBefore.count === 0, `before ${sessionsBefore.count} (HTTP ${sessionsBefore.status}), after ${sessionsAfter.count} (HTTP ${sessionsAfter.status})`);
  check('the dependent Attendance Manager stays active through the upgrade', (await pluginState('wattanam.attendance-manager'))?.status === 'active', (await pluginState('wattanam.attendance-manager'))?.status);
  const afterUpgrade = await school('GET', '/plugin-api/wattanam.academic-management/departments');
  const upgradedList = Array.isArray(afterUpgrade.body) ? afterUpgrade.body : afterUpgrade.body?.items || afterUpgrade.body?.data || [];
  check('data written before the upgrade is still there', afterUpgrade.status < 300 && upgradedList.some((item) => item.id === department.body.id), `HTTP ${afterUpgrade.status}, ${upgradedList.length} departments`);
  const postUpgradeWrite = await school('POST', '/plugin-api/wattanam.academic-management/departments', { name: 'Lifecycle Mathematics' });
  check('the upgraded plugin accepts new writes', postUpgradeWrite.status < 300 && postUpgradeWrite.body?.id, `HTTP ${postUpgradeWrite.status}`);
  const downgrade = await installFromCatalog('wattanam.academic-management', 'previous');
  const afterDowngrade = await pluginState('wattanam.academic-management');
  check('downgrading an active plugin is refused and the new version keeps running', downgrade.status >= 400 && afterDowngrade?.status === 'active' && afterDowngrade?.version === latestAcademic, `HTTP ${downgrade.status}, ${afterDowngrade?.status} ${afterDowngrade?.version}`);

  // 6. Deactivate / reactivate, uninstall / reinstall with data retained
  const off = await school('POST', '/plugins/wattanam.attendance-manager/deactivate', {});
  check('Attendance Manager deactivates', off.status < 300 && (await pluginState('wattanam.attendance-manager'))?.status !== 'active', `HTTP ${off.status}`);
  const on = await school('POST', '/plugins/wattanam.attendance-manager/activate', {});
  check('Attendance Manager reactivates', on.status < 300 && (await pluginState('wattanam.attendance-manager'))?.status === 'active', `HTTP ${on.status}`);
  await school('POST', '/plugins/wattanam.attendance-manager/deactivate', {});
  const removeAttendance = await school('DELETE', '/plugins/wattanam.attendance-manager');
  await school('POST', '/plugins/wattanam.academic-management/deactivate', {});
  const removeAcademic = await school('DELETE', '/plugins/wattanam.academic-management');
  check('both plugins uninstall in dependency order', removeAttendance.status < 300 && removeAcademic.status < 300, `HTTP ${removeAttendance.status}/${removeAcademic.status}`);
  const gone = await school('GET', '/plugin-api/wattanam.academic-management/departments');
  check('an uninstalled plugin exposes no API', gone.status >= 400, `HTTP ${gone.status}`);
  const again = await installFromCatalog('wattanam.academic-management');
  await sleep(500);
  const departments = await school('GET', '/plugin-api/wattanam.academic-management/departments');
  const list = Array.isArray(departments.body) ? departments.body : departments.body?.items || departments.body?.data || [];
  check('reinstall reuses retained data: the department is still there', again.status < 300 && list.some((item) => item.id === department.body.id), `${list.length} departments`);

  // 7. Plugin-owned screens (app component, core >= 0.1.29): served from the signed package, sandboxed.
  const extensions = await school('GET', '/plugin-api/my-extensions');
  const screenPage = (extensions.body?.pages || []).find((page) => page.pluginId === 'wattanam.academic-management' && (page.components || []).some((component) => component.type === 'app'));
  if (!screenPage) {
    process.stdout.write('SKIP  plugin-owned screen checks (installed Academic Management has no app component)\n');
  } else {
    const screen = screenPage.components.find((component) => component.type === 'app');
    check('the page descriptor pins the installed plugin version for its screen', screenPage.pluginVersion === latestAcademic, `${screenPage.pluginVersion}`);
    const base = `${SCHOOL}/api/plugin-ui/wattanam.academic-management`;
    const asset = await fetch(`${base}/${latestAcademic}/${screen.options.entry}`);
    const csp = asset.headers.get('content-security-policy') || '';
    const assetText = await asset.text();
    check('the plugin screen is served from the signed package with a sandboxing policy', asset.status === 200 && /<html/i.test(assetText) && /sandbox allow-scripts/.test(csp) && !/allow-same-origin/.test(csp) && /connect-src 'none'/.test(csp), `HTTP ${asset.status}, ${csp.slice(0, 60)}…`);
    const wrongVersion = await fetch(`${base}/0.0.1/${screen.options.entry}`);
    const notUi = await fetch(`${base}/${latestAcademic}/plugin.json`);
    const traversal = await fetch(`${base}/${latestAcademic}/ui/..%2fplugin.json`);
    check('other versions, non-ui files and path tricks are not served', wrongVersion.status === 404 && notUi.status === 404 && traversal.status === 404, `HTTP ${wrongVersion.status}/${notUi.status}/${traversal.status}`);
  }

  summary();
}

main().catch((error) => { process.stdout.write(`FAIL  unexpected error: ${error.message}\n`); summary(); process.exit(1); });
