const { spawnSync } = require('node:child_process');
const path = require('node:path');

function migrationSchemaForDistribution(value) {
  const distribution = (value || 'legacy-full').trim().toLowerCase();
  if (distribution === 'core') return 'prisma/core/schema.prisma';
  if (distribution === 'legacy-full') return 'prisma/schema.prisma';
  throw new Error(`WATTANAM_DISTRIBUTION must be core or legacy-full (got "${distribution}")`);
}

function deployMigrations(env = process.env) {
  const schema = migrationSchemaForDistribution(env.WATTANAM_DISTRIBUTION);
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', `--schema=${schema}`], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status;
}

if (require.main === module) {
  try {
    deployMigrations();
  } catch (error) {
    console.error(`Migration deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { deployMigrations, migrationSchemaForDistribution };
