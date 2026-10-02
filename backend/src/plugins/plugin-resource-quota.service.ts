import { Injectable } from '@nestjs/common';

type Resource = 'request' | 'sql' | 'job' | 'realtime';

/** Per-process fast guard; durable notification usage remains database-backed. */
@Injectable()
export class PluginResourceQuotaService {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private readonly concurrent = new Map<string, number>();

  consume(pluginId: string, resource: Exclude<Resource, 'job'>, now = Date.now()) {
    const limit = this.limit(resource);
    const key = `${pluginId}:${resource}`;
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= 60_000) { window = { startedAt: now, count: 0 }; this.windows.set(key, window); }
    window.count += 1;
    if (window.count > limit) throw new Error(`${pluginId} exceeded its ${resource} quota (${limit}/minute)`);
    return { count: window.count, limit };
  }

  enterJob(pluginId: string) {
    const limit = this.limit('job');
    const count = (this.concurrent.get(pluginId) || 0) + 1;
    if (count > limit) throw new Error(`${pluginId} exceeded its concurrent job quota (${limit})`);
    this.concurrent.set(pluginId, count);
    return () => { const next = (this.concurrent.get(pluginId) || 1) - 1; if (next <= 0) this.concurrent.delete(pluginId); else this.concurrent.set(pluginId, next); };
  }

  private limit(resource: Resource) {
    const defaults = { request: 600, sql: 300, job: 2, realtime: 600 };
    const name = `PLUGIN_${resource.toUpperCase()}_QUOTA_PER_${resource === 'job' ? 'PLUGIN' : 'MINUTE'}`;
    const value = Number(process.env[name] || defaults[resource]);
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw new Error(`${name} must be a positive bounded integer`);
    return value;
  }
}
