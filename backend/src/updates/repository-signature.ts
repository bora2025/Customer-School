import { verify } from 'crypto';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

export function canonicalRepositoryJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function verifyRepositoryEnvelope(value: unknown, publicKeys: Record<string, string> | string, expectedKeyId?: string): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Repository response is not an envelope');
  const envelope = value as Record<string, any>;
  if (!envelope.payload || !envelope.signature) {
    throw new Error('Repository signature metadata is invalid');
  }
  const trusted = typeof publicKeys === 'string' ? { [expectedKeyId || '']: publicKeys } : publicKeys;
  const signatures = Array.isArray(envelope.signatures) ? envelope.signatures : [envelope.signature];
  const bytes = Buffer.from(canonicalRepositoryJson(envelope.payload));
  const valid = signatures.some((signature: any) => {
    if (!signature || signature.algorithm !== 'ed25519' || typeof signature.keyId !== 'string' || typeof signature.value !== 'string') return false;
    const key = trusted[signature.keyId];
    if (!key) return false;
    try { return verify(null, bytes, key, Buffer.from(signature.value, 'base64')); } catch { return false; }
  });
  if (!valid) throw new Error('Repository metadata signature is invalid');
  if (envelope.payload.schemaVersion !== 1 || !Array.isArray(envelope.payload.pluginReleases) || !Array.isArray(envelope.payload.coreReleases) || !Array.isArray(envelope.payload.advisories)
    || (envelope.payload.revokedPublisherKeys !== undefined && (!Array.isArray(envelope.payload.revokedPublisherKeys) || envelope.payload.revokedPublisherKeys.some((entry: unknown) => typeof entry !== 'string' || !/^[a-zA-Z0-9._-]{1,100}:[a-zA-Z0-9._-]{1,100}$/.test(entry))))) {
    throw new Error('Repository metadata schema is unsupported');
  }
  return envelope.payload;
}
