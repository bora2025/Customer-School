#!/usr/bin/env node
'use strict';

// Scheduled monitor: reads the school's Prometheus metrics through its public gateway and fails
// when encrypted off-site backup is not configured or the newest off-site recovery set is older
// than the allowed age (default 26h = daily 02:00 backup + 2h slack).
//
// Env: SCHOOL_GATEWAY_URL (https origin), METRICS_TOKEN, optional MAX_BACKUP_AGE_HOURS.

const DEFAULT_MAX_AGE_HOURS = 26;

function gauge(metrics, name) {
  const line = metrics.split('\n').find((row) => row.startsWith(`${name} `) || row.startsWith(`${name}{`));
  if (!line) return undefined;
  const raw = line.trim().split(/\s+/).pop();
  if (raw === '+Inf' || raw === 'Inf') return Infinity;
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

function evaluate(metrics, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  const configured = gauge(metrics, 'offsite_backup_configured');
  const age = gauge(metrics, 'offsite_backup_age_seconds');
  if (configured === undefined || age === undefined) return { ok: false, reason: 'off-site backup metrics are missing (school release too old?)' };
  if (configured !== 1) return { ok: false, reason: 'encrypted off-site backup is not configured' };
  if (!Number.isFinite(age)) return { ok: false, reason: 'no complete off-site backup exists (or the bucket is unreadable)' };
  const hours = age / 3600;
  if (hours > maxAgeHours) return { ok: false, reason: `newest off-site backup is ${hours.toFixed(1)}h old (limit ${maxAgeHours}h)` };
  return { ok: true, reason: `newest off-site backup is ${hours.toFixed(1)}h old` };
}

async function main(env = process.env) {
  const origin = env.SCHOOL_GATEWAY_URL && env.SCHOOL_GATEWAY_URL.trim();
  const token = env.METRICS_TOKEN && env.METRICS_TOKEN.trim();
  if (!origin || !token) throw new Error('SCHOOL_GATEWAY_URL and METRICS_TOKEN are required');
  const url = new URL('/api/metrics', origin);
  if (url.protocol !== 'https:') throw new Error('SCHOOL_GATEWAY_URL must be https');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`metrics request failed: HTTP ${response.status}`);
  const result = evaluate(await response.text(), Number(env.MAX_BACKUP_AGE_HOURS || DEFAULT_MAX_AGE_HOURS));
  process.stdout.write(`${JSON.stringify({ status: result.ok ? 'passed' : 'failed', reason: result.reason })}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}

module.exports = { evaluate, gauge };
