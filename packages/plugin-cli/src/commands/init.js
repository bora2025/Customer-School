'use strict';

const fs = require('fs');
const path = require('path');
const { fail, renderTemplate, sha256 } = require('../util');

function run(argv) {
  const id = argv[0];
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin init <publisher>.<name> [--dir <output-directory>]\n');
    return;
  }
  if (!id) fail('Missing required <publisher>.<name> argument; use --help');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) {
    fail('id must be lowercase, dot/dash notation, namespaced as <publisher>.<name> (e.g. acme.widget)');
  }
  const dotIndex = id.indexOf('.');
  const publisher = id.slice(0, dotIndex);
  const name = id.slice(dotIndex + 1);
  const sqlName = name.replace(/[^a-z0-9]/g, '_');
  const dirFlag = argv.indexOf('--dir');
  const destination = path.resolve(dirFlag >= 0 ? argv[dirFlag + 1] : id);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) fail(`${destination} already exists and is not empty`);

  const displayName = name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  renderTemplate(path.join(__dirname, '..', '..', 'templates', 'default'), destination, { publisher, name, sqlName, displayName });
  const migration = path.join(destination, 'migrations', '001_create_widget.sql');
  const manifestPath = path.join(destination, 'plugin.json');
  fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8').replace('{{migrationChecksum}}', sha256(fs.readFileSync(migration))));
  process.stdout.write(`Scaffolded ${id} at ${destination}\nNext: wattanam-plugin check ${destination}\n`);
}

module.exports = { run };
