'use strict';

const OWNER_VARIABLES = Object.freeze([
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

const SHADOW_WRITE_VARIABLES = Object.freeze([
  'ACADEMIC_DEPARTMENT_SHADOW_WRITE',
  'ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE',
]);

function normalizedOwner(value) {
  return String(value ?? 'legacy').trim().toLowerCase();
}

function normalizedBoolean(value) {
  return String(value ?? 'false').trim().toLowerCase();
}

function inspectOwnership(env = process.env, expectedOwner = 'plugin') {
  if (!['legacy', 'plugin'].includes(expectedOwner)) {
    throw new Error('expectedOwner must be legacy or plugin');
  }

  const owners = Object.fromEntries(OWNER_VARIABLES.map((name) => [name, normalizedOwner(env[name])]));
  const shadowWrites = Object.fromEntries(SHADOW_WRITE_VARIABLES.map((name) => [name, normalizedBoolean(env[name])]));
  const blockers = [];

  for (const [name, value] of Object.entries(owners)) {
    if (!['legacy', 'plugin'].includes(value)) blockers.push(`${name} has invalid owner ${value}`);
    else if (value !== expectedOwner) blockers.push(`${name} is ${value}; expected ${expectedOwner}`);
  }
  for (const [name, value] of Object.entries(shadowWrites)) {
    if (!['true', 'false'].includes(value)) blockers.push(`${name} must be true or false`);
    if (expectedOwner === 'plugin' && value !== 'false') {
      blockers.push(`${name} must be false after plugin ownership to prevent duplicate writes`);
    }
  }

  return {
    format: 'wattanam-academic-management-ownership-readiness-v1',
    readOnly: true,
    expectedOwner,
    ready: blockers.length === 0,
    blockers,
    owners,
    shadowWrites,
  };
}

function main() {
  const expectedOwner = String(process.env.ACADEMIC_EXPECTED_OWNER ?? 'plugin').trim().toLowerCase();
  const report = inspectOwnership(process.env, expectedOwner);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { OWNER_VARIABLES, SHADOW_WRITE_VARIABLES, inspectOwnership };
