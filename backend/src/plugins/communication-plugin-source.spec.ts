import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';
const root = path.resolve(__dirname, '../../../plugins/wattanam.communication');
describe('Communication plugin source', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'plugin.json'), 'utf8'),
  );
  it('owns message, post and delivery data without cross-boundary foreign keys', () => {
    expect(manifest.id).toBe('wattanam.communication');
    expect(manifest.version).toBe('0.1.3');
    expect(manifest.capabilities).toContain('readmodels.publish');
    expect(manifest.dependencies).toEqual({
      'wattanam.academic-management': '>=0.1.0 <1.0.0',
    });
    const sql = manifest.migrations
      .map((entry: any) => readFileSync(path.join(root, entry.path), 'utf8'))
      .join('\n');
    expect(sql).toContain('plugin_wattanam_communication_message');
    expect(sql).toContain('plugin_wattanam_communication_post');
    expect(sql).toContain('plugin_wattanam_communication_delivery_outbox');
    expect(sql).not.toMatch(
      /REFERENCES\s+"?(User|Student|Class|Message|Post)/i,
    );
    const service = new PluginMigrationsService();
    for (const migration of manifest.migrations)
      expect(() =>
        service.validateSql(
          manifest,
          migration.id,
          readFileSync(path.join(root, migration.path), 'utf8'),
          migration.destructive,
        ),
      ).not.toThrow();
  });
  it('binds every host-rendered data source to a same-permission route', async () => {
    const bundle = parsePluginUiBundle(
        JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8')),
        manifest.id,
        new Set(manifest.permissions),
      ),
      routes = new Map<string, any>(),
      plugin = require(path.join(root, 'backend/index.js'));
    await plugin.activate({
      database: {
        query: jest.fn(),
        execute: jest.fn(),
        transaction: jest.fn(),
      },
      directory: {
        lookupUsers: jest.fn(),
        classesForUser: jest.fn(),
        getClassRoster: jest.fn(),
      },
      jobs: { register: jest.fn() },
      realtime: { notify: jest.fn() },
      readModels: { publish: jest.fn() },
      permissions: { register: jest.fn() },
      navigation: { register: jest.fn() },
      routes: {
        register: (route: any) =>
          routes.set(`${route.method} ${route.path}`, route),
      },
    });
    expect(bundle.pages.map((page) => page.routePath)).toEqual([
      'messages',
      'posts',
    ]);
    for (const page of bundle.pages)
      for (const source of page.dataSources) {
        const route = routes.get(`${source.method} ${source.path}`);
        expect(route).toBeDefined();
        expect(route.permission).toBe(source.permission);
      }
  });
});
