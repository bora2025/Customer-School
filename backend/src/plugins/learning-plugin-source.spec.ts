import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';

const root = path.resolve(__dirname, '../../../plugins/wattanam.learning');

describe('Learning plugin source', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  it('owns the complete 13-model Learning foundation without cross-plugin foreign keys', () => {
    expect(manifest.version).toBe('0.1.5');
    expect(manifest.dependencies['wattanam.academic-management']).toBeDefined();
    expect(manifest.permissions).toHaveLength(6);
    expect(manifest.migrations).toHaveLength(14);
    expect(manifest.migrations.at(-1)).toMatchObject({ id: '014_allow_assignment_attempts', destructive: true });
    const sql = manifest.migrations.map((migration: { path: string }) => readFileSync(path.join(root, migration.path), 'utf8')).join('\n');
    for (const table of ['assignment','assignment_submission','quiz_question','quiz_answer','course','lesson','lesson_page','course_enrollment','lesson_attempt','page_response','course_session','course_attendance','lesson_view']) expect(sql).toContain(`plugin_wattanam_learning_${table}`);
    expect(sql).not.toMatch(/REFERENCES\s+(?:"?(?:User|Student|Class)"?)/i);
    expect(sql).toContain('"academicStudentId"');
    expect(sql).toContain('"createdByDirectoryUserId"');
    const migrations = new PluginMigrationsService();
    for (const migration of manifest.migrations) expect(() => migrations.validateSql(manifest, migration.id, readFileSync(path.join(root, migration.path), 'utf8'), migration.destructive)).not.toThrow();
  });
  it('declares valid permission-gated teacher workspaces and student discovery pages', () => {
    const descriptor = JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));
    expect(bundle.pages.map((page) => page.routePath)).toEqual(['courses','courses/:id','lessons/:id','assignments','assignments/:id','student/courses','student/assignments']);
  });
  it('binds every declarative data source to a runtime route with the same permission', async () => {
    const descriptor = JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));
    const routes = new Map<string, any>();
    const plugin = require(path.join(root, 'backend/index.js'));
    await plugin.activate({
      database: { query: jest.fn(), execute: jest.fn(), transaction: jest.fn() },
      directory: { lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn(), getClassRoster: jest.fn() },
      notifications: { notifyInApp: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => routes.set(`${route.method} ${route.path}`, route) },
    });
    for (const page of bundle.pages) for (const source of page.dataSources) {
      const route = routes.get(`${source.method} ${source.path}`);
      expect(route).toBeDefined();
      expect(route.permission).toBe(source.permission);
    }
  });
});
