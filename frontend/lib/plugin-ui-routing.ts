export type PluginRouteParameter = { name: string; type: 'uuid' | 'integer' | 'slug' | 'string'; maximumLength?: number };

export type PluginUiPageDescriptor = {
  pluginId: string;
  schemaVersion: 2;
  kind: 'declarative-ui';
  id: string;
  title: string;
  routePath: string;
  parameters: PluginRouteParameter[];
  dataSources: Array<{ id: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; permission: string; parameters?: string[]; autoload?: boolean }>;
  components: Array<Record<string, unknown>>;
  realtime?: Array<{ event: string; refreshSources: string[] }>;
  defaultLanguage?: string;
  translations?: Record<string, Record<string, string>>;
};

const validators: Record<PluginRouteParameter['type'], (value: string) => boolean> = {
  uuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  integer: (value) => /^(?:0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)),
  slug: (value) => /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(value),
  string: (value) => /^[a-zA-Z0-9._~-]+$/.test(value),
};

export function matchPluginPage(pages: PluginUiPageDescriptor[], routePath: string) {
  const actual = routePath.split('/');
  const ordered = [...pages].sort((a, b) => b.routePath.split('/').filter((part) => !part.startsWith(':')).length - a.routePath.split('/').filter((part) => !part.startsWith(':')).length);
  for (const page of ordered) {
    const template = page.routePath.split('/');
    if (template.length !== actual.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < template.length; index += 1) {
      if (!template[index].startsWith(':')) { if (template[index] !== actual[index]) matches = false; continue; }
      const name = template[index].slice(1);
      const declaration = page.parameters.find((item) => item.name === name);
      const value = actual[index];
      if (!declaration || value.length > (declaration.maximumLength ?? 160) || !validators[declaration.type](value)) { matches = false; break; }
      params[name] = value;
    }
    if (matches) return { page, params };
  }
  return null;
}

export function resolvePluginSourcePath(path: string, params: Record<string, string>): string {
  return path.split('/').map((segment) => {
    if (!segment.startsWith(':')) return encodeURIComponent(segment);
    const value = params[segment.slice(1)];
    if (!value) throw new Error(`Missing route parameter: ${segment.slice(1)}`);
    return encodeURIComponent(value);
  }).join('/');
}
