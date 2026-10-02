import { parsePluginUiBundle } from './plugin-ui-schema';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const permissions = new Set(['wattanam.test.read', 'wattanam.test.manage']);

function valid() {
  return {
    schemaVersion: 2,
    kind: 'declarative-ui',
    pages: [{
      id: 'records', title: 'Records', routePath: 'records/:id', permission: 'wattanam.test.read',
      parameters: [{ name: 'id', type: 'uuid' }],
      dataSources: [
        { id: 'record', method: 'GET', path: 'records/:id', permission: 'wattanam.test.read' },
        { id: 'save', method: 'PATCH', path: 'records/:id', permission: 'wattanam.test.manage' },
      ],
      components: [
        { id: 'title', type: 'heading', title: 'Record' },
        { id: 'editor', type: 'form', source: 'save', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }] },
      ],
    }],
  };
}

describe('Plugin UI v2 schema', () => {
  it('parses a versioned declarative page and its allow-listed components', () => {
    expect(parsePluginUiBundle(valid(), 'wattanam.test', permissions)).toMatchObject({
      schemaVersion: 2,
      kind: 'declarative-ui',
      pages: [{ id: 'records', components: [{ type: 'heading' }, { type: 'form' }] }],
    });
  });

  it.each([
    ['script element', () => { const value: any = valid(); value.pages[0].components[0].title = '<script>alert(1)</script>'; return value; }],
    ['event handler', () => { const value: any = valid(); value.pages[0].components[0].options = { onClick: 'steal()' }; return value; }],
    ['unsafe HTML', () => { const value: any = valid(); value.pages[0].components[0].html = '<b>unsafe</b>'; return value; }],
    ['external URL', () => { const value: any = valid(); value.pages[0].components[0].options = { href: 'https://evil.example' }; return value; }],
    ['javascript URL', () => { const value: any = valid(); value.pages[0].components[0].options = { href: 'javascript:alert(1)' }; return value; }],
    ['namespace escape', () => { const value: any = valid(); value.pages[0].dataSources[0].path = '../users'; return value; }],
    ['unknown component', () => { const value: any = valid(); value.pages[0].components[0].type = 'iframe'; return value; }],
  ])('rejects hostile descriptor content: %s', (_label, factory) => {
    expect(() => parsePluginUiBundle(factory(), 'wattanam.test', permissions)).toThrow();
  });

  it('rejects undeclared page and data-source permissions', () => {
    const pagePermission: any = valid();
    pagePermission.pages[0].permission = 'wattanam.test.undeclared';
    expect(() => parsePluginUiBundle(pagePermission, 'wattanam.test', permissions)).toThrow('not declared');

    const sourcePermission: any = valid();
    sourcePermission.pages[0].dataSources[0].permission = 'core.users.manage';
    expect(() => parsePluginUiBundle(sourcePermission, 'wattanam.test', permissions)).toThrow('not declared');
  });

  it('rejects components bound to unknown data sources', () => {
    const value: any = valid();
    value.pages[0].components[1].source = 'missing';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('unknown data source');
  });

  it('requires typed declarations for every page and source route parameter', () => {
    const missing: any = valid();
    missing.pages[0].parameters = [];
    expect(() => parsePluginUiBundle(missing, 'wattanam.test', permissions)).toThrow('must match');

    const undeclared: any = valid();
    undeclared.pages[0].dataSources[0].path = 'records/:otherId';
    expect(() => parsePluginUiBundle(undeclared, 'wattanam.test', permissions)).toThrow('undeclared');
  });

  it('validates the declarative table contract', () => {
    const value: any = valid();
    value.pages[0].components[1] = { id: 'records', type: 'table', source: 'record', fields: [{ id: 'name', label: 'Name', sortable: true, filterable: true }], options: { pageSize: 25, selectable: true } };
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[1]).toMatchObject({ type: 'table', source: 'record' });
    value.pages[0].components[1].options.pageSize = 101;
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('pageSize');
  });

  it('allows safe camelCase and nested API data paths as table columns', () => {
    const value: any = valid();
    value.pages[0].components[1] = { id: 'records', type: 'table', source: 'record', fields: [
      { id: 'createdAt', label: 'Created' }, { id: 'owner.name', label: 'Owner' },
    ], options: {} };
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[1].fields).toHaveLength(2);
  });

  it('validates form fields, mutations, conditions, and confirmations', () => {
    const value: any = valid();
    value.pages[0].components[1] = {
      id: 'editor', type: 'form', source: 'save',
      fields: [
        { id: 'kind', type: 'select', label: 'Kind', required: true, options: [{ label: 'Person', value: 'person' }] },
        { id: 'name', type: 'text', label: 'Name', minLength: 2, visibleWhen: { field: 'kind', equals: 'person' } },
      ],
      options: { initialSource: 'record', confirmation: 'Save this record?', submitLabel: 'Save' },
    };
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[1]).toMatchObject({ type: 'form', source: 'save' });
    value.pages[0].dataSources[1].method = 'GET';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('POST, PUT, or PATCH');
  });

  it('allows an explicit empty value for clearing an optional select field', () => {
    const value: any = valid();
    value.pages[0].components[1].fields = [{ id: 'sex', type: 'select', label: 'Sex', options: [{ label: 'Not specified', value: '' }, { label: 'Other', value: 'OTHER' }] }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[1].fields?.[0]).toMatchObject({ id: 'sex' });
  });

  it('allows a declared JSON object editor field without allowing arbitrary component types', () => {
    const value: any = valid();
    value.pages[0].components[1].fields = [{ id: 'design', type: 'json', label: 'Design JSON', required: true, maxLength: 200000 }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[1].fields[0])
      .toMatchObject({ id: 'design', type: 'json' });
    value.pages[0].components[1].fields[0].type = 'script';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('form field id or type');
  });

  it('validates the Document Designer edit page against its declared permissions', () => {
    const pluginRoot = path.resolve(process.cwd(), '../plugins/wattanam.document-designer');
    const descriptor = JSON.parse(readFileSync(path.join(pluginRoot, 'frontend/page.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, 'wattanam.document-designer', new Set(manifest.permissions));
    const detail = bundle.pages.find((page) => page.id === 'template-detail');
    expect(detail?.components.some((component) => component.type === 'document')).toBe(true);
    expect(bundle.pages.find((page) => page.id === 'template-editor')).toMatchObject({
      permission: 'wattanam.document-designer.edit',
      components: [{ type: 'designer', source: 'template', options: { saveSource: 'save-template', assetSource: 'assets' } }],
    });
  });

  it('validates single and bulk mutation actions', () => {
    const value: any = valid();
    value.pages[0].components.push({ id: 'record-actions', type: 'actions', options: { actions: [
      { id: 'save', label: 'Save', mode: 'single', source: 'save', body: { approved: true } },
      { id: 'bulk-save', label: 'Save selected', mode: 'bulk', source: 'save', selectionSource: 'record', idField: 'id', idParameter: 'id', confirmation: 'Continue?' },
    ] } });
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[2]).toMatchObject({ type: 'actions' });
    value.pages[0].components[2].options.actions[1].selectionSource = 'save';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('GET data source');
  });

  it('validates dashboard metrics, charts, cards, and statuses', () => {
    const value: any = valid();
    value.pages[0].components = [
      { id: 'total', type: 'metric', title: 'Total', source: 'record', options: { valuePath: 'summary.total', trendPath: 'summary.change', format: 'number' } },
      { id: 'breakdown', type: 'chart', title: 'Breakdown', source: 'record', options: { chartType: 'bar', itemsPath: 'items', categoryPath: 'label', valuePath: 'count', maximumItems: 50 } },
      { id: 'details', type: 'card', title: 'Details', source: 'record', fields: [{ label: 'Owner', path: 'owner.name' }], options: {} },
      { id: 'health', type: 'status', title: 'Health', source: 'record', options: { valuePath: 'health', states: [{ value: 'ok', label: 'Healthy', tone: 'success' }] } },
    ];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components).toHaveLength(4);
    value.pages[0].components[1].options.chartType = 'script';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('chart type');
  });

  it('validates scoped file sources, safe MIME types, and bounded uploads', () => {
    const value: any = valid();
    value.pages[0].dataSources.push(
      { id: 'files', method: 'GET', path: 'files', permission: 'wattanam.test.read' },
      { id: 'upload', method: 'POST', path: 'files', permission: 'wattanam.test.manage' },
      { id: 'download', method: 'GET', path: 'files/:fileId', parameters: ['fileId'], autoload: false, permission: 'wattanam.test.read' },
      { id: 'delete', method: 'DELETE', path: 'files/:fileId', parameters: ['fileId'], autoload: false, permission: 'wattanam.test.manage' },
    );
    value.pages[0].components = [{ id: 'files', type: 'file', source: 'files', options: { uploadSource: 'upload', downloadSource: 'download', deleteSource: 'delete', idParameter: 'fileId', maxBytes: 1048576, acceptedTypes: ['image/png', 'application/pdf', 'text/plain'] } }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[0]).toMatchObject({ type: 'file' });
    value.pages[0].components[0].options.acceptedTypes.push('image/svg+xml');
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('unsafe type');
  });

  it('validates print, CSV, and PDF export declarations', () => {
    const value: any = valid();
    value.pages[0].components = [{ id: 'export', type: 'print', title: 'Records', source: 'record', fields: [{ label: 'Name', path: 'name' }], options: { formats: ['print', 'csv', 'pdf'], filename: 'records', maximumRows: 5000 } }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[0]).toMatchObject({ type: 'print' });
    value.pages[0].components[0].options.filename = '../escape';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('filename');
  });

  it('allows only namespaced refresh subscriptions over declared GET sources', () => {
    const value: any = valid();
    value.pages[0].realtime = [{ event: 'records:changed', refreshSources: ['record'] }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].realtime).toEqual([{ event: 'records:changed', refreshSources: ['record'] }]);
    value.pages[0].realtime[0].event = 'plugin:other:escape';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('event');
  });

  it('validates camera and keyboard scanner declarations', () => {
    const value: any = valid();
    value.pages[0].components = [{ id: 'scan', type: 'scanner', source: 'save', options: { modes: ['camera', 'keyboard'], field: 'code', minLength: 4, maxLength: 100, debounceMs: 1000, contextFields: [{ id: 'classId', type: 'text', label: 'Class', required: true }, { id: 'session', type: 'select', label: 'Session', options: [{ label: 'One', value: 1 }] }] } }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[0]).toMatchObject({ type: 'scanner' });
    value.pages[0].components[0].options.modes = ['script'];
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('modes');
  });

  it.each([
    ['duplicate context field', [{ id: 'classId', type: 'text', label: 'Class' }, { id: 'classId', type: 'text', label: 'Again' }]],
    ['unsafe context field type', [{ id: 'classId', type: 'script', label: 'Class' }]],
    ['empty select choices', [{ id: 'session', type: 'select', label: 'Session', options: [] }]],
  ])('rejects scanner %s', (_label, contextFields) => {
    const value: any = valid();
    value.pages[0].components = [{ id: 'scan', type: 'scanner', source: 'save', options: { modes: ['keyboard'], field: 'code', contextFields } }];
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow();
  });

  it('validates declarative query filters over explicit GET sources', () => {
    const value: any = valid();
    value.pages[0].components = [{ id: 'filters', type: 'filter', fields: [
      { id: 'startDate', type: 'date', label: 'Start date' },
      { id: 'status', type: 'select', label: 'Status', options: [{ label: 'Present', value: 'PRESENT' }] },
    ], options: { sources: ['record'], applyLabel: 'Apply' } }];
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].components[0]).toMatchObject({ type: 'filter' });
    value.pages[0].components[0].options.sources = ['save'];
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('GET data sources');
  });

  it('validates the Attendance Manager camera/USB, report, and study-year UI bundle', () => {
    const pluginRoot = path.resolve(__dirname, '../../../plugins/wattanam.attendance-manager');
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
    const descriptor = JSON.parse(readFileSync(path.join(pluginRoot, 'frontend/page.json'), 'utf8'));
    const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));

    expect(bundle.pages.map((page) => page.id)).toEqual(['attendance', 'scanner', 'corrections', 'correction-edit', 'alerts', 'reports', 'study-years', 'settings']);
    expect(bundle.pages.find((page) => page.id === 'scanner')?.components[1]).toMatchObject({ type: 'scanner' });
    expect(bundle.pages.find((page) => page.id === 'correction-edit')).toMatchObject({ permission: 'wattanam.attendance-manager.correct' });
    expect(bundle.pages.find((page) => page.id === 'reports')?.components).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'filter' }), expect.objectContaining({ type: 'print' })]));
  });

  it('validates the complete Academic Management UI bundle including roster actions', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), '..', 'plugins', 'wattanam.academic-management', 'plugin.json'), 'utf8'));
    const bundle = JSON.parse(readFileSync(path.resolve(process.cwd(), '..', 'plugins', 'wattanam.academic-management', 'frontend', 'page.json'), 'utf8'));
    const parsed = parsePluginUiBundle(bundle, manifest.id, new Set(manifest.permissions));
    const roster = parsed.pages.find((page) => page.id === 'class-students');
    expect(roster).toBeDefined();
    expect(roster?.dataSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'removeStudent', method: 'DELETE', autoload: false, parameters: ['studentId'] }),
      expect.objectContaining({ id: 'cleanupOrphanedStudents', method: 'POST' }),
    ]));
    expect(roster?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'class-students-table', type: 'table', options: expect.objectContaining({ selectable: true }) }),
      expect.objectContaining({ id: 'student-actions', type: 'actions' }),
    ]));
    const settings = parsed.pages.find((page) => page.id === 'registration-settings');
    const createField = settings?.components.find((component) => component.id === 'custom-field-create-form');
    expect(createField?.fields).toContainEqual(expect.objectContaining({ id: 'options', jsonShape: 'array' }));
  });

  it('validates bounded launch-language translations', () => {
    const value: any = valid();
    value.pages[0].defaultLanguage = 'en';
    value.pages[0].translations = { en: { 'page.title': 'Records' }, km: { 'page.title': 'កំណត់ត្រា' } };
    expect(parsePluginUiBundle(value, 'wattanam.test', permissions).pages[0].translations?.km['page.title']).toBe('កំណត់ត្រា');
    value.pages[0].defaultLanguage = 'fr';
    expect(() => parsePluginUiBundle(value, 'wattanam.test', permissions)).toThrow('no translations');
  });
});
