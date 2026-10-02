import { parsePluginManifest } from './plugin-manifest';

const valid = {
  schemaVersion: 1,
  id: 'wattanam.announcements',
  name: 'Announcements',
  description: 'Official announcement features.',
  version: '1.0.0',
  requiresCore: '>=1.0.0 <2.0.0',
  publisher: 'wattanam',
  license: 'commercial',
  backendEntry: 'backend/index.js',
  capabilities: ['api.routes', 'events.publish'],
  permissions: ['wattanam.announcements.read'],
  dependencies: {},
};

describe('plugin manifest', () => {
  it('normalizes a valid namespaced manifest', () => {
    expect(parsePluginManifest(valid)).toMatchObject({ ...valid, migrations: [], navigation: [], supportedLanguages: [] });
  });

  it('rejects an unnamespaced plugin id', () => {
    expect(() => parsePluginManifest({ ...valid, id: 'other.plugin' })).toThrow('namespaced');
  });

  it('rejects invalid semantic versions and core ranges', () => {
    expect(() => parsePluginManifest({ ...valid, version: 'latest' })).toThrow('semantic');
    expect(() => parsePluginManifest({ ...valid, requiresCore: 'not-a-range' })).toThrow('range');
  });

  it('rejects unknown capabilities and unnamespaced permissions', () => {
    expect(() => parsePluginManifest({ ...valid, capabilities: ['server.root'] })).toThrow('capability');
    expect(() => parsePluginManifest({ ...valid, permissions: ['core.users.manage'] })).toThrow('namespaced');
  });

  it('rejects traversal in entry points', () => {
    expect(() => parsePluginManifest({ ...valid, backendEntry: '../index.js' })).toThrow('safe relative');
  });

  it('normalizes the operational backup, retention, classification and pricing contract', () => {
    const operational = {
      healthCheck: 'runtime',
      dataClassification: ['personal-data', 'personal-data', 'communications'],
      backup: { database: 'required', files: 'none', restore: 'required' },
      uninstall: { dataRetention: 'preserve' },
      pricing: 'marketplace',
    };
    expect(parsePluginManifest({ ...valid, operational }).operational).toEqual({
      ...operational,
      dataClassification: ['personal-data', 'communications'],
    });
  });

  it('rejects unsafe operational contracts', () => {
    const operational = {
      healthCheck: 'runtime', dataClassification: ['secrets'],
      backup: { database: 'required', files: 'none', restore: 'required' },
      uninstall: { dataRetention: 'delete' }, pricing: 'free',
    };
    expect(() => parsePluginManifest({ ...valid, operational })).toThrow('dataClassification');
    expect(() => parsePluginManifest({ ...valid, operational: { ...operational, dataClassification: ['personal-data'] } })).toThrow('dataRetention');
  });
});
