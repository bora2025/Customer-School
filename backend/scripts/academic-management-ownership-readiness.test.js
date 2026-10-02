'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OWNER_VARIABLES,
  SHADOW_WRITE_VARIABLES,
  inspectOwnership,
} = require('./academic-management-ownership-readiness');

function environment(owner, shadowWrite = 'false') {
  return {
    ...Object.fromEntries(OWNER_VARIABLES.map((name) => [name, owner])),
    ...Object.fromEntries(SHADOW_WRITE_VARIABLES.map((name) => [name, shadowWrite])),
  };
}

test('accepts a complete plugin ownership configuration with shadow writes disabled', () => {
  const report = inspectOwnership(environment('plugin'));
  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
});

test('fails closed when one boundary remains legacy or a shadow writer remains enabled', () => {
  const env = environment('plugin');
  env.ACADEMIC_ROSTER_READ_OWNER = 'legacy';
  env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = 'true';
  const report = inspectOwnership(env);
  assert.equal(report.ready, false);
  assert.match(report.blockers.join('\n'), /ACADEMIC_ROSTER_READ_OWNER is legacy/);
  assert.match(report.blockers.join('\n'), /prevent duplicate writes/);
});

test('supports the pre-cutover legacy checkpoint and rejects invalid values', () => {
  assert.equal(inspectOwnership(environment('legacy'), 'legacy').ready, true);
  const env = environment('legacy');
  env.ACADEMIC_CLASSES_ROUTE_OWNER = 'automatic';
  env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'sometimes';
  const report = inspectOwnership(env, 'legacy');
  assert.equal(report.ready, false);
  assert.match(report.blockers.join('\n'), /invalid owner automatic/);
  assert.match(report.blockers.join('\n'), /must be true or false/);
  assert.throws(() => inspectOwnership({}, 'automatic'), /legacy or plugin/);
});

test('documents every runtime Academic Management ownership boundary', () => {
  assert.deepEqual(OWNER_VARIABLES, [
    'ACADEMIC_DEPARTMENTS_ROUTE_OWNER',
    'ACADEMIC_CLASSES_ROUTE_OWNER',
    'ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER',
    'ACADEMIC_ROSTER_READ_OWNER',
    'ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER',
    'ACADEMIC_STUDENT_PROFILES_READ_OWNER',
    'ACADEMIC_STUDENT_PROFILE_WRITE_OWNER',
    'ACADEMIC_DEPARTMENT_WRITE_OWNER',
    'ACADEMIC_IDENTITY_DETACH_OWNER',
  ]);
});
