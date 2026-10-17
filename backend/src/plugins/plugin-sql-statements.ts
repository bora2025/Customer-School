/** Counts top-level SQL statements without treating semicolons inside strings,
 * comments, quoted identifiers, or PostgreSQL dollar-quoted function bodies as separators. */
export function countTopLevelSqlStatements(sql: string): number {
  let count = 0;
  let hasContent = false;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const pair = sql.slice(index, index + 2);
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (pair === '*/') { blockComment = false; index += 1; }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) { index += dollarTag.length - 1; dollarTag = null; }
      continue;
    }
    if (!singleQuoted && !doubleQuoted && pair === '--') { lineComment = true; index += 1; continue; }
    if (!singleQuoted && !doubleQuoted && pair === '/*') { blockComment = true; index += 1; continue; }
    if (!doubleQuoted && char === "'") {
      hasContent = true;
      if (singleQuoted && sql[index + 1] === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (!singleQuoted && char === '"') {
      hasContent = true;
      if (doubleQuoted && sql[index + 1] === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) { dollarTag = match[0]; hasContent = true; index += dollarTag.length - 1; continue; }
    }
    if (!singleQuoted && !doubleQuoted && char === ';') {
      if (hasContent) count += 1;
      hasContent = false;
      continue;
    }
    if (!/\s/.test(char)) hasContent = true;
  }
  if (hasContent) count += 1;
  return count;
}
