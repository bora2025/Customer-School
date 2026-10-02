const test = require('node:test');
const assert = require('node:assert/strict');
const { migrationSchemaForDistribution } = require('./deploy-migrations');

test('core selects the isolated core migration lineage', () => {
  assert.equal(migrationSchemaForDistribution('core'), 'prisma/core/schema.prisma');
});

test('legacy-full and an unset distribution preserve the legacy lineage', () => {
  assert.equal(migrationSchemaForDistribution('legacy-full'), 'prisma/schema.prisma');
  assert.equal(migrationSchemaForDistribution(undefined), 'prisma/schema.prisma');
});

test('unknown distributions fail closed before Prisma is started', () => {
  assert.throws(() => migrationSchemaForDistribution('lean'), /must be core or legacy-full/);
});
