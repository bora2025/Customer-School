import { BadRequestException } from '@nestjs/common';

export const PLUGIN_UI_SCHEMA_VERSION = 2 as const;

export type PluginUiComponentType =
  | 'heading' | 'text' | 'status' | 'card' | 'metric' | 'table' | 'form'
  | 'detail' | 'chart' | 'file' | 'print' | 'document' | 'designer' | 'scanner' | 'self-attendance-scanner' | 'filter' | 'actions' | 'study-year-manager' | 'class-manager' | 'officer-manager' | 'session-manager' | 'take-attendance' | 'id-card-manager' | 'attendance-report-manager' | 'attendance-dashboard' | 'attendance-window-manager';

export interface PluginUiDataSource {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  permission: string;
  parameters?: string[];
  autoload?: boolean;
}

export interface PluginUiComponent {
  id: string;
  type: PluginUiComponentType;
  title?: string;
  source?: string;
  fields?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
}

export interface PluginUiPage {
  id: string;
  title: string;
  routePath: string;
  permission: string;
  parameters: Array<{ name: string; type: 'uuid' | 'integer' | 'slug' | 'string'; maximumLength?: number }>;
  dataSources: PluginUiDataSource[];
  components: PluginUiComponent[];
  realtime?: Array<{ event: string; refreshSources: string[] }>;
  defaultLanguage?: string;
  translations?: Record<string, Record<string, string>>;
}

export interface PluginUiBundle {
  schemaVersion: 2;
  kind: 'declarative-ui';
  pages: PluginUiPage[];
}

const ID = /^[a-z0-9][a-zA-Z0-9._-]*$/;
const ROUTE_SEGMENT = '(?:[a-z0-9][a-z0-9_-]*|:[a-z][a-zA-Z0-9]*)';
const ROUTE = new RegExp(`^${ROUTE_SEGMENT}(?:/${ROUTE_SEGMENT})*$`);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const COMPONENTS = new Set<PluginUiComponentType>([
  'heading', 'text', 'status', 'card', 'metric', 'table', 'form', 'detail',
  'chart', 'file', 'print', 'document', 'designer', 'scanner', 'self-attendance-scanner', 'filter', 'actions', 'study-year-manager', 'class-manager', 'officer-manager', 'session-manager', 'take-attendance', 'id-card-manager', 'attendance-report-manager', 'attendance-dashboard', 'attendance-window-manager',
]);
const FORBIDDEN_KEYS = /^(?:html|dangerouslySetInnerHTML|script|srcDoc|javascript|on[A-Z].*)$/;
const DATA_PATH = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

function routeParameters(route: string): string[] {
  return route.split('/').filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new BadRequestException(`${label} is invalid`);
  return value.trim();
}

function safeRoute(value: unknown, label: string, parameters = false): string {
  const route = string(value, label, 240);
  if (route.startsWith('/') || route.includes('..') || route.includes('//') || !ROUTE.test(route)) throw new BadRequestException(`${label} must stay inside the plugin namespace`);
  if (!parameters && route.includes(':')) throw new BadRequestException(`${label} cannot contain route parameters`);
  return route;
}

function inspectSafeJson(value: unknown, label: string, depth = 0): void {
  if (depth > 12) throw new BadRequestException(`${label} is too deeply nested`);
  if (typeof value === 'string') {
    if (/\bjavascript\s*:/i.test(value) || /<\s*script\b/i.test(value) || /<[^>]+>/i.test(value)) throw new BadRequestException(`${label} contains unsafe executable or HTML content`);
    if (/^(?:https?:)?\/\//i.test(value)) throw new BadRequestException(`${label} contains an untrusted external URL`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => inspectSafeJson(item, `${label}[${index}]`, depth + 1)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.test(key)) throw new BadRequestException(`${label}.${key} is forbidden`);
    inspectSafeJson(child, `${label}.${key}`, depth + 1);
  }
}

export function parsePluginUiBundle(value: unknown, pluginId: string, declaredPermissions: Set<string>): PluginUiBundle {
  const root = object(value, 'Plugin UI descriptor');
  if (root.schemaVersion !== PLUGIN_UI_SCHEMA_VERSION || root.kind !== 'declarative-ui') throw new BadRequestException('Unsupported plugin UI schema version or kind');
  if (!Array.isArray(root.pages) || root.pages.length < 1 || root.pages.length > 50) throw new BadRequestException('Plugin UI pages must contain 1 to 50 pages');
  inspectSafeJson(root, 'Plugin UI descriptor');

  const pageIds = new Set<string>();
  const routePaths = new Set<string>();
  const pages = root.pages.map((candidate, pageIndex): PluginUiPage => {
    const page = object(candidate, `pages[${pageIndex}]`);
    const id = string(page.id, `pages[${pageIndex}].id`, 100);
    if (!ID.test(id) || pageIds.has(id)) throw new BadRequestException(`pages[${pageIndex}].id is invalid or duplicated`);
    pageIds.add(id);
    const routePath = safeRoute(page.routePath, `pages[${pageIndex}].routePath`, true);
    if (routePaths.has(routePath)) throw new BadRequestException(`pages[${pageIndex}].routePath is duplicated`);
    routePaths.add(routePath);
    const permission = string(page.permission, `pages[${pageIndex}].permission`);
    if (!permission.startsWith(`${pluginId}.`) || !declaredPermissions.has(permission)) throw new BadRequestException(`pages[${pageIndex}].permission is not declared by the plugin`);

    if (!Array.isArray(page.parameters) || page.parameters.length > 10) throw new BadRequestException(`pages[${pageIndex}].parameters must be an array`);
    const parameterNames = new Set<string>();
    const parameters = page.parameters.map((candidateParameter, parameterIndex) => {
      const parameter = object(candidateParameter, `pages[${pageIndex}].parameters[${parameterIndex}]`);
      const name = string(parameter.name, 'route parameter name', 60);
      const type = string(parameter.type, 'route parameter type', 20) as 'uuid' | 'integer' | 'slug' | 'string';
      if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || parameterNames.has(name) || !['uuid', 'integer', 'slug', 'string'].includes(type)) throw new BadRequestException('Plugin UI route parameter is invalid or duplicated');
      parameterNames.add(name);
      const maximumLength = parameter.maximumLength === undefined ? undefined : Number(parameter.maximumLength);
      if (maximumLength !== undefined && (!Number.isInteger(maximumLength) || maximumLength < 1 || maximumLength > 160)) throw new BadRequestException('Plugin UI route parameter maximumLength is invalid');
      return { name, type, ...(maximumLength === undefined ? {} : { maximumLength }) };
    });
    const usedPageParameters = routeParameters(routePath);
    if (usedPageParameters.length !== parameterNames.size || usedPageParameters.some((name) => !parameterNames.has(name))) throw new BadRequestException(`pages[${pageIndex}] route parameters and declarations must match`);

    if (!Array.isArray(page.dataSources) || page.dataSources.length > 30) throw new BadRequestException(`pages[${pageIndex}].dataSources must be an array`);
    const sourceIds = new Set<string>();
    const sourceMethods = new Map<string, PluginUiDataSource['method']>();
    const sourceParameters = new Map<string, Set<string>>();
    const dataSources = page.dataSources.map((candidateSource, sourceIndex): PluginUiDataSource => {
      const source = object(candidateSource, `pages[${pageIndex}].dataSources[${sourceIndex}]`);
      const sourceId = string(source.id, 'data source id', 100);
      if (!ID.test(sourceId) || sourceIds.has(sourceId)) throw new BadRequestException('Plugin UI data source id is invalid or duplicated');
      sourceIds.add(sourceId);
      const method = string(source.method, 'data source method', 10).toUpperCase();
      if (!METHODS.has(method)) throw new BadRequestException('Plugin UI data source method is unsupported');
      const sourcePermission = string(source.permission, 'data source permission');
      if (!sourcePermission.startsWith(`${pluginId}.`) || !declaredPermissions.has(sourcePermission)) throw new BadRequestException('Plugin UI data source permission is not declared by the plugin');
      const sourcePath = safeRoute(source.path, 'data source path', true);
      if (source.parameters !== undefined && (!Array.isArray(source.parameters) || source.parameters.some((name) => typeof name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(name)))) throw new BadRequestException('Plugin UI data source parameters are invalid');
      const ownParameters = new Set((source.parameters || []) as string[]);
      if (ownParameters.size !== ((source.parameters || []) as string[]).length) throw new BadRequestException('Plugin UI data source parameters are duplicated');
      if (routeParameters(sourcePath).some((name) => !parameterNames.has(name) && !ownParameters.has(name))) throw new BadRequestException('Plugin UI data source uses an undeclared route parameter');
      if ([...ownParameters].some((name) => !routeParameters(sourcePath).includes(name))) throw new BadRequestException('Plugin UI data source declares an unused parameter');
      if (source.autoload !== undefined && typeof source.autoload !== 'boolean') throw new BadRequestException('Plugin UI data source autoload must be boolean');
      if (ownParameters.size && source.autoload !== false) throw new BadRequestException('Plugin UI data source with runtime parameters must disable autoload');
      sourceMethods.set(sourceId, method as PluginUiDataSource['method']);
      sourceParameters.set(sourceId, ownParameters);
      return { id: sourceId, method: method as PluginUiDataSource['method'], path: sourcePath, permission: sourcePermission, ...(ownParameters.size ? { parameters: [...ownParameters] } : {}), ...(source.autoload === false ? { autoload: false } : {}) };
    });

    if (!Array.isArray(page.components) || page.components.length < 1 || page.components.length > 100) throw new BadRequestException(`pages[${pageIndex}].components must contain 1 to 100 components`);
    const componentIds = new Set<string>();
    const components = page.components.map((candidateComponent, componentIndex): PluginUiComponent => {
      const component = object(candidateComponent, `pages[${pageIndex}].components[${componentIndex}]`);
      const componentId = string(component.id, 'component id', 100);
      const type = string(component.type, 'component type', 40) as PluginUiComponentType;
      if (!ID.test(componentId) || componentIds.has(componentId) || !COMPONENTS.has(type)) throw new BadRequestException('Plugin UI component id or type is invalid');
      componentIds.add(componentId);
      const source = component.source === undefined ? undefined : string(component.source, 'component source', 100);
      if (source && !sourceIds.has(source)) throw new BadRequestException(`Plugin UI component references unknown data source: ${source}`);
      if (component.fields !== undefined && !Array.isArray(component.fields)) throw new BadRequestException('Plugin UI component fields must be an array');
      if (component.options !== undefined) object(component.options, 'component options');
      if (type === 'table') {
        if (!source) throw new BadRequestException('Plugin UI table requires a data source');
        if (!Array.isArray(component.fields) || component.fields.length < 1 || component.fields.length > 30) throw new BadRequestException('Plugin UI table requires 1 to 30 column fields');
        const columnIds = new Set<string>();
        component.fields.forEach((candidateField, fieldIndex) => {
          const field = object(candidateField, `table fields[${fieldIndex}]`);
          const fieldId = string(field.id, 'table column id', 100);
          if (!DATA_PATH.test(fieldId) || columnIds.has(fieldId)) throw new BadRequestException('Plugin UI table column id is invalid or duplicated');
          columnIds.add(fieldId);
          if (field.label !== undefined) string(field.label, 'table column label', 120);
          if (field.sortable !== undefined && typeof field.sortable !== 'boolean') throw new BadRequestException('Plugin UI table sortable must be boolean');
          if (field.filterable !== undefined && typeof field.filterable !== 'boolean') throw new BadRequestException('Plugin UI table filterable must be boolean');
          if (field.format !== undefined && !['text', 'boolean', 'number', 'currency', 'date', 'datetime'].includes(String(field.format))) throw new BadRequestException('Plugin UI table format is invalid');
        });
        const options = (component.options || {}) as Record<string, unknown>;
        if (options.pageSize !== undefined && (!Number.isInteger(options.pageSize) || Number(options.pageSize) < 1 || Number(options.pageSize) > 100)) throw new BadRequestException('Plugin UI table pageSize must be between 1 and 100');
        if (options.selectable !== undefined && typeof options.selectable !== 'boolean') throw new BadRequestException('Plugin UI table selectable must be boolean');
        if (options.rowRoute !== undefined) {
          const rowRoute = safeRoute(options.rowRoute, 'Plugin UI table rowRoute', true);
          const mapping = object(options.rowParameterMap, 'Plugin UI table rowParameterMap');
          const routeNames = routeParameters(rowRoute);
          if (routeNames.length === 0) throw new BadRequestException('Plugin UI table rowRoute requires a route parameter');
          for (const [name, dataPath] of Object.entries(mapping)) {
            if (!routeNames.includes(name) || typeof dataPath !== 'string' || !DATA_PATH.test(dataPath)) throw new BadRequestException('Plugin UI table rowParameterMap is invalid');
          }
          if (routeNames.some((name) => !parameterNames.has(name) && !Object.prototype.hasOwnProperty.call(mapping, name))) throw new BadRequestException('Plugin UI table rowRoute has an unresolved parameter');
        } else if (options.rowParameterMap !== undefined) {
          throw new BadRequestException('Plugin UI table rowParameterMap requires rowRoute');
        }
      }
      if (type === 'form') {
        if (!source || sourceMethods.get(source) === 'GET' || sourceMethods.get(source) === 'DELETE') throw new BadRequestException('Plugin UI form requires a POST, PUT, or PATCH data source');
        if (!Array.isArray(component.fields) || component.fields.length < 1 || component.fields.length > 50) throw new BadRequestException('Plugin UI form requires 1 to 50 fields');
        const fieldIds = new Set<string>();
        component.fields.forEach((candidateField, fieldIndex) => {
          const field = object(candidateField, `form fields[${fieldIndex}]`);
          const fieldId = string(field.id, 'form field id', 100);
          const fieldType = string(field.type, 'form field type', 30);
          if (!ID.test(fieldId) || fieldIds.has(fieldId) || !['text', 'email', 'number', 'date', 'datetime', 'select', 'textarea', 'json', 'checkbox'].includes(fieldType)) throw new BadRequestException('Plugin UI form field id or type is invalid');
          fieldIds.add(fieldId);
          string(field.label, 'form field label', 120);
          if (field.jsonShape !== undefined && (fieldType !== 'json' || !['object', 'array', 'any'].includes(String(field.jsonShape)))) throw new BadRequestException('Plugin UI form jsonShape is invalid');
          if (field.defaultValue !== undefined) inspectSafeJson(field.defaultValue, `form fields[${fieldIndex}].defaultValue`);
          for (const booleanKey of ['required', 'disabled'] as const) if (field[booleanKey] !== undefined && typeof field[booleanKey] !== 'boolean') throw new BadRequestException(`Plugin UI form ${booleanKey} must be boolean`);
          for (const numericKey of ['min', 'max', 'minLength', 'maxLength'] as const) if (field[numericKey] !== undefined && typeof field[numericKey] !== 'number') throw new BadRequestException(`Plugin UI form ${numericKey} must be numeric`);
          if (fieldType === 'select') {
            if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100) throw new BadRequestException('Plugin UI select requires 1 to 100 options');
            field.options.forEach((choice, choiceIndex) => {
              const option = object(choice, `select options[${choiceIndex}]`);
              string(option.label, 'select option label', 120);
              if (typeof option.value !== 'string' || option.value.length > 160) throw new BadRequestException('select option value is invalid');
            });
          }
          if (field.visibleWhen !== undefined) {
            const condition = object(field.visibleWhen, 'form field visibleWhen');
            const dependency = string(condition.field, 'visibleWhen field', 100);
            if (!ID.test(dependency) || !Object.prototype.hasOwnProperty.call(condition, 'equals') || !['string', 'number', 'boolean'].includes(typeof condition.equals)) throw new BadRequestException('Plugin UI form visibleWhen is invalid');
          }
        });
        component.fields.forEach((candidateField) => { const condition = (candidateField as Record<string, any>).visibleWhen; if (condition && !fieldIds.has(condition.field)) throw new BadRequestException('Plugin UI form visibleWhen references an unknown field'); });
        const options = (component.options || {}) as Record<string, unknown>;
        for (const key of ['submitLabel', 'confirmation', 'successMessage'] as const) if (options[key] !== undefined) string(options[key], `form ${key}`, 240);
        if (options.initialSource !== undefined && (typeof options.initialSource !== 'string' || !sourceIds.has(options.initialSource) || sourceMethods.get(options.initialSource) !== 'GET')) throw new BadRequestException('Plugin UI form initialSource must reference a GET data source');
      }
      if (type === 'actions') {
        const options = object(component.options, 'Plugin UI actions options');
        if (!Array.isArray(options.actions) || options.actions.length < 1 || options.actions.length > 20) throw new BadRequestException('Plugin UI actions requires 1 to 20 actions');
        const actionIds = new Set<string>();
        options.actions.forEach((candidateAction, actionIndex) => {
          const action = object(candidateAction, `actions[${actionIndex}]`);
          const actionId = string(action.id, 'action id', 100);
          const actionSource = string(action.source, 'action source', 100);
          const mode = string(action.mode, 'action mode', 20);
          if (!ID.test(actionId) || actionIds.has(actionId) || !['single', 'bulk'].includes(mode)) throw new BadRequestException('Plugin UI action id or mode is invalid');
          actionIds.add(actionId);
          string(action.label, 'action label', 120);
          if (!sourceIds.has(actionSource) || sourceMethods.get(actionSource) === 'GET') throw new BadRequestException('Plugin UI action must reference a mutation data source');
          if (action.confirmation !== undefined) string(action.confirmation, 'action confirmation', 240);
          if (action.destructive !== undefined && typeof action.destructive !== 'boolean') throw new BadRequestException('Plugin UI action destructive must be boolean');
          if (action.body !== undefined) object(action.body, 'action body');
          if (mode === 'bulk') {
            const selectionSource = string(action.selectionSource, 'action selectionSource', 100);
            if (!sourceIds.has(selectionSource) || sourceMethods.get(selectionSource) !== 'GET') throw new BadRequestException('Plugin UI bulk action selectionSource must reference a GET data source');
            if (action.idField !== undefined && !ID.test(string(action.idField, 'action idField', 100))) throw new BadRequestException('Plugin UI action idField is invalid');
            if (action.idParameter !== undefined && !/^[a-z][a-zA-Z0-9]*$/.test(string(action.idParameter, 'action idParameter', 60))) throw new BadRequestException('Plugin UI action idParameter is invalid');
          }
        });
      }
      if (['metric', 'card', 'chart', 'status'].includes(type)) {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException(`Plugin UI ${type} requires a GET data source`);
        const options = object(component.options, `Plugin UI ${type} options`);
        const dataPath = (key: string, required = false) => {
          if (options[key] === undefined && !required) return;
          if (typeof options[key] !== 'string' || !DATA_PATH.test(options[key] as string)) throw new BadRequestException(`Plugin UI ${type} ${key} is invalid`);
        };
        if (type === 'metric') {
          dataPath('valuePath', true); dataPath('trendPath');
          if (options.format !== undefined && !['number', 'percent', 'currency', 'text'].includes(String(options.format))) throw new BadRequestException('Plugin UI metric format is invalid');
        }
        if (type === 'card') {
          if (!Array.isArray(component.fields) || component.fields.length < 1 || component.fields.length > 20) throw new BadRequestException('Plugin UI card requires 1 to 20 fields');
          component.fields.forEach((candidateField, fieldIndex) => { const field = object(candidateField, `card fields[${fieldIndex}]`); string(field.label, 'card field label', 120); if (typeof field.path !== 'string' || !DATA_PATH.test(field.path)) throw new BadRequestException('Plugin UI card field path is invalid'); });
        }
        if (type === 'chart') {
          if (!['bar', 'line', 'pie'].includes(String(options.chartType))) throw new BadRequestException('Plugin UI chart type is invalid');
          dataPath('itemsPath'); dataPath('categoryPath', true); dataPath('valuePath', true);
          if (options.maximumItems !== undefined && (!Number.isInteger(options.maximumItems) || Number(options.maximumItems) < 1 || Number(options.maximumItems) > 1000)) throw new BadRequestException('Plugin UI chart maximumItems is invalid');
        }
        if (type === 'status') {
          dataPath('valuePath', true);
          if (!Array.isArray(options.states) || options.states.length < 1 || options.states.length > 20) throw new BadRequestException('Plugin UI status requires 1 to 20 states');
          options.states.forEach((candidateState, stateIndex) => { const state = object(candidateState, `status states[${stateIndex}]`); if (!['string', 'number', 'boolean'].includes(typeof state.value)) throw new BadRequestException('Plugin UI status value is invalid'); string(state.label, 'status label', 80); if (!['neutral', 'success', 'warning', 'danger', 'info'].includes(String(state.tone))) throw new BadRequestException('Plugin UI status tone is invalid'); });
        }
      }
      if (type === 'file') {
        if (!source || sourceMethods.get(source) !== 'GET' || sourceParameters.get(source)?.size) throw new BadRequestException('Plugin UI file requires an autoload GET listing source');
        const options = object(component.options, 'Plugin UI file options');
        const uploadSource = string(options.uploadSource, 'file uploadSource', 100);
        const downloadSource = string(options.downloadSource, 'file downloadSource', 100);
        if (!sourceIds.has(uploadSource) || sourceMethods.get(uploadSource) === 'GET' || sourceMethods.get(uploadSource) === 'DELETE') throw new BadRequestException('Plugin UI file uploadSource must be a write data source');
        if (!sourceIds.has(downloadSource) || sourceMethods.get(downloadSource) !== 'GET' || !sourceParameters.get(downloadSource)?.size) throw new BadRequestException('Plugin UI file downloadSource must be a parameterized GET data source');
        const idParameter = string(options.idParameter, 'file idParameter', 60);
        if (!sourceParameters.get(downloadSource)?.has(idParameter)) throw new BadRequestException('Plugin UI file idParameter is not declared by downloadSource');
        if (options.deleteSource !== undefined) { const deleteSource = string(options.deleteSource, 'file deleteSource', 100); if (!sourceIds.has(deleteSource) || sourceMethods.get(deleteSource) !== 'DELETE' || !sourceParameters.get(deleteSource)?.has(idParameter)) throw new BadRequestException('Plugin UI file deleteSource is invalid'); }
        if (!Number.isInteger(options.maxBytes) || Number(options.maxBytes) < 1 || Number(options.maxBytes) > 10 * 1024 * 1024) throw new BadRequestException('Plugin UI file maxBytes is invalid');
        const safeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);
        if (!Array.isArray(options.acceptedTypes) || options.acceptedTypes.length < 1 || options.acceptedTypes.length > safeTypes.size || options.acceptedTypes.some((mime) => typeof mime !== 'string' || !safeTypes.has(mime))) throw new BadRequestException('Plugin UI file acceptedTypes contains an unsafe type');
      }
      if (type === 'print') {
        if (!source || sourceMethods.get(source) === 'DELETE' || sourceParameters.get(source)?.size) throw new BadRequestException('Plugin UI print requires a non-parameterized readable or form-result data source');
        if (!Array.isArray(component.fields) || component.fields.length < 1 || component.fields.length > 30) throw new BadRequestException('Plugin UI print requires 1 to 30 fields');
        component.fields.forEach((candidateField, fieldIndex) => { const field = object(candidateField, `print fields[${fieldIndex}]`); string(field.label, 'print field label', 120); if (typeof field.path !== 'string' || !DATA_PATH.test(field.path)) throw new BadRequestException('Plugin UI print field path is invalid'); });
        const options = object(component.options, 'Plugin UI print options');
        if (options.itemsPath !== undefined && (typeof options.itemsPath !== 'string' || !DATA_PATH.test(options.itemsPath))) throw new BadRequestException('Plugin UI print itemsPath is invalid');
        if (!Array.isArray(options.formats) || options.formats.length < 1 || options.formats.some((format) => !['print', 'csv', 'pdf'].includes(String(format)))) throw new BadRequestException('Plugin UI print formats are invalid');
        if (new Set(options.formats as unknown[]).size !== options.formats.length) throw new BadRequestException('Plugin UI print formats are duplicated');
        if (options.filename !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(String(options.filename))) throw new BadRequestException('Plugin UI print filename is invalid');
        if (options.maximumRows !== undefined && (!Number.isInteger(options.maximumRows) || Number(options.maximumRows) < 1 || Number(options.maximumRows) > 10000)) throw new BadRequestException('Plugin UI print maximumRows is invalid');
      }
      if (type === 'document') {
        if (!source || sourceMethods.get(source) === 'GET' || sourceMethods.get(source) === 'DELETE' || sourceParameters.get(source)?.size) throw new BadRequestException('Plugin UI document requires a non-parameterized mutation-result data source');
        const options = object(component.options, 'Plugin UI document options');
        if (options.documentsPath !== undefined && (typeof options.documentsPath !== 'string' || !DATA_PATH.test(options.documentsPath))) throw new BadRequestException('Plugin UI document documentsPath is invalid');
        if (options.maximumDocuments !== undefined && (!Number.isInteger(options.maximumDocuments) || Number(options.maximumDocuments) < 1 || Number(options.maximumDocuments) > 500)) throw new BadRequestException('Plugin UI document maximumDocuments is invalid');
        if (!Array.isArray(options.formats) || options.formats.length < 1 || options.formats.some((format) => !['print', 'pdf'].includes(String(format)))) throw new BadRequestException('Plugin UI document formats are invalid');
        if (new Set(options.formats as unknown[]).size !== options.formats.length) throw new BadRequestException('Plugin UI document formats are duplicated');
      }
      if (type === 'designer') {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException('Plugin UI designer requires a GET template source');
        const options = object(component.options, 'Plugin UI designer options');
        const saveSource = string(options.saveSource, 'Plugin UI designer saveSource', 100);
        if (!sourceIds.has(saveSource) || !['PUT', 'PATCH'].includes(String(sourceMethods.get(saveSource)))) throw new BadRequestException('Plugin UI designer saveSource must reference a PUT or PATCH data source');
        if (options.maximumElements !== undefined && (!Number.isInteger(options.maximumElements) || Number(options.maximumElements) < 1 || Number(options.maximumElements) > 100)) throw new BadRequestException('Plugin UI designer maximumElements is invalid');
        if (options.assetSource !== undefined) {
          const assetSource = string(options.assetSource, 'Plugin UI designer assetSource', 100);
          if (!sourceIds.has(assetSource) || sourceMethods.get(assetSource) !== 'GET') throw new BadRequestException('Plugin UI designer assetSource must reference a GET data source');
        }
      }
      if (type === 'scanner' || type === 'self-attendance-scanner') {
        if (!source || sourceMethods.get(source) === 'GET' || sourceMethods.get(source) === 'DELETE') throw new BadRequestException('Plugin UI scanner requires a write data source');
        const options = object(component.options, 'Plugin UI scanner options');
        if (!Array.isArray(options.modes) || options.modes.length < 1 || options.modes.some((mode) => !['camera', 'keyboard'].includes(String(mode)))) throw new BadRequestException('Plugin UI scanner modes are invalid');
        if (!ID.test(string(options.field, 'scanner field', 100))) throw new BadRequestException('Plugin UI scanner field is invalid');
        for (const [key, minimum, maximum] of [['minLength', 1, 1000], ['maxLength', 1, 1000], ['debounceMs', 0, 10000]] as const) if (options[key] !== undefined && (!Number.isInteger(options[key]) || Number(options[key]) < minimum || Number(options[key]) > maximum)) throw new BadRequestException(`Plugin UI scanner ${key} is invalid`);
        if (options.minLength !== undefined && options.maxLength !== undefined && Number(options.minLength) > Number(options.maxLength)) throw new BadRequestException('Plugin UI scanner length range is invalid');
        if (options.contextFields !== undefined) {
          if (!Array.isArray(options.contextFields) || options.contextFields.length < 1 || options.contextFields.length > 8) throw new BadRequestException('Plugin UI scanner contextFields must contain 1 to 8 fields');
          const ids = new Set<string>();
          options.contextFields.forEach((candidate, index) => {
            const field = object(candidate, `scanner contextFields[${index}]`); const id = string(field.id, 'scanner context field id', 100);
            if (!ID.test(id) || id === String(options.field) || ids.has(id)) throw new BadRequestException('Plugin UI scanner context field id is invalid or duplicated');
            ids.add(id); string(field.label, 'scanner context field label', 120);
            const fieldType = string(field.type, 'scanner context field type', 20);
            if (!['text', 'number', 'select'].includes(fieldType)) throw new BadRequestException('Plugin UI scanner context field type is invalid');
            if (field.required !== undefined && typeof field.required !== 'boolean') throw new BadRequestException('Plugin UI scanner context field required must be boolean');
            if (fieldType === 'select') {
              if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100) throw new BadRequestException('Plugin UI scanner select field requires 1 to 100 options');
              field.options.forEach((candidateOption) => { const option = object(candidateOption, 'scanner context option'); string(option.label, 'scanner context option label', 120); if (!['string', 'number'].includes(typeof option.value)) throw new BadRequestException('Plugin UI scanner context option value is invalid'); });
            }
          });
        }
      }
      if (type === 'filter') {
        if (source) throw new BadRequestException('Plugin UI filter uses options.sources instead of source');
        const options = object(component.options, 'Plugin UI filter options');
        if (!Array.isArray(options.sources) || options.sources.length < 1 || options.sources.some((sourceId) => typeof sourceId !== 'string' || sourceMethods.get(sourceId) !== 'GET')) throw new BadRequestException('Plugin UI filter sources must reference GET data sources');
        if (new Set(options.sources as string[]).size !== options.sources.length) throw new BadRequestException('Plugin UI filter sources are duplicated');
        if (!Array.isArray(component.fields) || component.fields.length < 1 || component.fields.length > 12) throw new BadRequestException('Plugin UI filter requires 1 to 12 fields');
        const fieldIds = new Set<string>();
        component.fields.forEach((candidateField, fieldIndex) => {
          const field = object(candidateField, `filter fields[${fieldIndex}]`); const fieldId = string(field.id, 'filter field id', 100);
          if (!ID.test(fieldId) || fieldIds.has(fieldId)) throw new BadRequestException('Plugin UI filter field id is invalid or duplicated');
          fieldIds.add(fieldId); string(field.label, 'filter field label', 120);
          const fieldType = string(field.type, 'filter field type', 20);
          if (!['text', 'date', 'number', 'select'].includes(fieldType)) throw new BadRequestException('Plugin UI filter field type is invalid');
          if (fieldType === 'select') {
            if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100) throw new BadRequestException('Plugin UI filter select requires 1 to 100 options');
            field.options.forEach((choice) => { const option = object(choice, 'filter select option'); string(option.label, 'filter option label', 120); if (!['string', 'number'].includes(typeof option.value)) throw new BadRequestException('filter option value is invalid'); });
          }
        });
      }
      if (type === 'study-year-manager') {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException('Plugin UI study-year-manager requires a GET data source');
        const options = object(component.options, 'Plugin UI study-year-manager options');
        for (const key of ['createSource', 'setCurrentSource', 'deleteSource'] as const) {
          const sourceId = string(options[key], `study-year-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) === 'GET') throw new BadRequestException(`Plugin UI study-year-manager ${key} must reference a mutation data source`);
        }
        for (const key of ['editRoute', 'classesRoute'] as const) {
          if (!ROUTE.test(string(options[key], `study-year-manager ${key}`, 100))) throw new BadRequestException(`Plugin UI study-year-manager ${key} is invalid`);
        }
      }
      if (type === 'class-manager') {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException('Plugin UI class-manager requires a GET data source');
        const options = object(component.options, 'Plugin UI class-manager options');
        for (const key of ['studyYearsSource', 'teachersSource', 'classAdminsSource'] as const) {
          const sourceId = string(options[key], `class-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) !== 'GET') throw new BadRequestException(`Plugin UI class-manager ${key} must reference a GET data source`);
        }
        for (const key of ['createSource', 'deleteSource', 'addStudentSource', 'removeStudentSource', 'bulkUploadSource'] as const) {
          const sourceId = string(options[key], `class-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) === 'GET') throw new BadRequestException(`Plugin UI class-manager ${key} must reference a mutation data source`);
        }
        if (options.createStudentSource !== undefined) {
          const sourceId = string(options.createStudentSource, 'class-manager createStudentSource', 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) === 'GET') throw new BadRequestException('Plugin UI class-manager createStudentSource must reference a mutation data source');
        }
        for (const key of ['studentsSource', 'availableStudentsSource'] as const) {
          const sourceId = string(options[key], `class-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) !== 'GET') throw new BadRequestException(`Plugin UI class-manager ${key} must reference a GET data source`);
        }
        for (const key of ['detailRoute', 'editRoute', 'attendanceRoute'] as const) {
          if (!ROUTE.test(string(options[key], `class-manager ${key}`, 100))) throw new BadRequestException(`Plugin UI class-manager ${key} is invalid`);
        }
      }
      if (type === 'officer-manager') {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException('Plugin UI officer-manager requires a GET data source');
        const options = object(component.options, 'Plugin UI officer-manager options');
        const departmentsSource = string(options.departmentsSource, 'officer-manager departmentsSource', 100);
        if (!sourceIds.has(departmentsSource) || sourceMethods.get(departmentsSource) !== 'GET') throw new BadRequestException('Plugin UI officer-manager departmentsSource must reference a GET data source');
        for (const key of ['createSource', 'deactivateSource'] as const) {
          const sourceId = string(options[key], `officer-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) === 'GET') throw new BadRequestException(`Plugin UI officer-manager ${key} must reference a mutation data source`);
        }
        for (const key of ['editRoute', 'departmentsRoute'] as const) {
          if (!ROUTE.test(string(options[key], `officer-manager ${key}`, 100))) throw new BadRequestException(`Plugin UI officer-manager ${key} is invalid`);
        }
      }
      if (type === 'session-manager') {
        if (!source || sourceMethods.get(source) !== 'GET') throw new BadRequestException('Plugin UI session-manager requires a GET data source');
        const options = object(component.options, 'Plugin UI session-manager options');
        const settingsSource = string(options.settingsSource, 'session-manager settingsSource', 100);
        if (!sourceIds.has(settingsSource) || sourceMethods.get(settingsSource) !== 'GET') throw new BadRequestException('Plugin UI session-manager settingsSource must reference a GET data source');
        for (const key of ['saveSessionSource', 'saveSettingsSource'] as const) {
          const sourceId = string(options[key], `session-manager ${key}`, 100);
          if (!sourceIds.has(sourceId) || sourceMethods.get(sourceId) === 'GET') throw new BadRequestException(`Plugin UI session-manager ${key} must reference a mutation data source`);
        }
      }
      return {
        id: componentId, type,
        ...(component.title === undefined ? {} : { title: string(component.title, 'component title', 200) }),
        ...(source ? { source } : {}),
        ...(component.fields ? { fields: component.fields as Array<Record<string, unknown>> } : {}),
        ...(component.options ? { options: component.options as Record<string, unknown> } : {}),
      };
    });
    let realtime: Array<{ event: string; refreshSources: string[] }> | undefined;
    if (page.realtime !== undefined) {
      if (!Array.isArray(page.realtime) || page.realtime.length < 1 || page.realtime.length > 20) throw new BadRequestException('Plugin UI realtime must contain 1 to 20 subscriptions');
      const events = new Set<string>();
      realtime = page.realtime.map((candidateSubscription, subscriptionIndex) => {
        const subscription = object(candidateSubscription, `realtime[${subscriptionIndex}]`);
        const event = string(subscription.event, 'realtime event', 120);
        if (!/^[a-z0-9][a-z0-9:._-]*$/.test(event) || event.startsWith('plugin:') || events.has(event)) throw new BadRequestException('Plugin UI realtime event is invalid or duplicated');
        events.add(event);
        if (!Array.isArray(subscription.refreshSources) || subscription.refreshSources.length < 1 || subscription.refreshSources.some((sourceId) => typeof sourceId !== 'string' || sourceMethods.get(sourceId) !== 'GET' || sourceParameters.get(sourceId)?.size)) throw new BadRequestException('Plugin UI realtime refreshSources must reference autoload GET sources');
        return { event, refreshSources: [...new Set(subscription.refreshSources as string[])] };
      });
    }
    let translations: Record<string, Record<string, string>> | undefined;
    let defaultLanguage: string | undefined;
    if (page.translations !== undefined) {
      const source = object(page.translations, 'Plugin UI translations'); const languages = Object.entries(source);
      if (languages.length < 1 || languages.length > 20) throw new BadRequestException('Plugin UI translations language count is invalid');
      translations = {};
      for (const [language, candidateMessages] of languages) {
        if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw new BadRequestException('Plugin UI translation language is invalid');
        const messages = object(candidateMessages, `translations.${language}`); const entries = Object.entries(messages);
        if (entries.length > 500) throw new BadRequestException('Plugin UI translation message count is invalid');
        translations[language] = {};
        for (const [key, message] of entries) { if (!/^[a-z0-9][a-z0-9._-]*$/.test(key) || typeof message !== 'string' || !message.trim() || message.length > 500) throw new BadRequestException('Plugin UI translation entry is invalid'); translations[language][key] = message.trim(); }
      }
      defaultLanguage = string(page.defaultLanguage, 'Plugin UI defaultLanguage', 10);
      if (!translations[defaultLanguage]) throw new BadRequestException('Plugin UI defaultLanguage has no translations');
    } else if (page.defaultLanguage !== undefined) throw new BadRequestException('Plugin UI defaultLanguage requires translations');
    return { id, title: string(page.title, `pages[${pageIndex}].title`, 200), routePath, permission, parameters, dataSources, components, ...(realtime ? { realtime } : {}), ...(translations ? { translations, defaultLanguage } : {}) };
  });
  return { schemaVersion: 2, kind: 'declarative-ui', pages };
}
