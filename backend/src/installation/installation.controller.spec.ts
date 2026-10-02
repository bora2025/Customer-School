import { BadRequestException } from '@nestjs/common';
import { InstallationController } from './installation.controller';

const dto = {
  schoolName: 'Core School', schoolSlug: 'core-school', locale: 'en-KH',
  timezone: 'Asia/Phnom_Penh', currency: 'KHR', ownerName: 'Owner',
  ownerEmail: 'owner@example.com', ownerPassword: 'password-1234',
};

describe('InstallationController', () => {
  it('runs the shared preflight before interactive installation', async () => {
    const installation = { install: jest.fn().mockResolvedValue({ state: 'installed' }) };
    const preflight = { run: jest.fn().mockResolvedValue({ ok: true, checks: [] }) };
    const controller = new InstallationController(installation as any, preflight as any);

    await expect(controller.install(dto)).resolves.toEqual({ state: 'installed' });
    expect(preflight.run).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en-KH', currency: 'KHR' }));
    expect(preflight.run.mock.invocationCallOrder[0]).toBeLessThan(installation.install.mock.invocationCallOrder[0]);
  });

  it('does not write installation records when a blocking preflight check fails', async () => {
    const installation = { install: jest.fn() };
    const preflight = { run: jest.fn().mockResolvedValue({
      ok: false,
      checks: [{ name: 'database', ok: false, detail: 'unreachable' }],
    }) };
    const controller = new InstallationController(installation as any, preflight as any);

    await expect(controller.install(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(installation.install).not.toHaveBeenCalled();
  });
});
