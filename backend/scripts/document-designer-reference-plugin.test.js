'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const reference = require('../../plugins/wattanam.document-designer/backend/index.js');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8'));
}

function buildContext(overrides = {}) {
  const routes = [];
  const context = {
    pluginId: 'wattanam.document-designer',
    logger: { log: () => undefined },
    permissions: { register: () => () => undefined },
    navigation: { register: () => () => undefined },
    routes: { register: (route) => { routes.push(route); return () => undefined; } },
    database: {
      query: async () => [],
      execute: async () => ({ count: 0 }),
    },
    storage: {
      list: async () => [], readText: async () => null, readBinary: async () => null,
      writeText: async () => undefined, writeBinary: async () => undefined, delete: async () => undefined,
    },
    directory: { lookupUsers: async (ids) => ids.map((id) => ({ id, name: `Staff ${id}`, role: 'TEACHER' })) },
    readModels: { read: async () => [] },
    ...overrides,
  };
  return { context, routes };
}

async function activate(overrides = {}) {
  const built = buildContext(overrides);
  await reference.activate(built.context);
  const byKey = new Map(built.routes.map((route) => [`${route.method}:${route.path}`, route]));
  return { context: built.context, byKey, routes: built.routes };
}

test('registers document designer permissions, navigation, and route set', async () => {
  const permissionCalls = [];
  const navigationCalls = [];
  const built = buildContext({
    permissions: { register: (definitions) => { permissionCalls.push(definitions); return () => undefined; } },
    navigation: { register: (entries) => { navigationCalls.push(entries); return () => undefined; } },
  });

  await reference.activate(built.context);

  const routeKeys = built.routes.map((route) => `${route.method}:${route.path}`);
  assert.deepEqual(routeKeys, [
    'GET:templates',
    'GET:templates/:id',
    'GET:active/:documentType',
    'PUT:active/:documentType',
    'POST:templates',
    'PATCH:templates/:id',
    'PATCH:templates/:id/active',
    'DELETE:templates/:id',
    'POST:sources/staff',
    'POST:templates/:id/generate',
    'POST:templates/:id/export-model',
    'GET:assets',
    'POST:assets',
    'GET:assets/:id',
    'DELETE:assets/:id',
  ]);
  assert.equal(permissionCalls.length, 1);
  assert.ok(permissionCalls[0].find((entry) => entry.id === 'wattanam.document-designer.view'));
  assert.ok(permissionCalls[0].find((entry) => entry.id === 'wattanam.document-designer.edit'));
  assert.equal(navigationCalls.length, 1);
  assert.equal(navigationCalls[0][0].href, '/plugins/wattanam.document-designer/templates');
  assert.deepEqual(reference.health(), { status: 'ready' });
});

test('template routes enforce validation and active-template behavior', async () => {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ kind: 'query', sql, params });
    if (sql.includes('WHERE "id" = $1') && sql.includes('documentType')) return [{ id: 't1', documentType: 'student' }];
    if (sql.includes('ORDER BY "id" FOR UPDATE')) return [{ id: 't1' }];
    if (sql.startsWith('SELECT * FROM') && sql.includes('"documentType" = $1')) return [{ id: 't1', documentType: 'student', isActive: true }];
    if (sql.startsWith('SELECT * FROM') && sql.includes('"id" = $1')) return [{ id: 't1', name: calls.some((entry) => entry.kind === 'execute' && entry.sql.startsWith('UPDATE')) ? 'Template B' : 'Template A', documentType: 'student' }];
    return [{ id: 't1', name: 'Template A', documentType: 'student', isActive: false }];
  };
  const execute = async (sql, params = []) => {
    calls.push({ kind: 'execute', sql, params });
    return { count: 1 };
  };

  const transaction = async (work) => work({ query, execute });
  const { byKey } = await activate({ database: { query, execute, transaction } });

  await assert.rejects(
    () => byKey.get('POST:templates').handler({ body: {} }),
    /name is required and must not exceed 120 characters/,
  );
  await assert.rejects(
    () => byKey.get('GET:active/:documentType').handler({ params: { documentType: 'invalid' } }),
    /documentType must be one of/,
  );

  const created = await byKey.get('POST:templates').handler({ body: { name: 'Template A', documentType: 'student', design: { blocks: [] } } });
  assert.equal(created.id, 't1');

  const updated = await byKey.get('PATCH:templates/:id').handler({ params: { id: 't1' }, body: { name: 'Template B', design: { blocks: [1] } } });
  assert.equal(updated.name, 'Template B');

  await assert.rejects(
    () => byKey.get('PATCH:templates/:id').handler({ params: { id: 't1' }, body: { name: 'Invalid', design: { page: { width: 200, height: 200 }, elements: [{ id: 'outside', type: 'text', x: 190, y: 10, width: 50, height: 30 }] } } }),
    /exceeds the page/,
  );

  const active = await byKey.get('PATCH:templates/:id/active').handler({ params: { id: 't1' } });
  assert.deepEqual(active, { id: 't1', documentType: 'student', isActive: true });

  const savedActive = await byKey.get('PUT:active/:documentType').handler({ params: { documentType: 'student' }, body: { design: { blocks: [2] } } });
  assert.equal(savedActive.cardType, 'student');

  const deleted = await byKey.get('DELETE:templates/:id').handler({ params: { id: 't1' } });
  assert.deepEqual(deleted, { ok: true });

  assert.ok(calls.find((entry) => entry.kind === 'execute' && /INSERT INTO plugin_wattanam_document_designer_template/.test(entry.sql)));
  assert.ok(calls.find((entry) => entry.kind === 'execute' && /UPDATE plugin_wattanam_document_designer_template/.test(entry.sql)));
  assert.ok(calls.find((entry) => entry.kind === 'execute' && /DELETE FROM plugin_wattanam_document_designer_template/.test(entry.sql)));
  assert.equal(calls.some((entry) => entry.kind === 'query' && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(entry.sql)), false);
});

test('declarative UI page descriptor aligns with plugin navigation and permissions', () => {
  const manifest = readJson('plugins/wattanam.document-designer/plugin.json');
  const page = readJson('plugins/wattanam.document-designer/frontend/page.json');

  assert.equal(page.schemaVersion, 2);
  assert.equal(page.kind, 'declarative-ui');
  assert.ok(Array.isArray(page.pages));
  assert.ok(page.pages.length >= 1);

  const templatesPage = page.pages.find((item) => item.id === 'templates');
  assert.ok(templatesPage);
  assert.equal(templatesPage.routePath, 'templates');
  assert.equal(templatesPage.permission, 'wattanam.document-designer.view');

  const dataSourcePermissions = (templatesPage.dataSources || []).map((item) => item.permission);
  assert.ok(dataSourcePermissions.includes('wattanam.document-designer.view'));
  assert.ok(dataSourcePermissions.includes('wattanam.document-designer.edit'));
  assert.equal(templatesPage.components.find((component) => component.id === 'templates-table').options.rowRoute, 'templates/edit/:id');

  const editor = page.pages.find((item) => item.id === 'template-editor');
  assert.equal(editor.components[0].type, 'designer');
  assert.equal(editor.components[0].options.saveSource, 'save-template');

  assert.ok(Array.isArray(manifest.permissions));
  assert.ok(manifest.permissions.includes('wattanam.document-designer.view'));
  assert.ok(manifest.permissions.includes('wattanam.document-designer.edit'));
  assert.equal(manifest.navigation[0].href, '/plugins/wattanam.document-designer/templates');
});

test('staff document source composes only bounded directory identity and HR title data', async () => {
  const directory = {
    lookupUsers: async () => [
      { id: 'staff-1', name: 'Teacher One', role: 'TEACHER', email: 'private@example.test' },
      { id: 'staff-2', name: 'Admin Two', role: 'ADMIN', phone: 'private' },
    ],
  };
  const readModels = {
    read: async () => [{ key: 'staff-1', version: 1, data: { directoryUserId: 'staff-1', title: 'Senior Teacher', summary: 'hidden' } }],
  };
  const { byKey } = await activate({ directory, readModels });
  const route = byKey.get('POST:sources/staff');
  const records = await route.handler({ body: { staffIds: ['staff-1', 'staff-2'] } });
  assert.deepEqual(records, [
    { id: 'staff-1', name: 'Teacher One', role: 'TEACHER', title: 'Senior Teacher' },
    { id: 'staff-2', name: 'Admin Two', role: 'ADMIN', title: null },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /private|email|phone|summary/);
  await assert.rejects(() => route.handler({ body: { staffIds: ['staff-1', 'staff-1'] } }), /must be unique/);

  const student = await activate({
    directory: { lookupUsers: async () => [{ id: 'student-1', name: 'Student', role: 'STUDENT' }] },
    readModels,
  });
  await assert.rejects(() => student.byKey.get('POST:sources/staff').handler({ body: { staffIds: ['student-1'] } }), /employee identities only/);
});

test('generation returns a bounded render model without querying another domain', async () => {
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    return [{ id: 't1', name: 'Student card', documentType: 'student', design: {
      page: { width: 400, height: 240, background: '#ffffff' },
      elements: [
        { id: 'student-name', type: 'text', x: 20, y: 20, width: 300, height: 40, binding: 'profile.name', fontSize: 24, fontWeight: 'bold' },
        { id: 'student-qr', type: 'qr', x: 280, y: 100, width: 90, height: 90, binding: 'id' },
      ],
    }, updatedAt: '2026-09-22T00:00:00.000Z' }];
  };
  const { byKey } = await activate({ database: { query, execute: async () => ({ count: 0 }) } });
  const route = byKey.get('POST:templates/:id/generate');
  assert.equal(route.permission, 'wattanam.document-designer.generate');

  const generated = await route.handler({ params: { id: 't1' }, body: { records: [{ id: 's1', profile: { name: 'Student One' } }] } });
  assert.equal(generated.schemaVersion, 2);
  assert.equal(generated.template.id, 't1');
  assert.equal(generated.documents[0].page.width, 400);
  assert.equal(generated.documents[0].elements[0].value, 'Student One');
  assert.equal(generated.documents[0].elements[1].value, 's1');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /plugin_wattanam_document_designer_template/);

  const exportRoute = byKey.get('POST:templates/:id/export-model');
  assert.equal(exportRoute.permission, 'wattanam.document-designer.print');
  const exported = await exportRoute.handler({ params: { id: 't1' }, body: { payload: { records: [{ id: 's1', profile: { name: 'Student One' } }] } } });
  assert.equal(exported.documents[0].elements[0].value, 'Student One');

  await assert.rejects(() => route.handler({ params: { id: 't1' }, body: { records: [] } }), /between 1 and 500/);
  await assert.rejects(() => route.handler({ params: { id: 't1' }, body: { records: new Array(501).fill({ id: 's1' }) } }), /between 1 and 500/);
});

test('generation projects converted legacy CardDesign elements without silently dropping content', async () => {
  const convertedAssetId = '12345678-1234-5678-9abc-123456789abc';
  const database = { query: async () => [{
    id: 'legacy', name: 'Legacy card', documentType: 'student', updatedAt: '2026-09-28T00:00:00.000Z',
    design: {
      cardType: 'student', width: 340, height: 215, backgroundColor: '#fefefe', frameColor: '#223344', frameWidth: 3,
      texts: [
        { id: 'name', content: '{{name}}', x: 10, y: 10, fontSize: 20, color: '#112233', fontWeight: 'bold', fontStyle: 'italic', fontFamily: 'Georgia, serif', textAlign: 'center', zIndex: 8 },
        { id: 'school', content: 'Bora School', x: 10, y: 50, fontSize: 14 },
      ],
      logos: [{ id: 'logo', assetId: convertedAssetId, src: 'data:image/png;base64,aGVsbG8=', x: 250, y: 10, width: 60, height: 60, opacity: 0.75, borderRadius: 4, zIndex: 4 }],
      qr: { x: 250, y: 100, size: 70, borderColor: '#445566', borderWidth: 2, borderRadius: 5, zIndex: 7 }, photo: { x: 140, y: 90, width: 80, height: 100, borderColor: '#556677', borderWidth: 1, borderRadius: 6, zIndex: 6 },
      shapes: [{ id: 'frame', type: 'rectangle', x: 2, y: 2, width: 336, height: 211, rotation: 0, color: '#ffffff', borderColor: '#334455', borderWidth: 2, borderRadius: 8, opacity: 0.5, lineStyle: 'dashed', gradient: { enabled: true, type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#112233' }] } }],
    },
  }], execute: async () => ({ count: 0 }) };
  const { byKey } = await activate({ database });
  const generated = await byKey.get('POST:templates/:id/generate').handler({ params: { id: 'legacy' }, body: { records: [{ id: 's1', name: 'Student One', qrCode: 'STU-1', photo: '/api/media/student.png' }] } });

  assert.deepEqual(generated.documents[0].page, { width: 340, height: 215, background: '#fefefe', frameColor: '#223344', frameWidth: 3, borderRadius: 12 });
  assert.equal(generated.documents[0].elements.length, 6);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'name').value, 'Student One');
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'name').zIndex, 8);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'name').fontStyle, 'italic');
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'name').fontFamily, 'Georgia, serif');
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'school').value, 'Bora School');
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'logo').assetId, convertedAssetId);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'logo').opacity, 0.75);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'logo').borderRadius, 4);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'legacy-qr').value, 'STU-1');
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'legacy-qr').borderWidth, 2);
  assert.equal(generated.documents[0].elements.find((item) => item.id === 'legacy-photo').value, '/api/media/student.png');
  assert.deepEqual(generated.documents[0].elements.find((item) => item.id === 'frame'), {
    id: 'frame', type: 'shape', shapeType: 'rectangle', x: 2, y: 2, width: 336, height: 211,
    rotation: 0, zIndex: 0, fill: '#ffffff', borderColor: '#334455', borderWidth: 2, borderRadius: 8, opacity: 0.5,
    lineStyle: 'dashed', gradient: { enabled: true, type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#112233' }] },
  });
});

test('legacy generation fails closed until unsupported visual elements and images are converted', async () => {
  const generate = async (design) => {
    const { byKey } = await activate({ database: { query: async () => [{ id: 'legacy', name: 'Legacy', documentType: 'student', design, updatedAt: 'now' }], execute: async () => ({ count: 0 }) } });
    return byKey.get('POST:templates/:id/generate').handler({ params: { id: 'legacy' }, body: { records: [{ id: 's1' }] } });
  };
  await assert.rejects(() => generate({ width: 340, height: 215, texts: [], logos: [{ id: 'logo', src: 'data:image/png;base64,aGVsbG8=' }] }), /not converted to plugin-scoped storage/);
  await assert.rejects(() => generate({ width: 340, height: 215, texts: [], logos: [], shapes: [{ id: 'shape', type: 'rectangle', gradient: { enabled: true, stops: [{ offset: 1, color: '#ffffff' }, { offset: 0, color: '#000000' }] } }] }), /stops must be ordered/);
  const { byKey } = await activate({ database: { query: async () => [{ id: 'photo', name: 'Photo', documentType: 'student', design: { page: { width: 200, height: 200 }, elements: [{ id: 'photo', type: 'photo', x: 0, y: 0, width: 100, height: 100, binding: 'photo' }] }, updatedAt: 'now' }], execute: async () => ({ count: 0 }) } });
  await assert.rejects(() => byKey.get('POST:templates/:id/generate').handler({ params: { id: 'photo' }, body: { records: [{ id: 's1', photo: 'https://tracking.example/student.png' }] } }), /same-origin path or canonical embedded raster image/);
});

test('asset routes use scoped storage and reject unsafe input', async () => {
  const values = new Map();
  const storage = {
    list: async (prefix) => [...values.keys()].filter((name) => name.startsWith(prefix)).map(String),
    readText: async (name) => values.get(name) ?? null,
    readBinary: async (name) => values.get(name) ?? null,
    writeText: async (name, value) => values.set(name, value),
    writeBinary: async (name, value) => values.set(name, value),
    delete: async (name) => { values.delete(name); },
  };
  const { byKey } = await activate({ storage });

  await assert.rejects(
    () => byKey.get('POST:assets').handler({ body: { fileName: '../logo.png', mimeType: 'image/png', data: 'aGVsbG8=' } }),
    /fileName is invalid/,
  );
  await assert.rejects(
    () => byKey.get('POST:assets').handler({ body: { fileName: 'logo.svg', mimeType: 'image/svg+xml', data: 'aGVsbG8=' } }),
    /mimeType is not allowed/,
  );

  const created = await byKey.get('POST:assets').handler({ body: { fileName: 'logo.png', mimeType: 'image/png', data: 'aGVsbG8=' } });
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(values.get(`assets/${created.id}.bin`), 'aGVsbG8=');

  const listed = await byKey.get('GET:assets').handler();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'logo.png');
  const loaded = await byKey.get('GET:assets/:id').handler({ params: { id: created.id } });
  assert.equal(loaded.dataBase64, 'aGVsbG8=');

  const hostUpload = await byKey.get('POST:assets').handler({ body: { name: 'photo.webp', mimeType: 'image/webp', dataBase64: 'aGVsbG8=' } });
  assert.equal(hostUpload.name, 'photo.webp');

  await byKey.get('DELETE:assets/:id').handler({ params: { id: created.id } });
  await byKey.get('DELETE:assets/:id').handler({ params: { id: hostUpload.id } });
  assert.equal(values.size, 0);
});

test('namespaced migration is one statement with an active-by-type uniqueness constraint', () => {
  const manifest = readJson('plugins/wattanam.document-designer/plugin.json');
  const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', manifest.migrations[0].path.replace(/^/, 'plugins/wattanam.document-designer/')), 'utf8');
  assert.equal((sql.match(/;/g) || []).length, 1);
  assert.match(sql, /CREATE TABLE "plugin_wattanam_document_designer_template"/);
  assert.match(sql, /"activeDocumentType" TEXT GENERATED ALWAYS AS[\s\S]*STORED UNIQUE/);
});

test('re-activation preserves existing template data across simulated disable/remove/reinstall', async () => {
  const rows = [];
  const query = async (sql, params = []) => {
    if (sql.startsWith('SELECT * FROM') && sql.includes('"id" = $1')) return rows.find((row) => row.id === params[0]) ? [rows.find((row) => row.id === params[0])] : [];
    if (sql.includes('FROM plugin_wattanam_document_designer_template') && sql.includes('WHERE "isActive" = FALSE')) return [...rows];
    return [];
  };
  const execute = async (sql, params = []) => {
    if (sql.startsWith('INSERT INTO')) rows.push({ id: params[0], name: params[1], documentType: params[2], design: JSON.parse(params[3]), isActive: false });
    return { count: 1 };
  };

  const first = await activate({ database: { query, execute } });
  await first.byKey.get('POST:templates').handler({ body: { name: 'Survives Reinstall', documentType: 'student', design: { blocks: [1] } } });
  reference.deactivate(first.context);

  // Simulate core remove/reinstall by creating a fresh runtime context while keeping DB rows.
  const second = await activate({ database: { query, execute } });
  const listed = await second.byKey.get('GET:templates').handler();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Survives Reinstall');
});

test('generation result is connected to bounded host print/export UI', async () => {
  const manifest = readJson('plugins/wattanam.document-designer/plugin.json');
  const page = readJson('plugins/wattanam.document-designer/frontend/page.json');
  const { routes } = await activate();

  // Generation exposes a bounded render model consumed by the host print/CSV/PDF component.
  assert.ok(manifest.permissions.includes('wattanam.document-designer.generate'));
  assert.ok(manifest.permissions.includes('wattanam.document-designer.print'));

  const routeKeys = routes.map((route) => `${route.method}:${route.path}`);
  assert.equal(routeKeys.includes('POST:templates/:id/generate'), true);
  assert.equal(routeKeys.includes('POST:templates/:id/export-model'), true);

  const serializedPages = JSON.stringify(page.pages || []);
  assert.equal(/"type":"print"/.test(serializedPages), true);
  assert.equal(/"itemsPath":"records"/.test(serializedPages), true);
  assert.equal(/"type":"document"/.test(serializedPages), true);
  assert.equal(/"documentsPath":"documents"/.test(serializedPages), true);
  assert.equal(/"permission":"wattanam.document-designer.print"/.test(serializedPages), true);
});
