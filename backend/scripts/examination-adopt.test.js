'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DATASETS, inspect, normalize } = require('./examination-adoption-preflight');
const { adopt, dryRun, journalPath, parseConfirmation } = require('./examination-adopt');
const { drill, parseInput, routingRegistry } = require('./examination-rollback-drill');

const backupName = 'wattanam-20260925T030000Z.dump'; const now = '2026-09-25T00:00:00.000Z';
function sources() { return {
  scoreSheets: [{ id: 'ss1', name: 'Gradebook', createdAt: now, updatedAt: now }],
  scoreSheetClasses: [{ id: 'sc1', scoreSheetId: 'ss1', classId: 'class1', createdAt: now }],
  scoreSubjects: [{ id: 'sub1', scoreSheetId: 'ss1', name: 'Math', maxScore: 100, color: '#000', order: 0, createdAt: now, updatedAt: now }],
  scoreTabs: [{ id: 'tab1', scoreSheetId: 'ss1', label: 'Semester 1', type: 'SEMESTER', order: 0, createdAt: now, updatedAt: now }],
  scoreEntries: [{ id: 'se1', examTabId: 'tab1', subjectId: 'sub1', studentId: 'student1', score: 90, createdAt: now, updatedAt: now }],
  exams: [{ id: 'e1', title: 'Final', createdById: 'teacher1', duration: 60, totalMarks: 100, passMark: 50, maxAttempts: 1, status: 'DRAFT', createdAt: now, updatedAt: now }],
  questions: [{ id: 'q1', examId: 'e1', text: 'Question', type: 'MCQ', data: { choices: [{ id: 'a', isCorrect: true }] }, marks: 1, order: 0, createdAt: now }],
  attempts: [{ id: 'a1', examId: 'e1', studentId: 'student1', student: { userId: 'user1' }, answers: { q1: 'a' }, status: 'GRADED', attemptNumber: 1, startedAt: now, createdAt: now, updatedAt: now }],
}; }
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-examination-adopt-'));
  const archive = path.join(directory, backupName); fs.writeFileSync(archive, 'examination backup');
  const backupSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(archive.replace('.dump', '.manifest.json'), JSON.stringify({ format: 'pg_dump-custom-v1', file: backupName, installationSlug: 'bora-school', sizeBytes: fs.statSync(archive).size, sha256: backupSha256 }));
  const source = sources(); const target = Object.fromEntries(DATASETS.map(({ name }) => [name, new Map()])); let writes = 0; let crash = false;
  const chunk = (rows, after, limit) => rows.filter((row) => after === null || row.id > after).slice(0, limit);
  const adapter = { readSourceChunk: async (name, { after, limit }) => chunk(source[name], after, limit), readTargetChunk: async (name, { after, limit }) => chunk([...target[name].values()].sort((a,b) => a.id.localeCompare(b.id)), after, limit), targetState: async (table) => { const dataset = DATASETS.find((item) => item.target === table); return { table, exists: true, rowCount: target[dataset.name].size }; }, writeTargetChunk: async (name, rows) => { rows.forEach((row) => target[name].set(row.id, { ...row })); writes += 1; if (crash && writes === 3) throw new Error('simulated Examination crash'); } };
  return { directory, source, target, adapter, get writes() { return writes; }, crash(value) { crash = value; }, close() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('guarded Examination dry-run is zero-write', async () => { const f = fixture(); try { const pre = await inspect(f.adapter); assert.throws(() => parseConfirmation({ EXAMINATION_ADOPTION_NON_INTERACTIVE:'true', EXAMINATION_SCHOOL_SLUG:'bora-school', EXAMINATION_CONFIRM_SLUG:'wrong', EXAMINATION_SOURCE_SHA256:pre.source.sha256 }), /exactly match/); const result = await dryRun({ adapter:f.adapter, directory:f.directory, backupName, confirmation:{ slug:'bora-school', sourceSha256:pre.source.sha256 } }); assert.equal(result.ready, true); assert.equal(result.zeroWriteGuarantee, true); assert.equal(f.writes, 0); } finally { f.close(); } });
test('Examination adoption resumes a crash and reconciles all eight datasets', async () => { const f = fixture(); try { const pre = await inspect(f.adapter); const confirmation = { slug:'bora-school', sourceSha256:pre.source.sha256 }; f.crash(true); await assert.rejects(adopt({ adapter:f.adapter, directory:f.directory, backupName, confirmation, chunkSize:1 }), /simulated Examination crash/); f.crash(false); const result = await adopt({ adapter:f.adapter, directory:f.directory, backupName, confirmation, chunkSize:1 }); assert.equal(result.stage, 'reconciled'); assert.equal(result.source.sha256, result.target.sha256); for (const { name } of DATASETS) assert.deepEqual(f.target[name].get(f.source[name][0].id), normalize(name, f.source[name][0])); } finally { f.close(); } });
test('Examination rollback is guarded and preserves both reconciled datasets', async () => { const f = fixture(); try { assert.throws(() => parseInput({ EXAMINATION_SCHOOL_SLUG:'bora-school' }), /ROLLBACK_DRILL=true/); assert.throws(() => routingRegistry('auto'), /legacy or plugin/); const pre = await inspect(f.adapter); await adopt({ adapter:f.adapter, directory:f.directory, backupName, confirmation:{ slug:'bora-school', sourceSha256:pre.source.sha256 } }); const registry = { routeOwner:'plugin', pluginEnabled:true }; const result = await drill({ adapter:f.adapter, directory:f.directory, backupName, slug:'bora-school', registry }); assert.equal(result.rolledBack, true); assert.deepEqual(registry, { routeOwner:'legacy', pluginEnabled:false }); assert.equal(f.source.exams.length, 1); assert.equal(f.target.exams.size, 1); assert.equal(JSON.parse(fs.readFileSync(journalPath(f.directory, 'bora-school'), 'utf8')).stage, 'rolled_back'); } finally { f.close(); } });
