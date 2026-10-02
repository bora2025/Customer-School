'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DATASETS, inspect, normalizeTarget } = require('./human-resources-adoption-preflight');

test('target normalization canonicalizes PostgreSQL date values', () => {
  const row = normalizeTarget('attendance', { id: 'a1', date: new Date('2026-01-01T00:00:00Z'), checkInTime: new Date('2026-01-01T08:00:00Z'), createdAt: new Date('2026-01-01T08:00:00Z'), updatedAt: new Date('2026-01-01T08:00:00Z') });
  assert.equal(row.date, '2026-01-01');
  assert.equal(row.checkInTime, '2026-01-01T08:00:00.000Z');
});

function fixture(overrides = {}) {
  const rows = {
    profiles: [{ id: 'p1', userId: 'u1', title: 'Teacher', summary: 'private', skills: ['English'], updatedAt: '2026-01-01' }],
    education: [{ id: 'e1', userId: 'u1', institution: 'School', degree: null, fieldOfStudy: null, startYear: 2020, endYear: 2024, order: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    experience: [{ id: 'x1', userId: 'u1', title: 'Teacher', employer: 'School', startDate: '2024-01-01', endDate: null, description: 'private', order: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    certifications: [{ id: 'c1', userId: 'u1', name: 'Certificate', issuer: null, issueDate: '2025-01-01', order: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    salaries: [{ id: 's1', userId: 'u1', month: 1, year: 2026, baseSalary: 100, allowances: 10, deductions: 5, netSalary: 105, isPaid: false, paidAt: null, notes: 'private', createdById: 'u2', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    attendance: [{ id: 'a1', userId: 'u1', date: '2026-01-01', session: 1, status: 'PRESENT', markedById: 'u2', scanLocation: 'private', timestamp: '2026-01-01' }],
    ...overrides,
  };
  return { readSourceChunk: async (name, { after, limit }) => { const list = rows[name]; const start = after ? list.findIndex((row) => row.id === after) + 1 : 0; return list.slice(start, start + limit); }, targetState: async (table) => ({ table, exists: true, rowCount: 0 }) };
}

test('HR preflight inventories six datasets with exact payroll and no PII', async () => {
  const report = await inspect(fixture(), { currency: 'USD' });
  assert.equal(report.ready, true); assert.equal(Object.keys(report.source.datasets).length, DATASETS.length);
  const text = JSON.stringify(report); assert.doesNotMatch(text, /private|Teacher|School|English/);
});

test('HR preflight blocks monetary rounding and net mismatch', async () => {
  const adapter = fixture({ salaries: [{ id: 's1', userId: 'u1', month: 1, year: 2026, baseSalary: 100.001, allowances: 10, deductions: 5, netSalary: 999, isPaid: false, createdById: 'u2', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] });
  const report = await inspect(adapter, { currency: 'USD' });
  assert.equal(report.ready, false); assert.match(report.blockers.join('\n'), /requires rounding|does not reconcile/);
});

test('HR preflight blocks paid rows without timestamp and nonempty targets', async () => {
  const adapter = fixture({ salaries: [{ id: 's1', userId: 'u1', month: 1, year: 2026, baseSalary: 100, allowances: 0, deductions: 0, netSalary: 100, isPaid: true, paidAt: null, createdById: 'u2', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] });
  adapter.targetState = async (table) => ({ table, exists: true, rowCount: table.endsWith('_salary') ? 1 : 0 });
  const report = await inspect(adapter, { currency: 'USD' });
  assert.equal(report.ready, false); assert.match(report.blockers.join('\n'), /paidAt|target table is not empty/);
});

test('HR preflight is deterministic', async () => {
  const first = await inspect(fixture(), { currency: 'USD', batchSize: 1 });
  const second = await inspect(fixture(), { currency: 'USD', batchSize: 10 });
  assert.equal(first.source.sha256, second.source.sha256);
});

