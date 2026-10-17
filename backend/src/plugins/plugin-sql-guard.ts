import { BadRequestException } from '@nestjs/common';

/**
 * Shared by install-time migration validation (plugin-migrations.service.ts)
 * and live runtime queries (plugin-runtime.service.ts's database capability)
 * so both enforce the exact same "a plugin may only touch its own
 * plugin_<id>_ tables, never transaction/role/grant control" rule from one
 * place.
 */
export function assertNoForbiddenSql(sql: string, label: string) {
  // Comments are documentation, not executable SQL. Ignoring them prevents words such as
  // "rollback" in a migration rationale from becoming false positives while the executable
  // statement immediately following the comment is still inspected.
  let executableSql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');

  // A PL/pgSQL function body uses BEGIN as a block delimiter, not as transaction
  // control. Keep scanning every other token inside the body (GRANT, COPY, etc.)
  // and suppress only those BEGIN tokens when the outer statement is a function.
  if (/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(executableSql)) {
    executableSql = executableSql.replace(/(\$[a-zA-Z0-9_]*\$)([\s\S]*?)\1/g, (_match, delimiter: string, body: string) => (
      `${delimiter}${body.replace(/\bBEGIN\b/gi, ' ')}${delimiter}`
    ));
  }

  if (/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|CREATE\s+(?:ROLE|USER|EXTENSION)|ALTER\s+(?:ROLE|USER|SYSTEM)|COPY\b|PROGRAM\b|DO\s*\$|SET\s+ROLE|GRANT\b|REVOKE\b)\b/i.test(executableSql)) {
    throw new BadRequestException(`${label} contains a forbidden database operation`);
  }
}

export function assertPluginNamespace(pluginId: string, sql: string, label: string) {
  const namespace = `plugin_${pluginId.replace(/[^a-z0-9]/g, '_')}_`;
  // PostgreSQL upserts contain `ON CONFLICT ... DO UPDATE SET`. `UPDATE SET` is not a
  // table reference, but the deliberately small scanner below would otherwise treat `SET`
  // as the target table and reject every transactional upsert as cross-namespace SQL.
  const referenceSql = sql.replace(/\bDO\s+UPDATE\s+SET\b/gi, 'DO UPSERT SET');
  const tableReferences = [
    ...referenceSql.matchAll(/\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi),
    ...referenceSql.matchAll(/\bINSERT\s+INTO\s+"?([a-zA-Z0-9_]+)"?/gi),
    // In CREATE TRIGGER syntax, UPDATE is followed by ON rather than a target
    // table. Excluding ON prevents it from being mistaken for a table name.
    ...referenceSql.matchAll(/\bUPDATE\s+(?!ON\b)(?:ONLY\s+)?"?([a-zA-Z0-9_]+)"?/gi),
    ...referenceSql.matchAll(/\b(?:FROM|JOIN|REFERENCES)\s+"?([a-zA-Z0-9_]+)"?/gi),
    ...referenceSql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?[a-zA-Z0-9_]+"?\s+ON\s+"?([a-zA-Z0-9_]+)"?/gi),
    ...referenceSql.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?[a-zA-Z0-9_]+"?[\s\S]*?\bON\s+"?([a-zA-Z0-9_]+)"?/gi),
  ].map((match) => match[1].toLowerCase());
  if (!tableReferences.length || tableReferences.some((table) => !table.startsWith(namespace))) {
    throw new BadRequestException(`${label} may only access tables beginning with ${namespace}`);
  }
}
