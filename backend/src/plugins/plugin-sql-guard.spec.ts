import { assertNoForbiddenSql, assertPluginNamespace } from './plugin-sql-guard';

describe('plugin-sql-guard', () => {
  it('allows SQL that only touches the plugin namespace', () => {
    expect(() => assertPluginNamespace('wattanam.test', 'SELECT * FROM plugin_wattanam_test_notes', 'x')).not.toThrow();
    expect(() => assertNoForbiddenSql('SELECT * FROM plugin_wattanam_test_notes', 'x')).not.toThrow();
  });

  it('recognizes CREATE INDEX target tables as namespace references', () => {
    expect(() => assertPluginNamespace(
      'wattanam.test',
      'CREATE INDEX IF NOT EXISTS plugin_wattanam_test_notes_value_idx ON plugin_wattanam_test_notes (value)',
      'x',
    )).not.toThrow();
    expect(() => assertPluginNamespace(
      'wattanam.test',
      'CREATE UNIQUE INDEX plugin_wattanam_test_notes_slug_idx ON plugin_wattanam_test_notes (slug)',
      'x',
    )).not.toThrow();
    expect(() => assertPluginNamespace(
      'wattanam.test',
      'CREATE INDEX plugin_other_notes_value_idx ON plugin_other_notes (value)',
      'x',
    )).toThrow('only access tables beginning with plugin_wattanam_test_');
  });

  it('rejects a table reference outside the plugin namespace', () => {
    expect(() => assertPluginNamespace('wattanam.test', 'SELECT * FROM "User"', 'x')).toThrow('only access tables beginning with plugin_wattanam_test_');
    expect(() => assertPluginNamespace('wattanam.test', 'SELECT * FROM plugin_other_notes', 'x')).toThrow('only access');
  });

  it('rejects transaction control, role, and grant statements', () => {
    expect(() => assertNoForbiddenSql('BEGIN; SELECT 1', 'x')).toThrow('forbidden');
    expect(() => assertNoForbiddenSql('GRANT ALL ON plugin_wattanam_test_notes TO public', 'x')).toThrow('forbidden');
    expect(() => assertNoForbiddenSql('COPY plugin_wattanam_test_notes TO STDOUT', 'x')).toThrow('forbidden');
  });

  it('ignores forbidden-operation words in comments but still scans following SQL', () => {
    expect(() => assertNoForbiddenSql('-- preserve rows for rollback\nALTER TABLE plugin_wattanam_test_notes ADD COLUMN value TEXT', 'x')).not.toThrow();
    expect(() => assertNoForbiddenSql('/* rollback documentation */\nGRANT ALL ON plugin_wattanam_test_notes TO public', 'x')).toThrow('forbidden');
  });
});
