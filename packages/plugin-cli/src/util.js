'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function flagValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Throws (rather than calling process.exit itself) so every command stays a plain, testable function; bin/cli.js turns a thrown error into a process exit code. */
function fail(message) {
  throw new Error(message);
}

/** Recursively copies `templateDir` into `destDir`, replacing `{{key}}` in both file contents and file/directory names. */
function renderTemplate(templateDir, destDir, variables) {
  const substitute = (text) => Object.entries(variables).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(value), text);
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const targetName = substitute(entry.name);
      const fromPath = path.join(from, entry.name);
      const toPath = path.join(to, targetName);
      if (entry.isDirectory()) walk(fromPath, toPath);
      else fs.writeFileSync(toPath, substitute(fs.readFileSync(fromPath, 'utf8')));
    }
  };
  walk(templateDir, destDir);
}

/** Recursively reads every file under `dir` (excluding .wtp/checksums.json/signature.json), relative-path -> Buffer. */
function readPluginFiles(dir) {
  const files = new Map();
  const walk = (from, prefix) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const absolute = path.join(from, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (!['checksums.json', 'signature.json'].includes(relative) && !relative.endsWith('.wtp')) {
        files.set(relative, fs.readFileSync(absolute));
      }
    }
  };
  walk(dir, '');
  return files;
}

module.exports = { sha256, flagValue, fail, renderTemplate, readPluginFiles };
