const assert = require('node:assert/strict');
const test = require('node:test');
const { classify } = require('./audit-core-dependencies');

const report = {
  vulnerabilities: {
    zod: { severity: 'high', nodes: ['node_modules/@imgly/background-removal/node_modules/zod'] },
    next: { severity: 'critical', nodes: ['node_modules/next'] },
    glob: { severity: 'moderate', nodes: ['node_modules/glob'] },
  },
};

test('blocks high/critical advisories only for packages shipped in the core image', () => {
  const shippedSet = new Set(['node_modules/next', 'node_modules/glob']);
  const { shipped, legacyOnly } = classify(report, (node) => shippedSet.has(node));
  assert.deepEqual(shipped.map((item) => item.name), ['next']);
  assert.deepEqual(legacyOnly.map((item) => item.name), ['zod']);
});

test('ignores moderate advisories even when shipped', () => {
  const { shipped } = classify(report, () => true);
  assert.deepEqual(shipped.map((item) => item.name).sort(), ['next', 'zod']);
});

test('nothing blocks when no vulnerable package ships', () => {
  const { shipped, legacyOnly } = classify(report, () => false);
  assert.equal(shipped.length, 0);
  assert.equal(legacyOnly.length, 2);
});
