import { PluginPermissionsService } from './plugin-permissions.service';

function prismaWith(overrides: Partial<{ manifestPermissions: string[]; grantRows: Array<{ role: string }> }> = {}) {
  return {
    pluginInstallation: { findUnique: jest.fn().mockResolvedValue({ manifestJson: JSON.stringify({ permissions: overrides.manifestPermissions ?? ['wattanam.test.read'] }) }) },
    pluginPermissionGrant: {
      upsert: jest.fn().mockResolvedValue({ id: 'grant-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue((overrides.grantRows ?? []).map((row) => ({ role: row.role }))),
    },
  } as any;
}

describe('PluginPermissionsService', () => {
  it('grants a manifest-declared permission to an allowed role, idempotently', async () => {
    const prisma = prismaWith();
    const service = new PluginPermissionsService(prisma);
    await service.grant('wattanam.test', 'wattanam.test.read', 'CLASS_ADMIN');
    expect(prisma.pluginPermissionGrant.upsert).toHaveBeenCalledWith({
      where: { pluginId_permissionId_role: { pluginId: 'wattanam.test', permissionId: 'wattanam.test.read', role: 'CLASS_ADMIN' } },
      create: { pluginId: 'wattanam.test', permissionId: 'wattanam.test.read', role: 'CLASS_ADMIN' },
      update: {},
    });
  });

  it('rejects granting to SUPER_ADMIN and to unknown roles', async () => {
    const service = new PluginPermissionsService(prismaWith());
    await expect(service.grant('wattanam.test', 'wattanam.test.read', 'SUPER_ADMIN')).rejects.toThrow('Cannot grant');
    await expect(service.grant('wattanam.test', 'wattanam.test.read', 'NOT_A_ROLE')).rejects.toThrow('Cannot grant');
  });

  it('rejects granting a permission the plugin manifest does not declare', async () => {
    const service = new PluginPermissionsService(prismaWith({ manifestPermissions: ['wattanam.test.manage'] }));
    await expect(service.grant('wattanam.test', 'wattanam.test.read', 'CLASS_ADMIN')).rejects.toThrow('does not declare permission');
  });

  it('rejects granting to a plugin that is not installed', async () => {
    const prisma = { pluginInstallation: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const service = new PluginPermissionsService(prisma);
    await expect(service.grant('wattanam.ghost', 'wattanam.ghost.read', 'CLASS_ADMIN')).rejects.toThrow('not installed');
  });

  it('lets SUPER_ADMIN through with no grant lookup at all', async () => {
    const prisma = prismaWith();
    const service = new PluginPermissionsService(prisma);
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', 'SUPER_ADMIN')).resolves.toBe(true);
    expect(prisma.pluginPermissionGrant.findMany).not.toHaveBeenCalled();
  });

  it('denies a role with no grant and no unmet dependency on undefined role', async () => {
    const service = new PluginPermissionsService(prismaWith({ grantRows: [] }));
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', 'CLASS_ADMIN')).resolves.toBe(false);
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', undefined)).resolves.toBe(false);
  });

  it('allows a role that directly holds the grant', async () => {
    const service = new PluginPermissionsService(prismaWith({ grantRows: [{ role: 'CLASS_ADMIN' }] }));
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', 'CLASS_ADMIN')).resolves.toBe(true);
  });

  it('allows a role that inherits a granted role, but not an unrelated one', async () => {
    const service = new PluginPermissionsService(prismaWith({ grantRows: [{ role: 'CLASS_ADMIN' }] }));
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', 'ADMIN')).resolves.toBe(true);
    await expect(service.isGranted('wattanam.test', 'wattanam.test.read', 'WATTAMAN_REPORTER')).resolves.toBe(false);
  });

  it('revokes a grant and lists remaining grants for a plugin', async () => {
    const prisma = prismaWith();
    const service = new PluginPermissionsService(prisma);
    await expect(service.revoke('wattanam.test', 'wattanam.test.read', 'CLASS_ADMIN')).resolves.toMatchObject({ revoked: true });
    expect(prisma.pluginPermissionGrant.deleteMany).toHaveBeenCalledWith({ where: { pluginId: 'wattanam.test', permissionId: 'wattanam.test.read', role: 'CLASS_ADMIN' } });
    service.list('wattanam.test');
    expect(prisma.pluginPermissionGrant.findMany).toHaveBeenCalledWith({ where: { pluginId: 'wattanam.test' }, orderBy: [{ permissionId: 'asc' }, { role: 'asc' }] });
  });
});
