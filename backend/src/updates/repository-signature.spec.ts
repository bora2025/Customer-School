import { generateKeyPairSync, sign } from 'crypto';
import { canonicalRepositoryJson, verifyRepositoryEnvelope } from './repository-signature';

describe('update repository signatures', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const payload = { schemaVersion: 1, coreReleases: [], pluginReleases: [], advisories: [], nested: { z: 1, a: 2 } };

  function envelope(value: any = payload, keyId = 'official-2026') {
    return { payload: value, signature: { algorithm: 'ed25519', keyId, value: sign(null, Buffer.from(canonicalRepositoryJson(value)), privateKey).toString('base64') } };
  }

  it('accepts canonical metadata signed by the pinned key', () => {
    expect(verifyRepositoryEnvelope(envelope(), publicKey, 'official-2026')).toEqual(payload);
  });

  it('rejects metadata changed after signing', () => {
    const value = envelope();
    value.payload.pluginReleases.push({ pluginId: 'wattanam.tampered' } as never);
    expect(() => verifyRepositoryEnvelope(value, publicKey, 'official-2026')).toThrow('signature is invalid');
  });

  it('rejects a valid signature carrying an unexpected key id', () => {
    expect(() => verifyRepositoryEnvelope(envelope(payload, 'retired-key'), publicKey, 'official-2026')).toThrow('signature is invalid');
  });

  it('accepts either trusted signature during an overlap rotation', () => {
    const next = generateKeyPairSync('ed25519');
    const nextPrivate = next.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const nextPublic = next.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const rotated: any = envelope(payload, 'official-old');
    rotated.signatures = [
      { algorithm: 'ed25519', keyId: 'official-new', value: sign(null, Buffer.from(canonicalRepositoryJson(payload)), nextPrivate).toString('base64') },
      rotated.signature,
    ];
    expect(verifyRepositoryEnvelope(rotated, { 'official-old': publicKey })).toEqual(payload);
    expect(verifyRepositoryEnvelope(rotated, { 'official-new': nextPublic })).toEqual(payload);
  });
});
