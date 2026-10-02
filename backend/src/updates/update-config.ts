import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface UpdateRepositoryConfig {
  url: string;
  publicKey: string;
  keyId: string;
  publicKeys: Record<string, string>;
  channel: 'stable' | 'beta';
  maximumArtifactBytes: number;
  indexTimeoutMs: number;
  artifactTimeoutMs: number;
}

export function readUpdateRepositoryConfig(env: NodeJS.ProcessEnv = process.env): UpdateRepositoryConfig | null {
  const rawUrl = env.MARKETPLACE_URL?.trim();
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MARKETPLACE_URL must be an HTTP(S) origin without a path');
  }
  if ((env.NODE_ENV || 'development') === 'production' && url.protocol !== 'https:') {
    throw new Error('MARKETPLACE_URL must use HTTPS in production');
  }
  const keyFile = env.UPDATE_REPOSITORY_PUBLIC_KEY_FILE?.trim();
  const inlineKey = env.UPDATE_REPOSITORY_PUBLIC_KEY?.replace(/\\n/g, '\n').trim();
  const resolvedKeyFile = keyFile ? path.resolve(keyFile) : null;
  const publicKey = resolvedKeyFile && existsSync(resolvedKeyFile) ? readFileSync(resolvedKeyFile, 'utf8') : inlineKey;
  if (!publicKey?.includes('PUBLIC KEY')) throw new Error('A pinned update repository public key is required when MARKETPLACE_URL is configured');
  const keyId = env.UPDATE_REPOSITORY_KEY_ID?.trim();
  if (!keyId || !/^[a-zA-Z0-9._-]{1,100}$/.test(keyId)) throw new Error('UPDATE_REPOSITORY_KEY_ID is required and invalid');
  const channel = env.UPDATE_CHANNEL?.trim().toLowerCase() || 'stable';
  if (!['stable', 'beta'].includes(channel)) throw new Error('UPDATE_CHANNEL must be stable or beta');
  const maximumArtifactBytes = Number(env.UPDATE_MAX_ARTIFACT_BYTES || 50 * 1024 * 1024);
  if (!Number.isInteger(maximumArtifactBytes) || maximumArtifactBytes < 1 || maximumArtifactBytes > 250 * 1024 * 1024) {
    throw new Error('UPDATE_MAX_ARTIFACT_BYTES must be between 1 and 262144000');
  }
  let publicKeys: Record<string, string> = { [keyId]: publicKey };
  if (env.UPDATE_REPOSITORY_PUBLIC_KEYS_JSON?.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.UPDATE_REPOSITORY_PUBLIC_KEYS_JSON); } catch { throw new Error('UPDATE_REPOSITORY_PUBLIC_KEYS_JSON must be valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('UPDATE_REPOSITORY_PUBLIC_KEYS_JSON must be a key object');
    publicKeys = { ...publicKeys, ...(parsed as Record<string, string>) };
  }
  for (const [id, key] of Object.entries(publicKeys)) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(id) || typeof key !== 'string' || !key.replace(/\\n/g, '\n').includes('PUBLIC KEY')) {
      throw new Error('Every update repository key must have a valid id and PEM public key');
    }
    publicKeys[id] = key.replace(/\\n/g, '\n');
  }
  const indexTimeoutMs = boundedInteger(env.UPDATE_INDEX_TIMEOUT_MS, 10_000, 100, 120_000, 'UPDATE_INDEX_TIMEOUT_MS');
  const artifactTimeoutMs = boundedInteger(env.UPDATE_ARTIFACT_TIMEOUT_MS, 30_000, 100, 600_000, 'UPDATE_ARTIFACT_TIMEOUT_MS');
  return { url: url.origin, publicKey, keyId, publicKeys, channel: channel as 'stable' | 'beta', maximumArtifactBytes, indexTimeoutMs, artifactTimeoutMs };
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const value = Number(raw || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}
