'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePlaywrightResult } = require('./run-plugin-ui-e2e');

test('reads a passed reporter sentinel', () => {
  assert.equal(parsePlaywrightResult('noise\nWATTANAM_PLAYWRIGHT_RESULT=passed\n'), 'passed');
});

test('reads every non-passing terminal status', () => {
  for (const status of ['failed', 'timedout', 'interrupted']) {
    assert.equal(parsePlaywrightResult(`WATTANAM_PLAYWRIGHT_RESULT=${status}`), status);
  }
});

test('uses the last result and ignores human-readable Playwright output', () => {
  const output = [
    '4 passed (12.3s)',
    'WATTANAM_PLAYWRIGHT_RESULT=failed',
    'WATTANAM_PLAYWRIGHT_RESULT=passed',
  ].join('\n');
  assert.equal(parsePlaywrightResult(output), 'passed');
  assert.equal(parsePlaywrightResult('4 passed (12.3s)'), null);
});
