'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const academic = require('../../plugins/wattanam.academic-management/backend/index.js');
const designer = require('../../plugins/wattanam.document-designer/backend/index.js');

async function activate(plugin, context) {
  const routes = [];
  await plugin.activate({
    logger: { log: () => undefined }, permissions: { register: () => undefined }, navigation: { register: () => undefined },
    routes: { register: (route) => routes.push(route) }, events: { publish: () => undefined, subscribe: () => undefined },
    ...context,
  });
  return (method, path) => routes.find((route) => route.method === method && route.path === path);
}

test('originating Academic scope limits rows before Document Designer renders them', async () => {
  const academicSql = [];
  const academicRoute = await activate(academic, {
    database: {
      query: async (sql) => {
        academicSql.push(sql);
        if (sql.includes('SELECT "teacherId", "classAdminId"')) return [{ teacherId: 'teacher-1', classAdminId: 'class-admin-1' }];
        if (sql.includes('SELECT "id", "name", "subject", "studyYearId"')) return [{ id: 'class-1', name: 'Class A', subject: 'Math', studyYearId: 'year-1' }];
        if (sql.includes('LIMIT 500')) return [{ id: 'student-1', userId: 'user-1', studentNumber: 'S001', nameKh: 'សិស្ស', qrCode: 'QR-1', photo: null, sex: 'F', dateOfBirth: '2015-01-01', generation: '2026' }];
        return [];
      }, execute: async () => ({ count: 0 }),
    },
    directory: {
      resolveAudience: async () => [], lookupClasses: async () => [], classesForUser: async () => [],
      lookupUsers: async (ids) => ids.map((id) => ({ id, name: id === 'user-1' ? 'Student One' : id, email: null, phone: null, role: id.startsWith('teacher') ? 'TEACHER' : 'STUDENT' })),
    },
    readModels: { read: async () => [], publish: async () => undefined },
    notifications: { notifyInApp: async () => undefined, sendEmail: async () => undefined },
    crypto: { hashBcrypt: async (value) => value },
  });
  const source = academicRoute('GET', 'classes/:id/document-records');
  await assert.rejects(() => source.handler({ params: { id: 'class-1' }, principal: { userId: 'teacher-2', role: 'TEACHER' } }), /not assigned/);
  const authorized = await source.handler({ params: { id: 'class-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });

  const designerSql = [];
  const generateRoute = await activate(designer, {
    database: {
      query: async (sql) => { designerSql.push(sql); return [{ id: 'template-1', name: 'Student card', documentType: 'student', design: { page: { width: 400, height: 240 }, elements: [{ id: 'name', type: 'text', x: 10, y: 10, width: 300, height: 40, binding: 'name' }] }, updatedAt: '2026-09-25T00:00:00.000Z' }]; },
      execute: async () => ({ count: 0 }),
    },
    storage: { list: async () => [], readText: async () => null, readBinary: async () => null, writeText: async () => undefined, writeBinary: async () => undefined, delete: async () => undefined },
  });
  const generated = await generateRoute('POST', 'templates/:id/generate').handler({ params: { id: 'template-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' }, body: { records: authorized.records } });

  assert.equal(generated.documents.length, 1);
  assert.equal(generated.documents[0].elements[0].value, 'Student One');
  assert.equal(designerSql.length, 1);
  assert.match(designerSql[0], /plugin_wattanam_document_designer_template/);
  assert.equal(designerSql.some((sql) => /academic|student_profile|enrollment/i.test(sql)), false);
  assert.equal(academicSql.some((sql) => /LIMIT 500/.test(sql)), true);
});
