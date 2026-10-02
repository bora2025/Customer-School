import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';
const root = path.resolve(__dirname, '../../../plugins/wattanam.finance');
describe('Finance plugin source', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'plugin.json'), 'utf8'),
  );
  it('uses isolated minor-unit and immutable-receipt storage', () => {
    expect(manifest.version).toBe('0.1.3');
    expect(manifest.migrations).toHaveLength(4);
    const sql = manifest.migrations
      .map((entry: any) => readFileSync(path.join(root, entry.path), 'utf8'))
      .join('\n');
    for (const table of [
      'fee_record',
      'fee_payment',
      'fee_settings',
      'payment_reversal',
    ])
      expect(sql).toContain(`plugin_wattanam_finance_${table}`);
    expect(sql).toContain('BIGINT');
    expect(sql).toContain('receiptNumber');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).not.toMatch(/\b(Float|REAL|DOUBLE PRECISION)\b/i);
    expect(sql).not.toMatch(/REFERENCES\s+"?(Student|User|FeeRecord)/i);
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
  it('binds each finance UI source to the same permission route', async () => {
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
      directory: { getEnrollmentAtDate: jest.fn() },
      permissions: { register: jest.fn() },
      navigation: { register: jest.fn() },
      routes: {
        register: (route: any) =>
          routes.set(`${route.method} ${route.path}`, route),
      },
    });
    for (const page of bundle.pages)
      for (const source of page.dataSources) {
        const route = routes.get(`${source.method} ${source.path}`);
        expect(route).toBeDefined();
        expect(route.permission).toBe(source.permission);
      }
  });
});
