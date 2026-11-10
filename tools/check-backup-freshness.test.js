const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate } = require('./check-backup-freshness');

const metrics = ({ configured = 1, age = 3 * 3600, drillConfigured = 1, drillAge = 2 * 86400 } = {}) => [
  '# HELP offsite_backup_configured x',
  `offsite_backup_configured ${configured}`,
  `offsite_backup_age_seconds ${age}`,
  drillConfigured === null ? '' : `recovery_drill_configured ${drillConfigured}`,
  drillAge === null ? '' : `recovery_drill_success_age_seconds ${drillAge}`,
].join('\n');

test('passes for a fresh off-site backup and a recent restore drill', () => {
  const result = evaluate(metrics());
  assert.equal(result.ok, true);
  assert.match(result.reason, /restore drill passed 2\.0 days ago/);
});

test('fails when the newest backup is older than the limit', () => {
  const result = evaluate(metrics({ age: 27 * 3600 }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /27\.0h old/);
});

test('fails when no off-site backup exists yet (+Inf)', () => {
  assert.match(evaluate(metrics({ age: '+Inf' })).reason, /no complete off-site backup/);
});

test('fails when off-site backup is not configured', () => {
  assert.match(evaluate(metrics({ configured: 0, age: '+Inf' })).reason, /not configured/);
});

test('fails when no restore drill has passed, or the last pass is too old', () => {
  assert.match(evaluate(metrics({ drillAge: '+Inf' })).reason, /no restore drill has passed yet/);
  assert.match(evaluate(metrics({ drillAge: 36 * 86400 })).reason, /36\.0 days ago \(limit 35\)/);
  assert.match(evaluate(metrics({ drillConfigured: 0 })).reason, /restore drill is not configured/);
});

test('fails clearly on a release without the metrics', () => {
  assert.match(evaluate('backup_count 3\n').reason, /missing/);
  assert.match(evaluate(metrics({ drillConfigured: null, drillAge: null })).reason, /restore-drill metrics are missing/);
});
