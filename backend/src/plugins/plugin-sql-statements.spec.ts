import { countTopLevelSqlStatements } from './plugin-sql-statements';

describe('countTopLevelSqlStatements', () => {
  it('counts ordinary top-level statements', () => {
    expect(countTopLevelSqlStatements('CREATE TABLE plugin_x (id text); CREATE INDEX x ON plugin_x(id);')).toBe(2);
  });

  it('accepts semicolons inside a PostgreSQL function as one statement', () => {
    expect(countTopLevelSqlStatements(`CREATE FUNCTION plugin_x_fn() RETURNS trigger AS $$
      BEGIN
        NEW."value" := 1;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql;`)).toBe(1);
  });

  it('ignores semicolons in strings and comments', () => {
    expect(countTopLevelSqlStatements("-- header;\nINSERT INTO plugin_x (id) VALUES ('a;b');")).toBe(1);
  });
});
