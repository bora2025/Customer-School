import { assertNoForbiddenSql, assertPluginNamespace } from './plugin-sql-guard';

describe('plugin-sql-guard', () => {
  it('allows SQL that only touches the plugin namespace', () => {
    expect(() => assertPluginNamespace('wattanam.test', 'SELECT * FROM plugin_wattanam_test_notes', 'x')).not.toThrow();
    expect(() => assertNoForbiddenSql('SELECT * FROM plugin_wattanam_test_notes', 'x')).not.toThrow();
  });

  it('does not mistake PostgreSQL upsert UPDATE SET syntax for a table reference', () => {
    expect(() => assertPluginNamespace(
      'wattanam.test',
      'INSERT INTO plugin_wattanam_test_notes (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value',
      'x',
    )).not.toThrow();
  });

  it('distinguishes PL/pgSQL variables and trigger events from table references', () => {
    const functionSql = `CREATE FUNCTION plugin_wattanam_test_apply() RETURNS trigger AS $$
DECLARE
  approved_days INTEGER;
BEGIN
  SELECT COUNT(*) INTO approved_days
  FROM plugin_wattanam_test_permissions
  WHERE employee_id = NEW.employee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
    expect(() => assertPluginNamespace('wattanam.test', functionSql, 'x')).not.toThrow();

    const triggerSql = `CREATE TRIGGER plugin_wattanam_test_apply_trigger
BEFORE INSERT OR UPDATE ON plugin_wattanam_test_payroll
FOR EACH ROW EXECUTE FUNCTION plugin_wattanam_test_apply();`;
    expect(() => assertPluginNamespace('wattanam.test', triggerSql, 'x')).not.toThrow();
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

  it('allows PL/pgSQL function block BEGIN without weakening forbidden-operation checks', () => {
    const safeFunction = `CREATE FUNCTION plugin_wattanam_test_apply() RETURNS trigger AS $$
BEGIN
  NEW.value := 'ready';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
    expect(() => assertNoForbiddenSql(safeFunction, 'x')).not.toThrow();

    const unsafeFunction = `CREATE FUNCTION plugin_wattanam_test_apply() RETURNS trigger AS $body$
BEGIN
  GRANT ALL ON plugin_wattanam_test_notes TO public;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;`;
    expect(() => assertNoForbiddenSql(unsafeFunction, 'x')).toThrow('forbidden');
  });

  it('ignores forbidden-operation words in comments but still scans following SQL', () => {
    expect(() => assertNoForbiddenSql('-- preserve rows for rollback\nALTER TABLE plugin_wattanam_test_notes ADD COLUMN value TEXT', 'x')).not.toThrow();
    expect(() => assertNoForbiddenSql('/* rollback documentation */\nGRANT ALL ON plugin_wattanam_test_notes TO public', 'x')).toThrow('forbidden');
  });
});
