import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';

const root = path.resolve(
  __dirname,
  '../../../plugins/wattanam.transportation',
);
describe('Transportation plugin source', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'plugin.json'), 'utf8'),
  );
  it('owns five namespaced models with stable directory and Academic identity only', () => {
    expect(manifest.version).toBe('0.1.4');
    expect(manifest.capabilities).toContain('readmodels.publish');
    expect(manifest.migrations).toHaveLength(5);
    expect(manifest.permissions).toHaveLength(4);
    const sql = manifest.migrations
      .map((entry: any) => readFileSync(path.join(root, entry.path), 'utf8'))
      .join('\n');
    for (const table of [
      'route',
      'stop',
      'vehicle',
      'location',
      'rider_assignment',
    ])
      expect(sql).toContain(`plugin_wattanam_transportation_${table}`);
    expect(sql).not.toMatch(/REFERENCES\s+"?(User|Student|Bus|BusRoute)/i);
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
  it('declares valid UI whose data sources bind to same-permission runtime routes', async () => {
    const descriptor = JSON.parse(
        readFileSync(path.join(root, 'frontend/page.json'), 'utf8'),
      ),
      bundle = parsePluginUiBundle(
        descriptor,
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
      directory: { lookupUsers: jest.fn() },
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
      'vehicles',
      'routes',
      'vehicles/:id',
      'parent/vehicles',
    ]);
    for (const page of bundle.pages)
      for (const source of page.dataSources) {
        const route = routes.get(`${source.method} ${source.path}`);
        expect(route).toBeDefined();
        expect(route.permission).toBe(source.permission);
      }
  });
});
