import { WsException } from '@nestjs/websockets';
import { authenticateSocket, extractSocketToken, requireSocketUser } from './socket-auth';

function socket(overrides: Record<string, any> = {}) {
  return {
    handshake: { auth: {}, headers: {}, ...overrides.handshake },
    data: {},
    ...overrides,
  } as any;
}

describe('socket authentication', () => {
  it('extracts a handshake token before headers and cookies', () => {
    const client = socket({
      handshake: {
        auth: { token: 'auth-token' },
        headers: { authorization: 'Bearer header-token', cookie: 'access_token=cookie-token' },
      },
    });
    expect(extractSocketToken(client)).toBe('auth-token');
  });

  it('extracts an HttpOnly access-token cookie', () => {
    const client = socket({ handshake: { auth: {}, headers: { cookie: 'theme=dark; access_token=signed%2Etoken' } } });
    expect(extractSocketToken(client)).toBe('signed.token');
  });

  it('verifies and stores the minimum socket identity', async () => {
    const client = socket({ handshake: { auth: { token: 'token' }, headers: {} } });
    const jwt = {
      decode: jest.fn().mockReturnValue(null),
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', email: 'a@example.com', role: 'ADMIN' }),
    } as any;

    await expect(authenticateSocket(jwt, client)).resolves.toEqual({
      userId: 'user-1', email: 'a@example.com', role: 'ADMIN',
    });
    expect(requireSocketUser(client).userId).toBe('user-1');
  });

  it('rejects missing or invalid authentication', async () => {
    await expect(authenticateSocket({} as any, socket())).rejects.toBeInstanceOf(WsException);
    const client = socket({ handshake: { auth: { token: 'bad' }, headers: {} } });
    const jwt = { decode: jest.fn().mockReturnValue(null), verifyAsync: jest.fn().mockRejectedValue(new Error('bad token')) } as any;
    await expect(authenticateSocket(jwt, client)).rejects.toBeInstanceOf(WsException);
  });
});
