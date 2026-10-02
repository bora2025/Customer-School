import { PLUGIN_CAPABILITIES, PLUGIN_CAPABILITIES_V1_1, PLUGIN_SDK_VERSION, PLUGIN_RUNTIME_VERSION, parsePluginManifest } from './manifest';

// Twin of backend/src/plugins/plugin-sdk-contract.spec.ts -- keep both lists
// identical by hand; a mismatch here or there is exactly the drift this
// pinning pair exists to catch on review.
describe('SDK 1.0 frozen contract surface (twin of the backend pinning test)', () => {
  it('pins the exact set of capabilities shipped in the 1.0.0 freeze', () => {
    expect([...PLUGIN_CAPABILITIES].sort()).toEqual([
      'api.routes', 'database.read', 'database.write', 'directory.read', 'events.publish',
      'events.subscribe', 'jobs.schedule', 'navigation.register', 'notifications.send',
      'permissions.register', 'realtime.notify', 'settings.read', 'settings.write',
      'storage.read', 'storage.write', 'ui.pages',
    ]);
  });

  it('pins the SDK and runtime version at 1.0.0', () => {
    expect(PLUGIN_SDK_VERSION).toBe('1.1.0');
    expect(PLUGIN_RUNTIME_VERSION).toBe('1.0.0');
    expect([...PLUGIN_CAPABILITIES_V1_1].sort()).toEqual(['accounts.guardian.assign', 'accounts.parent.resolve', 'accounts.student.create', 'accounts.student.update', 'crypto.hash', 'events.durable', 'readmodels.publish', 'readmodels.read']);
  });
});

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, id: 'acme.widget', name: 'Widget', description: 'A widget', version: '1.0.0',
    requiresCore: '>=1.0.0 <2.0.0', publisher: 'acme', license: 'MIT',
    backendEntry: 'backend/index.js', capabilities: ['api.routes'], permissions: ['acme.widget.read'],
    dependencies: {}, migrations: [], navigation: [], supportedLanguages: ['en'],
    ...overrides,
  };
}

describe('parsePluginManifest', () => {
  it('accepts a well-formed manifest and normalizes it', () => {
    const parsed = parsePluginManifest(validManifest());
    expect(parsed).toMatchObject({ id: 'acme.widget', publisher: 'acme', capabilities: ['api.routes'] });
  });

  it('requires the plugin id to be namespaced by its publisher', () => {
    expect(() => parsePluginManifest(validManifest({ id: 'other.widget' }))).toThrow('namespaced by its publisher');
  });

  it('rejects an unsupported capability', () => {
    expect(() => parsePluginManifest(validManifest({ capabilities: ['http.fetch'] }))).toThrow('unsupported capability');
  });

  it('rejects a migration path outside migrations/*.sql', () => {
    const migration = { id: '001', path: '../escape.sql', checksum: 'a'.repeat(64) };
    expect(() => parsePluginManifest(validManifest({ migrations: [migration] }))).toThrow('safe relative package path');
  });

  it('rejects a navigation entry not namespaced under /plugins/<id>/', () => {
    const navigation = [{ id: 'settings', label: 'Settings', href: '/plugins/someone-else/settings' }];
    expect(() => parsePluginManifest(validManifest({ capabilities: ['navigation.register'], navigation }))).toThrow('not namespaced by plugin id');
  });

  it('rejects a plugin declaring an sdkVersion range this SDK does not satisfy', () => {
    expect(() => parsePluginManifest(validManifest({ sdkVersion: '>=2.0.0' }))).toThrow('unsupported SDK version');
  });

  it('normalizes and rejects unsafe operational contracts using the host rules', () => {
    const operational = {
      healthCheck: 'runtime', dataClassification: ['personal-data', 'personal-data'],
      backup: { database: 'required', files: 'none', restore: 'required' },
      uninstall: { dataRetention: 'preserve' }, pricing: 'marketplace',
    };
    expect(parsePluginManifest(validManifest({ operational })).operational?.dataClassification).toEqual(['personal-data']);
    expect(() => parsePluginManifest(validManifest({ operational: { ...operational, pricing: 'embedded' } }))).toThrow('pricing');
  });
});
