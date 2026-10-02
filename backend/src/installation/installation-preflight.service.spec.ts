import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { InstallationPreflightService } from './installation-preflight.service';

describe('InstallationPreflightService', () => {
  const originalEnvironment = process.env;
  let writableDir: string;
  let unwritablePath: string;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    writableDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-preflight-'));
    // A path that collides with an existing file can never become a writable directory.
    unwritablePath = path.join(writableDir, 'blocked-by-a-file');
    await fs.writeFile(unwritablePath, 'not a directory');
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
      APP_VERSION: '1.0.0-test',
      BACKUP_DIR: writableDir,
      PLUGIN_DIR: writableDir,
      PLUGIN_DATA_DIR: writableDir,
    };
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(async () => {
    process.env = originalEnvironment;
    fetchSpy.mockRestore();
    await fs.rm(writableDir, { recursive: true, force: true });
  });

  function service(prismaOverrides: any = {}) {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]), ...prismaOverrides };
    return new InstallationPreflightService(prisma as any);
  }

  it('reports every check ok on a healthy target with no optional providers configured', async () => {
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.ok).toBe(true);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName.database.ok).toBe(true);
    expect(byName['storage:backup'].ok).toBe(true);
    expect(byName['storage:plugin'].ok).toBe(true);
    expect(byName['storage:pluginData'].ok).toBe(true);
    expect(byName.locale.ok).toBe(true);
    expect(byName.email).toEqual({ name: 'email', ok: true, detail: 'not configured' });
    expect(byName.sms).toEqual({ name: 'sms', ok: true, detail: 'not configured' });
    expect(byName.license.ok).toBe(true);
    expect(byName.license.detail).toMatch(/not yet accepted/);
  });

  it('fails overall when the database is unreachable', async () => {
    const report = await service({ $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) })
      .run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'database')).toMatchObject({ ok: false });
  });

  it('fails overall when a storage directory is not writable, but leaves the other two independent', async () => {
    process.env.PLUGIN_DIR = unwritablePath;
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'storage:plugin')).toMatchObject({ ok: false });
    expect(report.checks.find((c) => c.name === 'storage:backup')).toMatchObject({ ok: true });
    expect(report.checks.find((c) => c.name === 'storage:pluginData')).toMatchObject({ ok: true });
  });

  it('reports invalid locale/timezone/currency without affecting overall ok', async () => {
    const report = await service().run({ locale: 'not-a-locale-!!', timezone: 'Invalid/Timezone', currency: 'ZZZ' });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'locale')).toMatchObject({ ok: false });
  });

  it('reports a reachable SendGrid account as ok when configured', async () => {
    process.env.SENDGRID_API_KEY = 'a'.repeat(32);
    process.env.SENDGRID_FROM = 'noreply@example.com';
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.checks.find((c) => c.name === 'email')).toMatchObject({ ok: true, detail: 'reachable' });
    expect(fetchSpy).toHaveBeenCalledWith('https://api.sendgrid.com/v3/user/account', expect.objectContaining({
      headers: { Authorization: `Bearer ${'a'.repeat(32)}` },
    }));
  });

  it('reports an unreachable/invalid SendGrid key without failing the overall report', async () => {
    process.env.SENDGRID_API_KEY = 'a'.repeat(32);
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'email')).toMatchObject({ ok: false, detail: 'SendGrid returned 401' });
  });

  it('reports a reachable Twilio account as ok when configured', async () => {
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'b'.repeat(32);
    process.env.TWILIO_PHONE_NUMBER = '+15551234567';
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.checks.find((c) => c.name === 'sms')).toMatchObject({ ok: true, detail: 'reachable' });
  });

  it('records license acceptance when provided', async () => {
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR', acceptedLicenseVersion: 'terms-of-service-v1.0' });
    expect(report.checks.find((c) => c.name === 'license')).toMatchObject({ ok: true, detail: 'accepted terms-of-service-v1.0' });
  });

  it('reports both provider checks as failing when notification config itself is malformed, without failing the overall report', async () => {
    process.env.SENDGRID_FROM = 'not-an-email';
    const report = await service().run({ locale: 'en-KH', timezone: 'Asia/Phnom_Penh', currency: 'KHR' });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'email')).toMatchObject({ ok: false });
    expect(report.checks.find((c) => c.name === 'sms')).toMatchObject({ ok: false });
  });
});
