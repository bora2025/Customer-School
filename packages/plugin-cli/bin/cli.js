#!/usr/bin/env node
'use strict';

const commands = {
  init: require('../src/commands/init'),
  validate: require('../src/commands/validate'),
  test: require('../src/commands/test-plugin'),
  check: require('../src/commands/check'),
  keygen: require('../src/commands/keygen'),
  pack: require('../src/commands/pack'),
  inspect: require('../src/commands/inspect'),
  publish: require('../src/commands/publish'),
};

const [, , name, ...rest] = process.argv;
const command = commands[name];
if (!command) {
  process.stdout.write(`wattanam-plugin -- Wattanam V2 plugin developer tooling\n\nCommands:\n  init <publisher>.<name>   Scaffold a new plugin project\n  validate <dir>            Validate manifest, files and migration checksums\n  test <dir>                Run validation and the SDK activation harness\n  check <dir>               Compatibility alias for test\n  keygen <dir>              Generate an Ed25519 signing keypair\n  pack --source ...         Package and sign a .wtp\n  inspect <plugin.wtp>      Inspect metadata and verify payload checksums\n  publish --package ...     Submit a signed .wtp to an official repository\n\nRun any command with --help for its exact usage.\n`);
  process.exit(name ? 1 : 0);
}

Promise.resolve(command.run(rest)).catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
