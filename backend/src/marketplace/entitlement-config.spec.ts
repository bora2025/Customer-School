import { generateKeyPairSync } from 'crypto';
import { readEntitlementConfig } from './entitlement-config';

const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('entitlement key configuration', () => {
  it('is disabled unless a key is configured', () => {
    expect(readEntitlementConfig({})).toBeNull();
  });

  it('requires a matching key id and PEM key together', () => {
    expect(() => readEntitlementConfig({ ENTITLEMENT_KEY_ID: 'entitlement-2026' })).toThrow('public key is required');
  });

  it('loads a pinned inline key', () => {
    const config = readEntitlementConfig({ ENTITLEMENT_PUBLIC_KEY: publicKey, ENTITLEMENT_KEY_ID: 'entitlement-2026' });
    expect(config!.publicKeys.get('entitlement-2026')?.trim()).toBe(publicKey.trim());
  });

  it('loads secondary keys for a rotation overlap', () => {
    const second = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const config = readEntitlementConfig({
      ENTITLEMENT_PUBLIC_KEY: publicKey, ENTITLEMENT_KEY_ID: 'entitlement-new',
      ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON: JSON.stringify({ 'entitlement-old': second }),
    });
    expect(Array.from(config!.publicKeys.keys()).sort()).toEqual(['entitlement-new', 'entitlement-old']);
  });

  it('rejects malformed secondary keys JSON', () => {
    expect(() => readEntitlementConfig({
      ENTITLEMENT_PUBLIC_KEY: publicKey, ENTITLEMENT_KEY_ID: 'entitlement-2026', ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON: 'not-json',
    })).toThrow('valid JSON');
  });
});
