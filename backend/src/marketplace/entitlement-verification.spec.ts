import { generateKeyPairSync, sign } from 'crypto';
import { canonicalJson } from './canonical-json';
import { verifyFetchedEntitlement } from './entitlement-verification';

const installationId = 'school-public-id';
const productId = 'official.attendance';

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function envelope(privateKeyPem: string, keyId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-28T00:00:00.000Z');
  const payload = {
    schemaVersion: 1, generation: 1, status: 'ACTIVE', tokenId: 'token-1', installationId, customerId: 'customer-1', productId,
    licensedMajorRange: '^1.0.0', issuedAt: now.toISOString(), notBefore: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), updatesThrough: new Date(now.getTime() + 43_200_000).toISOString(),
    offlineRecheckAfter: new Date(now.getTime() + 3_600_000).toISOString(), features: [], issuer: 'https://marketplace.example',
    audience: 'wattanam-school', keyId, nonce: 'a'.repeat(32), ...overrides,
  };
  return { payload, signature: { algorithm: 'ed25519', keyId, value: sign(null, Buffer.from(canonicalJson(payload)), privateKeyPem).toString('base64') } };
}

describe('verifyFetchedEntitlement', () => {
  const now = new Date('2026-08-28T00:00:00.000Z');

  it('accepts a validly signed, correctly bound token', () => {
    const { privateKey, publicKey } = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    const result = verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId, now });
    expect(result.tokenId).toBe('token-1');
  });

  it('rejects a token signed with a key id that is not in the trusted key set', () => {
    const { privateKey } = keyPair();
    const untrusted = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    expect(() => verifyFetchedEntitlement(token, new Map([['some-other-key-id', untrusted.publicKey]]), { installationId, productId, now }))
      .toThrow('not trusted');
  });

  it('rejects a tampered payload even with a validly-shaped signature envelope', () => {
    const { privateKey, publicKey } = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    (token.payload as any).productId = 'official.other-plugin';
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId, now }))
      .toThrow(/signature is invalid/i);
  });

  it('rejects a token issued for a different installation', () => {
    const { privateKey, publicKey } = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId: 'another-installation', productId, now }))
      .toThrow('another installation');
  });

  it('rejects a token issued for a different product', () => {
    const { privateKey, publicKey } = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId: 'official.other-plugin', now }))
      .toThrow('another product');
  });

  it('rejects an expired token', () => {
    const { privateKey, publicKey } = keyPair();
    const issuedAt = new Date(now.getTime() - 2 * 86_400_000);
    const token = envelope(privateKey, 'entitlement-2026', {
      issuedAt: issuedAt.toISOString(), notBefore: issuedAt.toISOString(),
      expiresAt: new Date(now.getTime() - 86_400_000).toISOString(),
      updatesThrough: new Date(now.getTime() - 90_000_000).toISOString(),
      offlineRecheckAfter: new Date(now.getTime() - 90_000_000).toISOString(),
    });
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId, now }))
      .toThrow('expired');
  });

  it('rejects a not-yet-active token', () => {
    const { privateKey, publicKey } = keyPair();
    const future = new Date(now.getTime() + 3_600_000);
    const token = envelope(privateKey, 'entitlement-2026', { notBefore: future.toISOString(), expiresAt: new Date(future.getTime() + 86_400_000).toISOString(), updatesThrough: new Date(future.getTime() + 3_600_000).toISOString(), offlineRecheckAfter: new Date(future.getTime() + 3_600_000).toISOString() });
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId, now }))
      .toThrow('not active yet');
  });

  it('accepts a token even though its offline recheck deadline has already passed, since this is a fresh online fetch', () => {
    const { privateKey, publicKey } = keyPair();
    const notBefore = new Date(now.getTime() - 2 * 86_400_000);
    const token = envelope(privateKey, 'entitlement-2026', {
      issuedAt: notBefore.toISOString(), notBefore: notBefore.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      offlineRecheckAfter: new Date(now.getTime() - 3_600_000).toISOString(),
    });
    const result = verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey]]), { installationId, productId, now });
    expect(result.tokenId).toBe('token-1');
  });

  it('rejects a malformed envelope', () => {
    expect(() => verifyFetchedEntitlement({ nonsense: true }, new Map(), { installationId, productId, now })).toThrow('malformed');
    expect(() => verifyFetchedEntitlement(null, new Map(), { installationId, productId, now })).toThrow('malformed');
  });

  it('rejects when the envelope signature key id does not match the payload key id', () => {
    const { privateKey, publicKey } = keyPair();
    const token = envelope(privateKey, 'entitlement-2026');
    token.signature.keyId = 'entitlement-other';
    expect(() => verifyFetchedEntitlement(token, new Map([['entitlement-2026', publicKey], ['entitlement-other', publicKey]]), { installationId, productId, now }))
      .toThrow('key id mismatch');
  });
});
