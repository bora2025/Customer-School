import * as bcrypt from 'bcryptjs';
import { MfaService, totp } from './mfa.service';

describe('school account MFA', () => {
  const original = process.env;
  beforeEach(() => { process.env = { ...original, JWT_SECRET: 'mfa-test-secret-at-least-thirty-two-characters' }; });
  afterEach(() => { process.env = original; });

  it('creates a Google Authenticator compatible secret and enables it with TOTP', async () => {
    const password = await bcrypt.hash('password-1234', 4);
    let encrypted = '';
    const prisma: any = { user: {
      findUnique: jest.fn().mockImplementation(async ({ select }: any) => select.password
        ? { email: 'owner@example.com', password, mfaEnabled: false }
        : { mfaSecretEncrypted: encrypted }),
      update: jest.fn().mockImplementation(async ({ data }: any) => { if (data.mfaSecretEncrypted) encrypted = data.mfaSecretEncrypted; return {}; }),
    } };
    const service = new MfaService(prisma);
    const setup = await service.begin('owner-1', 'password-1234');
    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.recoveryCodes).toHaveLength(8);
    await expect(service.enable('owner-1', totp(setup.secret))).resolves.toEqual({ enabled: true });
  });

  it('requires a second factor when enabled', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ mfaEnabled: true, mfaSecretEncrypted: null, mfaRecoveryCodes: [] }) } };
    await expect(new MfaService(prisma).assertLoginCode('owner-1')).rejects.toThrow('MFA code required');
  });
});
