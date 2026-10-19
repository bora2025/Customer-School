'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const roots = ['backend/src', 'backend/scripts', 'frontend', 'tools'];
const ignored = new Set(['node_modules', '.next', 'test-results', 'playwright-report', 'coverage', 'dist']);
const extensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const violations = [];
const rules = [
  {
    id: 'relative-official-plugin-source',
    pattern: /(?:\.\.[/\\])+(?:plugins)[/\\](?:announcements|wattanam\.[a-z0-9.-]+)/i,
  },
  {
    id: 'absolute-marketplace-plugin-source',
    pattern: /wattanam-v2[/\\]plugins[/\\](?:announcements|wattanam\.[a-z0-9.-]+)/i,
  },
  {
    id: 'implicit-sibling-catalog-fallback',
    pattern: /path\.resolve\([^\r\n]*['"]\.\.[/\\]plugins['"]/,
  },
];

function visit(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (!ignored.has(entry.name)) visit(path.join(target, entry.name));
    }
    return;
  }
  if (!extensions.has(path.extname(target))) return;
  const relative = path.relative(root, target).replaceAll('\\', '/');
  const contents = fs.readFileSync(target, 'utf8');
  for (const rule of rules) {
    if (rule.pattern.test(contents)) violations.push({ file: relative, rule: rule.id });
  }
}

for (const directory of roots) visit(path.join(root, directory));

if (violations.length) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', violations }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ status: 'passed', scannedRoots: roots }, null, 2)}\n`);
}
