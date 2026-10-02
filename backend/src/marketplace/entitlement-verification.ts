import { verify } from 'crypto';
import { canonicalJson } from './canonical-json';

export interface EntitlementPayload {
  schemaVersion: number;
  generation: number;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REFUNDED';
  tokenId: string;
  installationId: string;
  customerId: string;
  productId: string;
  licensedMajorRange: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  updatesThrough: string;
  offlineRecheckAfter: string;
  features: string[];
  issuer: string;
  audience: string;
  keyId: string;
  nonce: string;
}

const TIMESTAMP_FIELDS = ['issuedAt', 'notBefore', 'expiresAt', 'updatesThrough', 'offlineRecheckAfter'] as const;

/**
 * Verifies a freshly-fetched entitlement envelope from the marketplace. Unlike a local
 * offline recheck, reaching this function already proves the marketplace was reachable,
 * so an elapsed `offlineRecheckAfter` is not itself a rejection reason here.
 */
export function verifyFetchedEntitlement(
  token: unknown,
  publicKeys: ReadonlyMap<string, string>,
  expected: { installationId: string; productId: string; now?: Date; clockSkewMs?: number },
): EntitlementPayload {
  if (!token || typeof token !== 'object') throw new Error('Entitlement token is malformed');
  const envelope = token as Record<string, any>;
  const payload = envelope.payload;
  const signature = envelope.signature;
  if (!payload || typeof payload !== 'object' || !signature || typeof signature !== 'object') throw new Error('Entitlement token is malformed');
  if (signature.algorithm !== 'ed25519' || typeof signature.keyId !== 'string' || typeof signature.value !== 'string') throw new Error('Entitlement signature is malformed');
  if (signature.keyId !== payload.keyId) throw new Error('Entitlement key id mismatch');
  const publicKey = publicKeys.get(signature.keyId);
  if (!publicKey) throw new Error('Entitlement signing key is not trusted');
  let valid: boolean;
  try { valid = verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature.value, 'base64')); }
  catch { throw new Error('Entitlement signature could not be verified'); }
  if (!valid) throw new Error('Entitlement signature is invalid');
  if (payload.installationId !== expected.installationId) throw new Error('Entitlement belongs to another installation');
  if (payload.productId !== expected.productId) throw new Error('Entitlement belongs to another product');
  if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) throw new Error('Entitlement generation is invalid');
  if (!['ACTIVE', 'EXPIRED', 'REVOKED', 'REFUNDED'].includes(payload.status)) throw new Error('Entitlement status is invalid');
  for (const field of TIMESTAMP_FIELDS) {
    if (typeof payload[field] !== 'string' || !Number.isFinite(Date.parse(payload[field]))) throw new Error('Entitlement token has malformed timestamps');
  }
  const issued = Date.parse(payload.issuedAt);
  const notBefore = Date.parse(payload.notBefore);
  const expires = Date.parse(payload.expiresAt);
  const updatesThrough = Date.parse(payload.updatesThrough);
  const offlineRecheckAfter = Date.parse(payload.offlineRecheckAfter);
  if (issued > expires || expires <= notBefore) throw new Error('Entitlement validity window is invalid');
  if (updatesThrough < notBefore || updatesThrough > expires) throw new Error('Entitlement update window is invalid');
  if (offlineRecheckAfter < notBefore || offlineRecheckAfter > expires) throw new Error('Entitlement offline window is invalid');
  const now = (expected.now ?? new Date()).getTime();
  const skew = expected.clockSkewMs ?? 5 * 60_000;
  if (now + skew < notBefore) throw new Error('Entitlement is not active yet');
  if (now - skew > expires) throw new Error('Entitlement has expired');
  return payload as EntitlementPayload;
}
