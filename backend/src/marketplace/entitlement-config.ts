import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface EntitlementConfig {
  publicKeys: ReadonlyMap<string, string>;
}

export function readEntitlementConfig(env: NodeJS.ProcessEnv = process.env): EntitlementConfig | null {
  const keyFile = env.ENTITLEMENT_PUBLIC_KEY_FILE?.trim();
  const inlineKey = env.ENTITLEMENT_PUBLIC_KEY?.replace(/\\n/g, '\n').trim();
  const resolvedKeyFile = keyFile ? path.resolve(keyFile) : null;
  const publicKey = resolvedKeyFile && existsSync(resolvedKeyFile) ? readFileSync(resolvedKeyFile, 'utf8') : inlineKey;
  const keyId = env.ENTITLEMENT_KEY_ID?.trim();
  if (!publicKey && !keyId) return null;
  if (!publicKey?.includes('PUBLIC KEY')) throw new Error('A pinned entitlement public key is required when ENTITLEMENT_KEY_ID is configured');
  if (!keyId || !/^[a-zA-Z0-9._-]{1,100}$/.test(keyId)) throw new Error('ENTITLEMENT_KEY_ID is required and invalid');
  const publicKeys = new Map<string, string>([[keyId, publicKey]]);
  if (env.ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON?.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON); }
    catch { throw new Error('ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON must be valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON must be a key object');
    for (const [id, key] of Object.entries(parsed as Record<string, string>)) {
      const normalizedKey = typeof key === 'string' ? key.replace(/\\n/g, '\n') : '';
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(id) || !normalizedKey.includes('PUBLIC KEY')) {
        throw new Error('Every entitlement secondary key must have a valid id and PEM public key');
      }
      publicKeys.set(id, normalizedKey);
    }
  }
  return { publicKeys };
}
