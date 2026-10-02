export interface NotificationProviderConfig {
  email: {
    enabled: boolean;
    apiKey: string | null;
    from: string;
  };
  sms: {
    enabled: boolean;
    accountSid: string | null;
    authToken: string | null;
    from: string | null;
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

function optional(env: NodeJS.ProcessEnv, name: string): string | null {
  return env[name]?.trim() || null;
}

export function readNotificationProviderConfig(env: NodeJS.ProcessEnv = process.env): NotificationProviderConfig {
  const apiKey = optional(env, 'SENDGRID_API_KEY');
  const from = optional(env, 'SENDGRID_FROM') || 'noreply@attendancesystem.com';
  if (!EMAIL.test(from)) throw new Error('SENDGRID_FROM must be a valid email address');
  if (apiKey && apiKey.length < 20) throw new Error('SENDGRID_API_KEY is malformed');

  const accountSid = optional(env, 'TWILIO_ACCOUNT_SID');
  const authToken = optional(env, 'TWILIO_AUTH_TOKEN');
  const smsFrom = optional(env, 'TWILIO_PHONE_NUMBER');
  const twilioValues = [accountSid, authToken, smsFrom];
  const configured = twilioValues.filter(Boolean).length;
  if (configured > 0 && configured < twilioValues.length) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured together');
  }
  if (accountSid && !/^AC[a-fA-F0-9]{32}$/.test(accountSid)) throw new Error('TWILIO_ACCOUNT_SID is malformed');
  if (authToken && authToken.length < 20) throw new Error('TWILIO_AUTH_TOKEN is malformed');
  if (smsFrom && !E164.test(smsFrom)) throw new Error('TWILIO_PHONE_NUMBER must use E.164 format');

  return {
    email: { enabled: !!apiKey, apiKey, from },
    sms: { enabled: configured === 3, accountSid, authToken, from: smsFrom },
  };
}

export function notificationProviderStatus(config: NotificationProviderConfig) {
  return {
    email: { enabled: config.email.enabled, from: config.email.from },
    sms: { enabled: config.sms.enabled, from: config.sms.from },
  };
}
