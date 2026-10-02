import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PluginContractError, PluginRouteDefinition, PluginRouteRequest } from './plugin-sdk';
import { PluginPermissionsService } from './plugin-permissions.service';
import { parsePluginUiBundle, PluginUiPage } from './plugin-ui-schema';
import { PluginResourceQuotaService } from './plugin-resource-quota.service';
import { PluginEntitlementPolicyService } from './plugin-entitlement-policy.service';

export interface PermissionExtension { pluginId: string; id: string; label: string; description?: string }
export interface NavigationExtension {
  pluginId: string;
  id: string;
  label: string;
  href: string;
  permission?: string;
  dashboard?: { title?: string; description: string; priority?: number } | false;
}
export type PageExtension =
  | { pluginId: string; schemaVersion: 1; id: string; title: string; routePath: string; kind: 'json-settings' }
  | (PluginUiPage & { pluginId: string; schemaVersion: 2; kind: 'declarative-ui' });
export interface PluginSearchResult { pluginId: string; id: string; title: string; description?: string; href: string }

@Injectable()
export class PluginExtensionsService {
  private readonly routes = new Map<string, PluginRouteDefinition>();
  private readonly permissions = new Map<string, PermissionExtension>();
  private readonly navigation = new Map<string, NavigationExtension>();
  private readonly pages = new Map<string, PageExtension>();

  constructor(
    private readonly grants: PluginPermissionsService,
    private readonly audit: AuditService,
    @Optional() private readonly quota?: PluginResourceQuotaService,
    @Optional() private readonly entitlements?: PluginEntitlementPolicyService,
  ) {}

  registerRoute(pluginId: string, declaredPermissions: Set<string>, definition: PluginRouteDefinition) {
    const method = definition.method?.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new BadRequestException('Plugin route method is unsupported');
    const segments = definition.path.split('/');
    if (!definition.path || definition.path.length > 240 || segments.length > 12 || definition.path.includes('//') || segments.some((segment) => !/^(?:[a-z0-9][a-z0-9_-]*|:[a-z][a-zA-Z0-9]*)$/.test(segment))) throw new BadRequestException('Plugin route path is invalid');
    const parameterNames = segments.filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1));
    if (new Set(parameterNames).size !== parameterNames.length) throw new BadRequestException('Plugin route parameter names must be unique');
    if (!declaredPermissions.has(definition.permission)) throw new BadRequestException('Plugin route permission is not declared in the manifest');
    if (typeof definition.handler !== 'function') throw new BadRequestException('Plugin route handler is required');
    if (definition.contract) {
      if (!/^\d+\.\d+$/.test(definition.contract.version) || !definition.contract.response?.parse || !definition.contract.errors || Object.entries(definition.contract.errors).some(([code, value]) => !/^[A-Z][A-Z0-9_]{2,63}$/.test(code) || !Number.isInteger(value.status) || value.status < 400 || value.status > 599 || !value.message?.trim())) throw new BadRequestException('Plugin route contract is invalid');
    }
    const key = `${pluginId}:${method}:${definition.path}`;
    if (this.routes.has(key)) throw new BadRequestException(`Plugin route is already registered: ${method} ${definition.path}`);
    const shape = segments.map((segment) => segment.startsWith(':') ? ':' : segment).join('/');
    if ([...this.routes.keys()].some((existing) => {
      const [existingPlugin, existingMethod, ...path] = existing.split(':');
      return existingPlugin === pluginId && existingMethod === method && path.join(':').split('/').map((segment) => segment.startsWith(':') ? ':' : segment).join('/') === shape;
    })) throw new BadRequestException(`Plugin route conflicts with an existing parameterized route: ${method} ${definition.path}`);
    this.routes.set(key, { ...definition, method: method as any });
    return () => this.routes.delete(key);
  }

  async dispatch(pluginId: string, request: PluginRouteRequest) {
    this.quota?.consume(pluginId, 'request');
    if (!request.path || request.path.length > 240 || request.path.includes('//') || request.path.split('/').some((segment) => !/^[a-zA-Z0-9._~-]{1,160}$/.test(segment) || segment === '..')) throw new NotFoundException('Plugin route not found');
    let definition = this.routes.get(`${pluginId}:${request.method}:${request.path}`);
    let params: Record<string, string> = {};
    if (!definition) {
      const actual = request.path.split('/');
      for (const [key, candidate] of this.routes) {
        if (!key.startsWith(`${pluginId}:${request.method}:`) || !candidate.path.includes(':')) continue;
        const template = candidate.path.split('/');
        if (template.length !== actual.length) continue;
        const captured: Record<string, string> = {};
        if (!template.every((segment, index) => {
          if (!segment.startsWith(':')) return segment === actual[index];
          captured[segment.slice(1)] = actual[index]; return true;
        })) continue;
        definition = candidate; params = captured; break;
      }
    }
    if (!definition) throw new NotFoundException('Plugin route not found');
    request = { ...request, params };
    if (definition.contract?.request) {
      try {
        request = {
          ...request,
          params: definition.contract.request.params?.parse(request.params) ?? request.params,
          query: definition.contract.request.query?.parse(request.query) ?? request.query,
          body: definition.contract.request.body?.parse(request.body) ?? request.body,
        };
      } catch { throw new BadRequestException('Plugin request does not match its declared contract'); }
    }
    const auditBase = {
      actorId: request.principal.userId, actorRole: request.principal.role, actorEmail: request.principal.email,
      action: 'PLUGIN_ROUTE', resource: 'PLUGIN', resourceId: pluginId,
      method: request.method, path: `${pluginId}/${request.path}`,
      metadata: { permission: definition.permission },
    };
    const granted = await this.grants.isGranted(pluginId, definition.permission, request.principal.role);
    if (!granted) {
      void this.audit.log({ ...auditBase, success: false, errorMessage: `Permission denied: ${definition.permission}` });
      throw new ForbiddenException(`Missing plugin permission: ${definition.permission}`);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await this.entitlements?.assertRouteAllowed(pluginId, request.method);
      let result = await Promise.race([
        Promise.resolve(definition.handler(request)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plugin route timed out')), 10_000); timer.unref(); }),
      ]);
      if (definition.contract) {
        try { result = definition.contract.response.parse(result); }
        catch { throw new Error('Plugin response does not match its declared contract'); }
      }
      void this.audit.log({ ...auditBase, success: true });
      return result;
    } catch (error) {
      void this.audit.log({ ...auditBase, success: false, errorMessage: error instanceof Error ? error.message : String(error) });
      if (error instanceof PluginContractError && definition.contract) {
        const declared = definition.contract.errors[error.code];
        if (!declared) throw new Error('Plugin returned an undeclared error code');
        throw new HttpException({ code: error.code, message: declared.message }, declared.status);
      }
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }

  registerPermissions(pluginId: string, declared: Set<string>, definitions: PermissionExtension[]) {
    const keys: string[] = [];
    for (const definition of definitions) {
      if (!declared.has(definition.id) || !definition.label?.trim()) throw new BadRequestException(`Plugin permission is not declared: ${definition.id}`);
      const key = `${pluginId}:${definition.id}`;
      if (this.permissions.has(key)) throw new BadRequestException(`Plugin permission is already registered: ${definition.id}`);
      this.permissions.set(key, { ...definition, pluginId, label: definition.label.trim() });
      keys.push(key);
    }
    return () => keys.forEach((key) => this.permissions.delete(key));
  }

  registerNavigation(pluginId: string, declared: Set<string>, entries: NavigationExtension[]) {
    const keys: string[] = [];
    for (const entry of entries) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(entry.id) || !entry.label?.trim() || !entry.href.startsWith(`/plugins/${pluginId}/`) || entry.href.includes('..')) throw new BadRequestException('Plugin navigation entry is invalid');
      if (entry.permission && !declared.has(entry.permission)) throw new BadRequestException('Plugin navigation permission is not declared');
      if (entry.dashboard && (
        !entry.dashboard.description?.trim()
        || entry.dashboard.description.length > 240
        || (entry.dashboard.title !== undefined && (!entry.dashboard.title.trim() || entry.dashboard.title.length > 100))
        || (entry.dashboard.priority !== undefined && (!Number.isInteger(entry.dashboard.priority) || entry.dashboard.priority < 0 || entry.dashboard.priority > 1000))
      )) throw new BadRequestException('Plugin dashboard contribution is invalid');
      const key = `${pluginId}:${entry.id}`;
      if (this.navigation.has(key)) throw new BadRequestException(`Plugin navigation is already registered: ${entry.id}`);
      this.navigation.set(key, { ...entry, pluginId, label: entry.label.trim() });
      keys.push(key);
    }
    return () => keys.forEach((key) => this.navigation.delete(key));
  }

  registerPage(pluginId: string, value: unknown, declaredPermissions = new Set<string>()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Plugin frontend entry must be an object');
    const page = value as Record<string, unknown>;
    if (page.schemaVersion === 2) {
      const bundle = parsePluginUiBundle(value, pluginId, declaredPermissions);
      const keys: string[] = [];
      for (const descriptor of bundle.pages) {
        const key = `${pluginId}:${descriptor.id}`;
        if (this.pages.has(key)) { keys.forEach((registered) => this.pages.delete(registered)); throw new BadRequestException(`Plugin page is already registered: ${descriptor.id}`); }
        this.pages.set(key, { ...descriptor, pluginId, schemaVersion: 2, kind: 'declarative-ui' });
        keys.push(key);
      }
      return () => keys.forEach((key) => this.pages.delete(key));
    }
    if (page.schemaVersion !== 1 || page.kind !== 'json-settings' || typeof page.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(page.id) || typeof page.title !== 'string' || !page.title.trim() || typeof page.routePath !== 'string' || !/^[a-z0-9][a-z0-9/_-]*$/.test(page.routePath)) {
      throw new BadRequestException('Plugin frontend page descriptor is invalid');
    }
    const key = `${pluginId}:${page.id}`;
    if (this.pages.has(key)) throw new BadRequestException(`Plugin page is already registered: ${page.id}`);
    this.pages.set(key, { pluginId, schemaVersion: 1, id: page.id, title: page.title.trim(), routePath: page.routePath, kind: 'json-settings' });
    return () => this.pages.delete(key);
  }

  list() {
    return {
      sdkVersion: '1.1.0',
      permissions: [...this.permissions.values()],
      navigation: [...this.navigation.values()],
      pages: [...this.pages.values()],
    };
  }

  /**
   * The non-admin counterpart to list(): navigation/pages filtered to what
   * `role` actually has access to, so any authenticated user can discover
   * their own plugin nav (list() itself stays SUPER_ADMIN-only, since it's
   * an unfiltered admin overview). An entry with no declared `permission`
   * is always visible; one with a permission requires a grant, same rule
   * dispatch() itself enforces.
   */
  async listForPrincipal(role: string | undefined) {
    const allowed = async (permission: string | undefined, pluginId: string) => !permission || this.grants.isGranted(pluginId, permission, role);
    const navigation = await this.filterAsync([...this.navigation.values()], (entry) => allowed(entry.permission, entry.pluginId));
    const pages = await this.filterAsync([...this.pages.values()], async (page) => page.schemaVersion === 1 || allowed(page.permission, page.pluginId));
    return { navigation, pages };
  }

  /**
   * SDK 1.0 search convention: an active plugin may register a permission-gated GET `search`
   * route. Reusing dispatch preserves its grant, timeout and audit guarantees without adding a
   * new frozen capability. Bad provider output is discarded at the namespace boundary.
   */
  async searchForPrincipal(query: string, principal: PluginRouteRequest['principal']): Promise<PluginSearchResult[]> {
    const q = query.trim();
    if (q.length < 2 || q.length > 100) throw new BadRequestException('Search query must be between 2 and 100 characters');
    const providers = [...this.routes.keys()]
      .filter((key) => key.endsWith(':GET:search'))
      .map((key) => key.slice(0, -':GET:search'.length));
    const batches = await Promise.all(providers.map(async (pluginId) => {
      try {
        const value = await this.dispatch(pluginId, {
          method: 'GET', path: 'search', params: {}, query: { q }, body: undefined, principal,
        });
        if (!Array.isArray(value)) return [];
        return value.slice(0, 25).flatMap((candidate): PluginSearchResult[] => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
          const item = candidate as Record<string, unknown>;
          if (typeof item.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(item.id)) return [];
          if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200) return [];
          if (typeof item.href !== 'string' || !item.href.startsWith(`/plugins/${pluginId}/`) || item.href.includes('..')) return [];
          if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 500)) return [];
          return [{ pluginId, id: item.id, title: item.title.trim(), href: item.href, ...(item.description ? { description: item.description as string } : {}) }];
        });
      } catch {
        // One unavailable or unauthorized provider must not break results from other plugins.
        return [];
      }
    }));
    return batches.flat();
  }

  private async filterAsync<T>(items: T[], predicate: (item: T) => Promise<boolean>): Promise<T[]> {
    const keep = await Promise.all(items.map(predicate));
    return items.filter((_, index) => keep[index]);
  }

  clear(pluginId: string) {
    for (const map of [this.routes, this.permissions, this.navigation, this.pages]) {
      for (const key of map.keys()) if (key.startsWith(`${pluginId}:`)) map.delete(key);
    }
  }
}
