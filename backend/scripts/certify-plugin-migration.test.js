'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { certify, suites } = require('./certify-plugin-migration');

test('evidence generator runs every named suite and hashes results', () => {
  const calls = [];
  const report = certify({ cwd: process.cwd(), execute: (command, args) => { calls.push({ command, args }); return { status: 0, stdout: 'pass', stderr: '' }; } });
  assert.equal(report.passed, true);
  assert.deepEqual(report.suites.map((suite) => suite.id), ['adoption', 'lifecycle', 'recovery', 'security']);
  assert.equal(calls.length, suites.length);
  assert.match(report.reportSha256, /^[a-f0-9]{64}$/);
});

test('evidence generator fails closed when any suite fails', () => {
  let index = 0;
  const report = certify({ execute: () => ({ status: index++ === 2 ? 1 : 0, stdout: '', stderr: '' }) });
  assert.equal(report.passed, false);
  assert.equal(report.suites[2].passed, false);
});
