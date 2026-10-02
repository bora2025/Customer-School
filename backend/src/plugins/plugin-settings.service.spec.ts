import { PluginSettingsService } from './plugin-settings.service';

describe('PluginSettingsService', () => {
  it('scopes JSON settings by plugin and safely handles defaults/deletion', async () => {
    const prisma = { pluginSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), deleteMany: jest.fn() } } as any;
    const service = new PluginSettingsService(prisma);
    await expect(service.get('wattanam.test', 'preferences', { enabled: true })).resolves.toEqual({ enabled: true });
    await service.set('wattanam.test', 'preferences', { enabled: false });
    expect(prisma.pluginSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pluginId_key: { pluginId: 'wattanam.test', key: 'preferences' } } }));
    await service.delete('wattanam.test', 'preferences');
    expect(prisma.pluginSetting.deleteMany).toHaveBeenCalledWith({ where: { pluginId: 'wattanam.test', key: 'preferences' } });
  });

  it('rejects invalid keys, non-JSON values, and oversized values', async () => {
    const service = new PluginSettingsService({ pluginSetting: {} } as any);
    await expect(service.set('wattanam.test', '../secret', true)).rejects.toThrow('invalid');
    await expect(service.set('wattanam.test', 'bad', undefined)).rejects.toThrow('must be JSON');
    await expect(service.set('wattanam.test', 'large', 'x'.repeat(70_000))).rejects.toThrow('64 KiB');
  });
});
