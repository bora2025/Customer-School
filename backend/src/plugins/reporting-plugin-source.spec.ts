import { readFileSync } from 'fs';
import path from 'path';
import { parsePluginUiBundle } from './plugin-ui-schema';

const root = path.resolve(__dirname, '../../../plugins/wattanam.reporting');

describe('Reporting plugin source', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));

  it('is a read-only aggregation plugin with explicit contracts', () => {
    expect(manifest.version).toBe('0.1.3');
    expect(manifest.migrations).toEqual([]);
    expect(manifest.capabilities).toEqual(expect.arrayContaining(['directory.read', 'readmodels.read', 'ui.pages']));
    expect(manifest.capabilities).not.toEqual(expect.arrayContaining(['database.read', 'database.write']));
    expect(manifest.dependencies).toEqual({ 'wattanam.academic-management': '>=0.1.0 <1.0.0' });
    expect(Object.keys(manifest.optionalDependencies)).toHaveLength(6);
  });

  it('provides a schema-valid filtered report and host-owned export UI', () => {
    const descriptor = JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));
    expect(bundle.pages.map((page) => page.routePath)).toEqual(['student-summaries', 'staff-summaries']);
    const page = bundle.pages[0];
    expect(page.parameters).toEqual([]);
    expect(page.dataSources.map((source) => source.path)).toEqual(['student-summaries']);
    expect(page.components.map((component) => component.type)).toEqual(['filter', 'table', 'print']);
  });
});
