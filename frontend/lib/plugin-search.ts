import { apiFetch } from './api';

export interface PluginSearchResult {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
  href: string;
  group?: string;
}

export interface PluginSearchGroup {
  key: string;
  label: string;
  results: PluginSearchResult[];
}

import { pluginLabel } from './dashboard-extensions';
export { pluginLabel };

export async function searchPlugins(query: string, signal?: AbortSignal): Promise<PluginSearchResult[]> {
  const response = await apiFetch(`/api/plugin-api/search?q=${encodeURIComponent(query)}`, { signal });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error((body && body.message) || 'Search failed');
  return Array.isArray(body) ? body : [];
}

/** Results grouped by their kind (Students, Staff…), else by plugin; groups keep the providers' ranking. */
export function groupResults(results: PluginSearchResult[]): PluginSearchGroup[] {
  const groups = new Map<string, PluginSearchGroup>();
  for (const result of results) {
    const label = result.group || pluginLabel(result.pluginId);
    const key = label.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label, results: [] });
    groups.get(key)!.results.push(result);
  }
  return [...groups.values()];
}

/** Splits text into parts, marking those that match any word of the query (case-insensitive). */
export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const terms = query.trim().split(/\s+/).filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length || !text) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  // With one capturing group, split() puts the matches at the odd positions.
  return text.split(pattern).map((part, index) => ({ text: part, match: index % 2 === 1 })).filter((part) => part.text !== '');
}

const RECENT_KEY = 'core-search-recent';
export function recentSearches(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 6) : [];
  } catch { return []; }
}
export function rememberSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recentSearches().filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 6))); } catch { /* no storage */ }
}
export function forgetSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* no storage */ }
}
