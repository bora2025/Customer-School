import { PLUGIN_CAPABILITIES, PLUGIN_CAPABILITIES_V1_1, PLUGIN_DATA_CLASSIFICATIONS, PLUGIN_SDK_VERSION, PLUGIN_RUNTIME_VERSION } from './plugin-manifest';

/**
 * Pins the frozen SDK 1.0 contract surface (C-006). This test exists so an
 * accidental or undiscussed change to the capability list or version
 * constants fails CI loudly, instead of silently drifting. A deliberate,
 * reviewed addition is fine -- update this list AND
 * docs/plugins/package-and-runtime.md's changelog in the same change; a
 * removal or renamed capability is a breaking change and requires bumping
 * PLUGIN_SDK_VERSION to 2.0.0, per the compatibility policy in that doc.
 *
 * Twin: packages/plugin-sdk/src/manifest.spec.ts pins the identical literal
 * list independently (C-008) -- that package has no runtime dependency on
 * this backend, so the two are kept in sync by review convention, not by
 * import. Change one, change both.
 */
describe('SDK 1.0 frozen contract surface', () => {
  it('pins the exact set of capabilities shipped in the 1.0.0 freeze', () => {
    expect([...PLUGIN_CAPABILITIES].sort()).toEqual([
      'api.routes',
      'database.read',
      'database.write',
      'directory.read',
      'events.publish',
      'events.subscribe',
      'jobs.schedule',
      'navigation.register',
      'notifications.send',
      'permissions.register',
      'realtime.notify',
      'settings.read',
      'settings.write',
      'storage.read',
      'storage.write',
      'ui.pages',
    ]);
  });

  it('ships the additive consistency contract as SDK 1.1 on runtime 1.0', () => {
    expect(PLUGIN_SDK_VERSION).toBe('1.1.0');
    expect(PLUGIN_RUNTIME_VERSION).toBe('1.0.0');
  });

  it('keeps new SDK 1.1 capabilities separate from the frozen 1.0 list', () => {
    expect([...PLUGIN_CAPABILITIES_V1_1].sort()).toEqual(['accounts.guardian.assign', 'accounts.parent.resolve', 'accounts.student.create', 'accounts.student.update', 'crypto.hash', 'events.durable', 'readmodels.publish', 'readmodels.read']);
  });

  it('pins the operational data-classification vocabulary shared with the public SDK', () => {
    expect([...PLUGIN_DATA_CLASSIFICATIONS].sort()).toEqual([
      'communications', 'education-records', 'employment-records', 'financial-records',
      'generated-documents', 'location-data', 'personal-data',
    ]);
  });
});
