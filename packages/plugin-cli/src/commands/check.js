'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { sha256 } = require('../util');

const UNIVERSAL_COMPONENTS = new Set(['heading', 'text', 'workflow', 'status', 'card', 'metric', 'table', 'form', 'detail', 'chart', 'file', 'print', 'document', 'designer', 'scanner', 'filter', 'actions', 'id-card-manager', 'session-manager', 'profile-manager']);
const UI_ID = /^[a-z0-9][a-zA-Z0-9._-]*$/;

function validateUniversalUi(value) {
  if (!value || value.schemaVersion !== 2 || value.kind !== 'declarative-ui') throw new Error('unsupported schemaVersion or kind');
  if (value.portability !== 'universal') throw new Error('portability must be universal');
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 50) throw new Error('pages must contain 1 to 50 entries');
  const fragments = value.fragments || {};
  if (!fragments || typeof fragments !== 'object' || Array.isArray(fragments) || Object.keys(fragments).length > 50) throw new Error('fragments are invalid');
  const expand = (items, stack = [], prefix = '') => {
    if (!Array.isArray(items)) throw new Error('components must be an array');
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('component must be an object');
      if (!item.use) return [{ ...item, id: `${prefix}${item.id || ''}` }];
      if (!UI_ID.test(item.use) || !Array.isArray(fragments[item.use])) throw new Error(`unknown fragment ${item.use}`);
      if (stack.includes(item.use) || stack.length >= 5) throw new Error(`cyclic or deeply nested fragment ${item.use}`);
      const localPrefix = item.idPrefix || '';
      if (localPrefix && !UI_ID.test(localPrefix)) throw new Error('fragment idPrefix is invalid');
      return expand(fragments[item.use], [...stack, item.use], `${prefix}${localPrefix}`);
    });
  };
  for (const page of value.pages) {
    if (!page || !UI_ID.test(page.id) || typeof page.title !== 'string' || !page.title.trim()) throw new Error('page id or title is invalid');
    const sources = new Set((page.dataSources || []).map((source) => source?.id));
    const components = expand(page.components);
    if (components.length < 1 || components.length > 100) throw new Error('page must expand to 1 to 100 components');
    const ids = new Set();
    for (const component of components) {
      if (!UI_ID.test(component.id) || ids.has(component.id)) throw new Error(`component id is invalid or duplicated: ${component.id}`);
      ids.add(component.id);
      if (!UNIVERSAL_COMPONENTS.has(component.type)) throw new Error(`component is not universal: ${component.type}`);
      if (component.source && !sources.has(component.source)) throw new Error(`component references unknown source: ${component.source}`);
    }
  }
}

/**
 * The compatibility test kit: validates a plugin directory the same way the
 * real backend verifier would, plus a local activate() smoke test -- all
 * without a running backend. Throws (rather than calling process.exit
 * itself) on any failure, so it stays a plain, testable function; bin/cli.js
 * is the only place that turns a thrown error into a process exit code.
 */
async function run(argv, options = {}) {
  const dir = argv[0];
  if (!dir || argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin check <plugin-directory>\n');
    if (!dir) throw new Error('Missing required <plugin-directory> argument');
    return;
  }
  const root = path.resolve(dir);
  // eslint-disable-next-line global-require
  const { parsePluginManifest, createTestContext } = require('@wattanam/plugin-sdk');

  let failures = 0;
  const failedLabels = [];
  const check = (label, ok, detail) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}\n`);
    if (!ok) { failures += 1; failedLabels.push(`${label}${detail ? ` (${detail})` : ''}`); }
  };

  const manifestPath = path.join(root, 'plugin.json');
  let manifest;
  if (!fs.existsSync(manifestPath)) {
    check('plugin.json exists', false, root);
  } else {
    try {
      manifest = parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      check('plugin.json is a valid manifest', true);
    } catch (error) {
      check('plugin.json is a valid manifest', false, error.message);
    }
  }

  if (manifest) {
    for (const migration of manifest.migrations) {
      const migrationFile = path.join(root, migration.path);
      if (!fs.existsSync(migrationFile)) { check(`migration file exists: ${migration.path}`, false); continue; }
      check(`migration file exists: ${migration.path}`, true);
      const actual = sha256(fs.readFileSync(migrationFile));
      check(`migration checksum matches plugin.json: ${migration.id}`, actual === migration.checksum, actual === migration.checksum ? undefined : `expected ${migration.checksum}, got ${actual}`);
    }

    for (const entry of [manifest.backendEntry, manifest.frontendEntry].filter(Boolean)) {
      check(`entry file exists: ${entry}`, fs.existsSync(path.join(root, entry)));
    }

    if (manifest.frontendEntry && fs.existsSync(path.join(root, manifest.frontendEntry))) {
      try {
        validateUniversalUi(JSON.parse(fs.readFileSync(path.join(root, manifest.frontendEntry), 'utf8')));
        check('frontend entry is valid universal UI', true);
      } catch (error) {
        check('frontend entry is valid universal UI', false, error.message);
      }
    }

    if (manifest.backendEntry && options.activate !== false) {
      const entryPath = path.resolve(root, manifest.backendEntry);
      let plugin;
      try {
        // Compile the entry from its real filename. This preserves normal relative require()
        // resolution while avoiding test-runner resolvers that reject valid temp directories.
        const entryModule = new Module(entryPath, module);
        entryModule.filename = entryPath;
        entryModule.paths = Module._nodeModulePaths(path.dirname(entryPath));
        entryModule._compile(fs.readFileSync(entryPath, 'utf8'), entryPath);
        plugin = entryModule.exports;
        check('backend entry exports { id, activate }', Boolean(plugin) && plugin.id === manifest.id && typeof plugin.activate === 'function', plugin ? `id=${plugin.id}` : 'module has no exports');
        if (manifest.operational?.healthCheck === 'runtime') {
          check('backend entry exports the declared health check', typeof plugin?.health === 'function');
          if (typeof plugin?.health === 'function') {
            const health = await plugin.health();
            check('runtime health check reports ready', health?.status === 'ready', `status=${health?.status || 'missing'}`);
          }
        }
      } catch (error) {
        check('backend entry loads without throwing', false, error.message);
      }
      if (plugin && typeof plugin.activate === 'function') {
        try {
          const harness = createTestContext();
          await plugin.activate(harness.context);
          check('activate(context) runs against the local harness without throwing', true);
        } catch (error) {
          check('activate(context) runs against the local harness without throwing', false, error.message);
        }
      }
    }
  }

  process.stdout.write(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  if (failures > 0) throw new Error(`${failures} check(s) failed: ${failedLabels.join(', ')}`);
}

module.exports = { run, validateUniversalUi };
