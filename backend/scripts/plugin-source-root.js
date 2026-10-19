'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve a plugin source checkout for certification commands.
 *
 * Production keeps the school core and publisher source in separate repositories. CI and local
 * operators must provide WATTANAM_PLUGIN_SOURCE_ROOT explicitly. Customer School never searches
 * sibling or monorepo plugin source directories implicitly.
 */
function resolvePluginSource(pluginId, env = process.env) {
  const roots = [env.WATTANAM_PLUGIN_SOURCE_ROOT].filter(Boolean);

  for (const pluginsRoot of roots) {
    const candidate = path.resolve(pluginsRoot, pluginId);
    if (fs.existsSync(path.join(candidate, 'plugin.json'))) return candidate;
  }

  throw new Error(
    `Plugin source ${pluginId} was not found. Set WATTANAM_PLUGIN_SOURCE_ROOT to the external directory containing publisher plugin folders.${roots.length ? ` Checked: ${roots.join(', ')}` : ''}`,
  );
}

module.exports = { resolvePluginSource };
