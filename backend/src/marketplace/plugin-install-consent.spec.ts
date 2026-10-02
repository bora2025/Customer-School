import { pluginInstallConsentDigest, pluginInstallDisclosure } from './plugin-install-consent';

describe('plugin installation consent', () => {
  it('is canonical across manifest ordering and excludes package internals', () => {
    const left = {
      capabilities: ['database.write', 'api.routes'], permissions: ['demo.manage', 'demo.view'],
      dependencies: { zeta: '^2.0.0', alpha: '^1.0.0' }, optionalDependencies: { messages: '^1.0.0' },
      migrations: [{ id: '001', destructive: false }], backendEntry: 'backend/index.js',
    };
    const right = {
      permissions: ['demo.view', 'demo.manage'], capabilities: ['api.routes', 'database.write'],
      optionalDependencies: { messages: '^1.0.0' }, dependencies: { alpha: '^1.0.0', zeta: '^2.0.0' },
      migrations: [{ destructive: false, id: 'different-private-id' }], backendEntry: 'other.js',
    };
    expect(pluginInstallConsentDigest(left)).toBe(pluginInstallConsentDigest(right));
    expect(pluginInstallDisclosure(left)).not.toHaveProperty('backendEntry');
  });

  it('changes when install authority or migration risk changes', () => {
    const baseline = { capabilities: ['api.routes'], permissions: ['demo.view'], dependencies: {}, migrations: [] };
    expect(pluginInstallConsentDigest({ ...baseline, capabilities: ['api.routes', 'database.write'] })).not.toBe(pluginInstallConsentDigest(baseline));
    expect(pluginInstallConsentDigest({ ...baseline, migrations: [{ destructive: true }] })).not.toBe(pluginInstallConsentDigest(baseline));
  });
});
