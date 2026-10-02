import { notificationProviderStatus, readNotificationProviderConfig } from './notification-config';

describe('notification provider configuration', () => {
  it('keeps both providers optional', () => {
    const config = readNotificationProviderConfig({});
    expect(config.email.enabled).toBe(false);
    expect(config.sms.enabled).toBe(false);
  });

  it('accepts complete provider configuration and returns a secret-free status', () => {
    const config = readNotificationProviderConfig({
      SENDGRID_API_KEY: 'SG.a-valid-looking-test-key',
      SENDGRID_FROM: 'school@example.com',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'a-valid-test-auth-token',
      TWILIO_PHONE_NUMBER: '+85512345678',
    });
    expect(config.email.enabled).toBe(true);
    expect(config.sms.enabled).toBe(true);
    expect(notificationProviderStatus(config)).toEqual({
      email: { enabled: true, from: 'school@example.com' },
      sms: { enabled: true, from: '+85512345678' },
    });
    expect(JSON.stringify(notificationProviderStatus(config))).not.toContain('test-key');
    expect(JSON.stringify(notificationProviderStatus(config))).not.toContain('auth-token');
  });

  it('rejects partial Twilio configuration', () => {
    expect(() => readNotificationProviderConfig({ TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}` }))
      .toThrow('must be configured together');
  });

  it('rejects malformed sender identities', () => {
    expect(() => readNotificationProviderConfig({ SENDGRID_FROM: 'invalid' })).toThrow('SENDGRID_FROM');
    expect(() => readNotificationProviderConfig({
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'a-valid-test-auth-token',
      TWILIO_PHONE_NUMBER: '012345678',
    })).toThrow('E.164');
  });
});
