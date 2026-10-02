process.chdir(__dirname);
require('child_process').execSync(
  'node node_modules/@nestjs/cli/bin/nest.js build',
  { stdio: 'inherit', cwd: __dirname }
);
