import type { FrontendDistribution } from './navigation-registry';
import coreRoutes from '../core-routes.json' with { type: 'json' };

const CORE_EXACT_ROUTES = new Set(coreRoutes.exact);
const CORE_ROUTE_PREFIXES = coreRoutes.prefixes;

export function isRouteAvailable(pathname: string, distribution: FrontendDistribution): boolean {
  if (distribution === 'legacy-full') return true;
  const normalized = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  if (CORE_EXACT_ROUTES.has(normalized)) return true;
  if (CORE_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  // Public assets are not application modules and must remain available to the core shell.
  if (/\.[a-z0-9]{2,8}$/i.test(normalized)) return true;
  return false;
}

export const coreRoutePolicy = {
  exact: [...CORE_EXACT_ROUTES],
  prefixes: [...CORE_ROUTE_PREFIXES],
} as const;
