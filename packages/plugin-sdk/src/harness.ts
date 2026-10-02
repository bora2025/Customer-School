import type {
  PluginRuntimeContext, PluginRouteDefinition, DirectoryAudienceQuery, DirectoryRecipient,
} from './types';

export interface TestHarness {
  context: PluginRuntimeContext;
  /** Every route registered by activate(), so a test can find one and call its handler directly. */
  routes: PluginRouteDefinition[];
  jobs: Array<{ id: string; intervalSeconds: number; handler(): void | Promise<void> }>;
  permissions: Array<{ id: string; label: string; description?: string }>;
  navigation: Array<{ id: string; label: string; href: string; permission?: string }>;
  events: {
    published: Array<{ event: string; payload: unknown }>;
    subscriptions: Array<{ event: string; handler: (payload: unknown) => void | Promise<void> }>;
  };
  notifications: {
    sent: Array<{ channel: 'email' | 'sms' | 'in_app'; args: unknown[] }>;
  };
  realtime: {
    emitted: Array<{ userId: string; event: string; payload: unknown }>;
  };
}

/**
 * A local test harness for a plugin's backend/index.js: build a
 * fully-functional (if unstyled) PluginRuntimeContext, call your plugin's
 * activate(context), then inspect the returned recorders (routes, events,
 * notifications, realtime) to assert on what it did -- all without a
 * running backend, a database, or any specific test framework. Pass
 * `overrides` to plug in your own database/directory/settings/storage
 * behavior for a specific test case; everything else defaults to a
 * reasonable in-memory stub.
 */
type ContextOverrides = Omit<Partial<PluginRuntimeContext>, 'database'> & { database?: Partial<PluginRuntimeContext['database']> };

export function createTestContext(overrides: ContextOverrides = {}): TestHarness {
  const { database: databaseOverride, ...topLevelOverrides } = overrides;
  const routes: PluginRouteDefinition[] = [];
  const jobs: TestHarness['jobs'] = [];
  const permissions: TestHarness['permissions'] = [];
  const navigation: TestHarness['navigation'] = [];
  const published: TestHarness['events']['published'] = [];
  const subscriptions: TestHarness['events']['subscriptions'] = [];
  const sent: TestHarness['notifications']['sent'] = [];
  const emitted: TestHarness['realtime']['emitted'] = [];

  const settingsStore = new Map<string, unknown>();
  const storageStore = new Map<string, string>();

  const context: PluginRuntimeContext = {
    sdkVersion: '1.1.0',
    pluginId: 'local-test-plugin',
    logger: { log: () => undefined },
    dependencies: { required: {}, optional: {}, isAvailable: async () => false },
    events: {
      publish: (event, payload) => { published.push({ event, payload }); },
      subscribe: (event, handler) => { subscriptions.push({ event, handler }); return () => undefined; },
    },
    durableEvents: { subscribe: () => () => undefined },
    routes: { register: (definition) => { routes.push(definition); return () => undefined; } },
    jobs: { register: async (definition) => { jobs.push(definition); return () => undefined; } },
    settings: {
      get: async <T,>(key: string, fallback?: T) => (settingsStore.has(key) ? (settingsStore.get(key) as T) : fallback),
      set: async (key, value) => { settingsStore.set(key, value); },
      delete: async (key) => { settingsStore.delete(key); },
    },
    storage: {
      readText: async (name) => storageStore.get(name) ?? null,
      writeText: async (name, value) => { storageStore.set(name, value); },
      delete: async (name) => { storageStore.delete(name); },
      list: async (prefix = '') => [...storageStore.keys()].filter((key) => key.startsWith(prefix)).sort(),
    },
    permissions: { register: (definitions) => { permissions.push(...definitions); return () => undefined; } },
    navigation: { register: (entries) => { navigation.push(...entries); return () => undefined; } },
    notifications: {
      sendEmail: async (to, subject, text) => { sent.push({ channel: 'email', args: [to, subject, text] }); return { sent: true }; },
      sendSms: async (to, body) => { sent.push({ channel: 'sms', args: [to, body] }); return { sent: true }; },
      notifyInApp: async (userId, message, type) => { sent.push({ channel: 'in_app', args: [userId, message, type] }); return { id: 'test-notification' }; },
    },
    database: {
      query: async () => [],
      execute: async () => ({ count: 0 }),
      transaction: async (work) => work({ query: async () => [], execute: async () => ({ count: 0 }), publish: async () => undefined }),
      ...databaseOverride,
    },
    readModels: { publish: async () => undefined, read: async () => [] },
    directory: {
      resolveAudience: async (_input: DirectoryAudienceQuery): Promise<DirectoryRecipient[]> => [],
      lookupUsers: async () => [],
      lookupClasses: async () => [],
      classesForUser: async () => [],
      getClassRoster: async (classId: string, asOfIsoDate: string) => ({
        contract: { id: 'wattanam.academic-management.roster' as const, version: '1.0.0' as const },
        classId, className: null, asOfIsoDate, source: 'plugin-enrollment-interval' as const, students: [],
      }),
      getEnrollmentAtDate: async (studentId: string, asOfIsoDate: string) => ({
        contract: { id: 'wattanam.academic-management.roster' as const, version: '1.0.0' as const },
        studentId, classId: null, className: null, enrolled: false, asOfIsoDate,
        source: 'plugin-enrollment-interval' as const,
      }),
    },
    realtime: {
      notifyUser: (userId, event, payload) => { emitted.push({ userId, event, payload }); },
    },
    crypto: { hashBcrypt: async (plaintext) => `bcrypt:${plaintext}` },
    accounts: {
      createStudent: async (input) => ({ id: `student-${input.commandKey}`, name: input.name, role: 'STUDENT', email: input.email ?? null, phone: input.phone ?? null }),
      updateStudent: async (input) => ({ id: input.userId, name: input.name, role: 'STUDENT', email: input.email ?? null, phone: input.phone ?? null }),
      resolveParent: async (input) => ({ id: `parent-${input.commandKey}`, name: input.name, role: 'PARENT', email: input.email, phone: input.phone ?? null, created: true }),
      assignGuardian: async () => undefined,
    },
    ...topLevelOverrides,
  };

  return { context, routes, jobs, permissions, navigation, events: { published, subscriptions }, notifications: { sent }, realtime: { emitted } };
}
