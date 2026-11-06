const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate } = require('./check-backup-freshness');

const metrics = (configured, age) => `# HELP offsite_backup_configured x\noffsite_backup_configured ${configured}\noffsite_backup_age_seconds ${age}\n`;

test('passes for a fresh off-site backup', () => {
  assert.equal(evaluate(metrics(1, 3 * 3600)).ok, true);
});

test('fails when the newest backup is older than the limit', () => {
  const result = evaluate(metrics(1, 27 * 3600));
  assert.equal(result.ok, false);
  assert.match(result.reason, /27\.0h old/);
});

test('fails when no off-site backup exists yet (+Inf)', () => {
  assert.match(evaluate(metrics(1, '+Inf')).reason, /no complete off-site backup/);
});

test('fails when off-site backup is not configured', () => {
  assert.match(evaluate(metrics(0, '+Inf')).reason, /not configured/);
});

test('fails clearly on a release without the metrics', () => {
  assert.match(evaluate('backup_count 3\n').reason, /missing/);
});
