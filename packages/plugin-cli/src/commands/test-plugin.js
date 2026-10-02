'use strict';

const { run: check } = require('./check');

async function run(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: wattanam-plugin test <plugin-directory>\n');
    return;
  }
  return check(argv, { activate: true });
}

module.exports = { run };
