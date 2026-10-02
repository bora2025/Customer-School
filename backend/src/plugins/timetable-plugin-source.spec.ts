import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';

const root = path.resolve(__dirname, '../../../plugins/wattanam.timetable');

describe('Timetable plugin source', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));

  it('keeps timetable data namespaced and migration-compatible with the runtime', () => {
    expect(manifest.version).toBe('0.1.6');
    expect(manifest.capabilities).toContain('directory.read');
    expect(manifest.dependencies).toEqual({ 'wattanam.academic-management': '>=0.1.0 <1.0.0' });
    const migrations = new PluginMigrationsService();
    for (const migration of manifest.migrations) {
      const sql = readFileSync(path.join(root, migration.path), 'utf8');
      expect(() => migrations.validateSql(manifest, migration.id, sql, migration.destructive)).not.toThrow();
    }
  });

  it('offers a permission-gated declarative page with matching routes', () => {
    const descriptor = JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));
    expect(bundle.pages.map((page) => page.routePath)).toEqual(['timetables', 'subjects', 'classes', 'classrooms', 'teachers', 'lessons', 'entries']);
    expect(bundle.pages[0].dataSources.map((source) => source.path)).toEqual(['timetables', 'timetables']);
  });

  it('hosts the rich legacy-equivalent workspace only at plugin-owned entry routes', () => {
    expect(readFileSync(path.resolve(__dirname, '../../../frontend/app/plugins/wattanam.timetable/timetables/page.tsx'), 'utf8')).toContain("/admin/timetable?source=plugin");
    expect(readFileSync(path.resolve(__dirname, '../../../frontend/app/plugins/wattanam.timetable/schedule/page.tsx'), 'utf8')).toContain("/admin/timetable/schedule?source=plugin");
    expect(readFileSync(path.resolve(__dirname, '../../../frontend/app/plugins/wattanam.timetable/teacher-attendance/page.tsx'), 'utf8')).toContain("/admin/timetable/teacher-attendance?source=plugin");
    expect(readFileSync(path.resolve(__dirname, '../../../frontend/app/plugins/wattanam.timetable/scheduled-teachers/page.tsx'), 'utf8')).toContain("/wattaman/scheduled-teacher?source=plugin");
    expect(readFileSync(path.resolve(__dirname, '../../../frontend/app/plugins/wattanam.timetable/teacher-scan/page.tsx'), 'utf8')).toContain("/wattaman/teacher-scan?source=plugin");
    const attendanceWorkspace = readFileSync(path.resolve(__dirname, '../../../frontend/app/admin/timetable/teacher-attendance/page.tsx'), 'utf8');
    expect(attendanceWorkspace).toContain("useSearchParams().get('source') === 'plugin'");
    expect(attendanceWorkspace).toContain('timetableFetch(`/api/timetable/${selectedTT}/teacher-attendance');
    const adapter = readFileSync(path.resolve(__dirname, '../../../frontend/lib/timetable-plugin-api.ts'), 'utf8');
    expect(adapter).toContain("suffix === '/teacher-attendance/mark'");
    expect(adapter).toContain("suffix === '/teacher-attendance/wattaman-scan'");
    expect(adapter).toContain("suffix === '/scheduled-teachers/all'");
    const scheduledTeachers = readFileSync(path.resolve(__dirname, '../../../frontend/app/wattaman/scheduled-teacher/page.tsx'), 'utf8');
    expect(scheduledTeachers).toContain("useSearchParams().get('source') === 'plugin'");
    expect(scheduledTeachers).toContain("timetableFetch('/api/timetable/scheduled-teachers/all')");
    const teacherScanner = readFileSync(path.resolve(__dirname, '../../../frontend/app/wattaman/teacher-scan/page.tsx'), 'utf8');
    expect(teacherScanner).toContain("useSearchParams().get('source') === 'plugin'");
    expect(teacherScanner).toContain("timetableFetch('/api/timetable/teacher-attendance/wattaman-scan'");
    const workspace = readFileSync(path.resolve(__dirname, '../../../frontend/app/admin/timetable/page.tsx'), 'utf8');
    expect(workspace).toContain('pluginTimetableFetch');
    expect(workspace).toContain("searchParams.get('source') === 'plugin'");
  });
});
