import { resolveJwtVerificationSecret, verifyJwtWithRotationSupport } from './jwt-verification';

function fakeJwtService(decodedHeader: { kid?: string } | null) {
  return {
    decode: jest.fn().mockReturnValue(decodedHeader ? { header: decodedHeader, payload: {} } : null),
    verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }),
  } as any;
}

describe('resolveJwtVerificationSecret', () => {
  it('uses the active secret when the token has no kid at all (pre-rotation token)', () => {
    const jwt = fakeJwtService(null);
    const secret = resolveJwtVerificationSecret(jwt, 'token', 'jwt-v2', 'active-secret', new Map([['jwt-v1', 'old-secret']]));
    expect(secret).toBe('active-secret');
  });

  it('uses the active secret when the kid matches the active key id', () => {
    const jwt = fakeJwtService({ kid: 'jwt-v2' });
    const secret = resolveJwtVerificationSecret(jwt, 'token', 'jwt-v2', 'active-secret', new Map());
    expect(secret).toBe('active-secret');
  });

  it('uses the matching secondary secret for a kid from a not-yet-retired rotation key', () => {
    const jwt = fakeJwtService({ kid: 'jwt-v1' });
    const secret = resolveJwtVerificationSecret(jwt, 'token', 'jwt-v2', 'active-secret', new Map([['jwt-v1', 'old-secret']]));
    expect(secret).toBe('old-secret');
  });

  it('fails closed for a kid that is neither the active key nor a known secondary key', () => {
    const jwt = fakeJwtService({ kid: 'jwt-unknown' });
    expect(() => resolveJwtVerificationSecret(jwt, 'token', 'jwt-v2', 'active-secret', new Map([['jwt-v1', 'old-secret']])))
      .toThrow('JWT signing key is not trusted');
  });
});

describe('verifyJwtWithRotationSupport', () => {
  it('verifies with the secret resolved for the token\'s own kid, not blindly the active one', async () => {
    process.env.JWT_KEY_ID = 'jwt-v2';
    process.env.JWT_SECRET = 'active-secret-at-least-32-characters-long';
    process.env.JWT_SECONDARY_SECRETS_JSON = JSON.stringify({ 'jwt-v1': 'old-secret-at-least-32-characters-long' });
    try {
      const jwt = fakeJwtService({ kid: 'jwt-v1' });
      await verifyJwtWithRotationSupport(jwt, 'token');
      expect(jwt.verifyAsync).toHaveBeenCalledWith('token', { secret: 'old-secret-at-least-32-characters-long' });
    } finally {
      delete process.env.JWT_KEY_ID;
      delete process.env.JWT_SECRET;
      delete process.env.JWT_SECONDARY_SECRETS_JSON;
    }
  });
});
