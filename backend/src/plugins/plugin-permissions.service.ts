import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { roleSatisfies } from '../auth/roles.guard';

/**
 * Roles a plugin permission may be granted to. SUPER_ADMIN is deliberately
 * excluded: it already satisfies every plugin permission implicitly, the
 * same way it satisfies every core @Roles() check.
 */
export const GRANTABLE_PLUGIN_ROLES = ['ADMIN', 'SCHOOL_ADMIN', 'WATTAMAN', 'WATTAMAN_REPORTER', 'CLASS_ADMIN', 'ACCOUNTER', 'TEACHER', 'STUDENT', 'PARENT'] as const;
export type GrantablePluginRole = (typeof GRANTABLE_PLUGIN_ROLES)[number];

/**
 * Grants and evaluates which non-SUPER_ADMIN roles may call a plugin's
 * declared permissions. Registering a route/page permission (plugin-extensions.service.ts)
 * only proves the plugin manifest declared it; it does not by itself let any
 * non-SUPER_ADMIN principal invoke it. A permission must be explicitly
 * granted to a role here before dispatch will allow that role through.
 */
@Injectable()
export class PluginPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(pluginId: string, permissionId: string, role: string) {
    if (!GRANTABLE_PLUGIN_ROLES.includes(role as GrantablePluginRole)) {
      throw new BadRequestException(`Cannot grant a plugin permission to role "${role}"`);
    }
    await this.assertPermissionIsDeclared(pluginId, permissionId);
    return this.prisma.pluginPermissionGrant.upsert({
      where: { pluginId_permissionId_role: { pluginId, permissionId, role } },
      create: { pluginId, permissionId, role },
      update: {},
    });
  }

  async revoke(pluginId: string, permissionId: string, role: string) {
    await this.prisma.pluginPermissionGrant.deleteMany({ where: { pluginId, permissionId, role } });
    return { pluginId, permissionId, role, revoked: true };
  }

  list(pluginId: string) {
    return this.prisma.pluginPermissionGrant.findMany({ where: { pluginId }, orderBy: [{ permissionId: 'asc' }, { role: 'asc' }] });
  }

  /** SUPER_ADMIN always passes; every other role needs an explicit (possibly inherited) grant. */
  async isGranted(pluginId: string, permissionId: string, role: string | undefined): Promise<boolean> {
    if (!role) return false;
    if (role === 'SUPER_ADMIN') return true;
    const grants = await this.prisma.pluginPermissionGrant.findMany({ where: { pluginId, permissionId }, select: { role: true } });
    if (grants.length === 0) return false;
    return roleSatisfies(role, grants.map((grant) => grant.role));
  }

  private async assertPermissionIsDeclared(pluginId: string, permissionId: string) {
    const installation = await this.prisma.pluginInstallation.findUnique({ where: { id: pluginId }, select: { manifestJson: true } });
    if (!installation) throw new NotFoundException(`Plugin is not installed: ${pluginId}`);
    let declared: string[];
    try {
      declared = JSON.parse(installation.manifestJson).permissions ?? [];
    } catch {
      throw new BadRequestException('Installed plugin manifest is not valid JSON');
    }
    if (!Array.isArray(declared) || !declared.includes(permissionId)) {
      throw new BadRequestException(`Plugin does not declare permission: ${permissionId}`);
    }
  }
}
