import { readFileSync } from 'fs';
import path from 'path';
import { PluginMigrationsService } from './plugin-migrations.service';
import { parsePluginUiBundle } from './plugin-ui-schema';

const root = path.resolve(__dirname, '../../../plugins/wattanam.examination');

describe('Examination plugin source', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));

  it('declares the complete namespaced examination and gradebook data foundation', () => {
    expect(manifest.version).toBe('0.1.7');
    expect(manifest.dependencies['wattanam.academic-management']).toBeDefined();
    expect(manifest.permissions).toHaveLength(6);
    expect(manifest.capabilities).toContain('readmodels.publish');
    expect(manifest.migrations).toHaveLength(10);
    const sql = manifest.migrations.map((migration: { path: string }) => readFileSync(path.join(root, migration.path), 'utf8')).join('\n');
    for (const table of ['exam', 'question', 'attempt', 'score_sheet', 'score_sheet_class', 'score_subject', 'score_tab', 'score_entry']) {
      expect(sql).toContain(`plugin_wattanam_examination_${table}`);
    }
    expect(sql).not.toMatch(/REFERENCES\s+(?:"?(?:User|Student|Class|StudyYear|Subject)"?)/i);
    const migrations = new PluginMigrationsService();
    for (const migration of manifest.migrations) {
      const statement = readFileSync(path.join(root, migration.path), 'utf8');
      expect(() => migrations.validateSql(manifest, migration.id, statement, false)).not.toThrow();
    }
  });

  it('provides permission-gated declarative discovery pages and matching runtime routes', () => {
    const descriptor = JSON.parse(readFileSync(path.join(root, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));
    expect(bundle.pages.map((page) => page.routePath)).toEqual(['exams', 'gradebooks', 'gradebooks/:id/report']);
    expect(bundle.pages[2].components.some((component) => component.type === 'print')).toBe(true);
    const backend = readFileSync(path.join(root, 'backend/index.js'), 'utf8');
    expect(backend).toContain("path: 'exams'");
    const attempts = readFileSync(path.join(root, 'backend/attempts.js'), 'utf8');
    expect(attempts).toContain("path: 'exams/:id/take'");
    expect(attempts).toContain("path: 'attempts/:id/submit'");
    expect(attempts).toContain("path: 'attempts/:id/grade'");
    expect(attempts).toContain("path: 'attempts/:id/reset'");
    expect(attempts).toContain('pg_advisory_xact_lock');
    expect(attempts).toContain('questions: questions.map(safeQuestion)');
    const gradebooks = readFileSync(path.join(root, 'backend/gradebooks.js'), 'utf8');
    expect(gradebooks).toContain("path: 'gradebooks'");
    expect(gradebooks).toContain("path: 'gradebooks/:id/scores/bulk'");
    expect(gradebooks).toContain("path: 'gradebook-subjects/:id'");
    expect(gradebooks).toContain("path: 'gradebook-tabs/:id'");
    expect(gradebooks).toContain("path: 'gradebooks/:id/report'");
    expect(gradebooks).toContain('getClassRoster');
    expect(gradebooks).toContain('ON CONFLICT');
    const projection = readFileSync(path.join(root, 'backend/student-grade-summary.js'), 'utf8');
    expect(projection).toContain("publish('student-grade-summary', 1, studentId");
    expect(projection).not.toMatch(/answers|question|formula|feedback|manualMarks/);
  });
});
