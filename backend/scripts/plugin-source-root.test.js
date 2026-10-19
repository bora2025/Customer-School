'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePluginSource } = require('./plugin-source-root');

test('official plugin source resolution fails closed without an explicit external catalog', () => {
  assert.throws(
    () => resolvePluginSource('wattanam.example', {}),
    /WATTANAM_PLUGIN_SOURCE_ROOT/,
  );
});

test('official plugin source resolution accepts an explicitly mounted catalog only', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-plugin-source-'));
  try {
    const plugin = path.join(directory, 'wattanam.example');
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, 'plugin.json'), '{}');
    assert.equal(
      resolvePluginSource('wattanam.example', { WATTANAM_PLUGIN_SOURCE_ROOT: directory }),
      plugin,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
