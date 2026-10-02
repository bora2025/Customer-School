import { generateKeyPairSync, sign } from 'crypto';
import { canonicalJson } from './canonical-json';
import { verifySchoolControl } from './school-control-verification';

describe('verifySchoolControl', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const now = new Date('2026-09-26T00:00:00.000Z');
  const installationId = '00000000-0000-4000-8000-000000000010';

  function token(overrides: Record<string, unknown> = {}) {
    const payload = {
      schemaVersion: 1, generation: 2, installationId, issuedAt: now.toISOString(),
      audience: 'wattanam-school-control', keyId: 'control-1', access: 'ACTIVE', reason: null, warnings: [], ...overrides,
    };
    return { payload, signature: { algorithm: 'ed25519', keyId: 'control-1', value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') } };
  }

  it('accepts a signed, installation-bound generated decision', () => {
    expect(verifySchoolControl(token(), new Map([['control-1', publicKey]]), { installationId, now })).toMatchObject({ generation: 2, access: 'ACTIVE' });
  });

  it('rejects tampering, another installation and a clock beyond tolerance', () => {
    const tampered = token(); (tampered.payload as any).access = 'SUSPENDED';
    expect(() => verifySchoolControl(tampered, new Map([['control-1', publicKey]]), { installationId, now })).toThrow('signature');
    expect(() => verifySchoolControl(token(), new Map([['control-1', publicKey]]), { installationId: 'another', now })).toThrow('another installation');
    expect(() => verifySchoolControl(token({ issuedAt: new Date(now.getTime() + 300_001).toISOString() }), new Map([['control-1', publicKey]]), { installationId, now })).toThrow('future');
  });
});
