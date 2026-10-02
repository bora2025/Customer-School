'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { buildDryRunPlan, parseInput, readJournal } = require('./legacy-adopt');

const valid = {
  ADOPT_NON_INTERACTIVE: 'true', ADOPT_SCHOOL_NAME: 'Legacy School', ADOPT_SCHOOL_SLUG: 'legacy-school',
  ADOPT_CONFIRM_SLUG: 'legacy-school', ADOPT_OWNER_EMAIL: 'OWNER@EXAMPLE.COM',
  ADOPT_APPROVED_SCHEMA_FINGERPRINT: 'a'.repeat(64), APP_VERSION: '1.0.0',
};

test('parses guarded adoption input with Cambodia defaults', () => {
  const input = parseInput(valid);
  assert.equal(input.ownerEmail, 'owner@example.com');
  assert.equal(input.timezone, 'Asia/Phnom_Penh');
  assert.equal(input.currency, 'KHR');
});

test('requires guard, exact slug, fingerprint, and valid timezone', () => {
  assert.throws(() => parseInput({ ...valid, ADOPT_NON_INTERACTIVE: 'false' }), /ADOPT_NON_INTERACTIVE/);
  assert.throws(() => parseInput({ ...valid, ADOPT_CONFIRM_SLUG: 'other' }), /exactly match/);
  assert.throws(() => parseInput({ ...valid, ADOPT_APPROVED_SCHEMA_FINGERPRINT: 'bad' }), /SHA-256/);
  assert.throws(() => parseInput({ ...valid, ADOPT_TIMEZONE: 'Invalid\/Zone' }), /IANA/);
});

test('journal verification binds school, fingerprint, archive, and checksum', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-adopt-'));
  try {
    const archive = path.join(directory, 'wattanam-20260828T000000Z.dump');
    fs.writeFileSync(archive, 'archive');
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update('archive').digest('hex');
    fs.writeFileSync(path.join(directory, 'wattanam-20260828T000000Z.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: 'wattanam-20260828T000000Z.dump', sha256: checksum }));
    const journalFile = path.join(directory, 'legacy-adoption-legacy-school.json');
    fs.writeFileSync(journalFile, JSON.stringify({ format: 'wattanam-legacy-adoption-v1', schoolSlug: 'legacy-school', sourceFingerprint: 'a'.repeat(64), backup: { file: 'wattanam-20260828T000000Z.dump', sha256: checksum } }));
    assert.equal(readJournal(journalFile, parseInput(valid)).backup.sha256, checksum);
    fs.writeFileSync(archive, 'tampered');
    assert.throws(() => readJournal(journalFile, parseInput(valid)), /checksum mismatch/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('journal rejects backup path traversal', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-adopt-'));
  try {
    const journalFile = path.join(directory, 'legacy-adoption-legacy-school.json');
    fs.writeFileSync(journalFile, JSON.stringify({ format: 'wattanam-legacy-adoption-v1', schoolSlug: 'legacy-school', sourceFingerprint: 'a'.repeat(64), backup: { file: '../escape.dump', sha256: 'a'.repeat(64) } }));
    assert.throws(() => readJournal(journalFile, parseInput(valid)), /invalid backup filename/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('dry-run plan previews every mutation and reconciliation without performing one', () => {
  const input = parseInput(valid);
  const report = {
    state: 'legacy_unadopted', schemaFingerprint: input.fingerprint, databaseVersion: '16.4',
    databaseBytes: 1000, tableCount: 68, columnCount: 400,
    adoptionReadiness: { ready: true, blockers: [] },
  };
  const plan = buildDryRunPlan(report, input, true);
  assert.equal(plan.ready, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.zeroWriteGuarantee, true);
  assert.equal(plan.reconciliationPreview.expectedSourceTableCount, 68);
  assert.deepEqual(plan.reconciliationPreview.checks, ['row_counts', 'foreign_key_orphans', 'content_hashes', 'credential_hash_format']);
  assert.equal(plan.plannedSteps.length, 5);
});

test('dry-run plan reports readiness and owner blockers', () => {
  const report = { state: 'unsupported_partial', adoptionReadiness: { ready: false, blockers: ['source mismatch'] } };
  const plan = buildDryRunPlan(report, parseInput(valid), false);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.blockers, ['source mismatch', 'ADOPT_OWNER_EMAIL must identify an existing SUPER_ADMIN']);
});
