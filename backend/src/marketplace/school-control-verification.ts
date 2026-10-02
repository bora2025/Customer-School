import { verify } from 'crypto';
import { canonicalJson } from './canonical-json';

export interface SchoolControlPayload {
  schemaVersion: number;
  generation: number;
  installationId: string;
  issuedAt: string;
  audience: string;
  keyId: string;
  access: 'ACTIVE' | 'SUSPENDED';
  reason?: string | null;
  warnings: unknown[];
  billing?: unknown;
}

export function verifySchoolControl(
  token: unknown,
  publicKeys: ReadonlyMap<string, string>,
  expected: { installationId: string; now?: Date; clockSkewMs?: number },
): SchoolControlPayload {
  if (!token || typeof token !== 'object') throw new Error('School control document is malformed');
  const envelope = token as any;
  const payload = envelope.payload as SchoolControlPayload;
  const signature = envelope.signature;
  if (!payload || !signature || signature.algorithm !== 'ed25519' || signature.keyId !== payload.keyId || typeof signature.value !== 'string') throw new Error('School control signature is malformed');
  const publicKey = publicKeys.get(payload.keyId);
  if (!publicKey) throw new Error('School control signing key is not trusted');
  let valid = false;
  try { valid = verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature.value, 'base64')); } catch { /* invalid */ }
  if (!valid) throw new Error('School control signature is invalid');
  if (payload.schemaVersion !== 1 || payload.audience !== 'wattanam-school-control') throw new Error('School control document version or audience is invalid');
  if (payload.installationId !== expected.installationId) throw new Error('School control document belongs to another installation');
  if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) throw new Error('School control generation is invalid');
  if (!['ACTIVE', 'SUSPENDED'].includes(payload.access) || !Array.isArray(payload.warnings)) throw new Error('School control state is invalid');
  const issuedAt = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issuedAt)) throw new Error('School control issuedAt is invalid');
  const skew = expected.clockSkewMs ?? 5 * 60_000;
  if (issuedAt > (expected.now ?? new Date()).getTime() + skew) throw new Error('School control document is issued in the future');
  return payload;
}
