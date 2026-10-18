'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve a plugin source checkout for certification commands.
 *
 * Production keeps the school core and publisher source in separate repositories. CI and local
 * operators can provide WATTANAM_PLUGIN_SOURCE_ROOT explicitly; the sibling wattanam-v2 checkout
 * is accepted as a developer convenience. A monorepo-style local plugins directory remains a
 * final compatibility fallback.
 */
function resolvePluginSource(pluginId, env = process.env) {
  const roots = [
    env.WATTANAM_PLUGIN_SOURCE_ROOT,
    path.resolve(__dirname, '..', '..', '..', 'wattanam-v2', 'plugins'),
    path.resolve(__dirname, '..', '..', 'plugins'),
  ].filter(Boolean);

  for (const pluginsRoot of roots) {
    const candidate = path.resolve(pluginsRoot, pluginId);
    if (fs.existsSync(path.join(candidate, 'plugin.json'))) return candidate;
  }

  throw new Error(
    `Plugin source ${pluginId} was not found. Set WATTANAM_PLUGIN_SOURCE_ROOT to the directory containing publisher plugin folders. Checked: ${roots.join(', ')}`,
  );
}

module.exports = { resolvePluginSource };
