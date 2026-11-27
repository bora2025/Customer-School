import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

/**
 * Device credentials of plugins: keys for hardware terminals and other machines that call a plugin
 * without a user session (POST /api/plugin-device/<pluginId>/<path>, see PluginDeviceController).
 * A plugin with the `devices.credentials` capability issues, lists and revokes its own keys. Only the
 * SHA-256 of a key is stored; the key itself is returned once, when issued.
 */
@Injectable()
export class PluginDeviceCredentialsService {
  private readonly lastTouch = new Map<string, number>();
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private out(row: any) {
    return { id: row.id, name: row.name, scope: row.scope, hint: row.tokenHint, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, revokedAt: row.revokedAt };
  }

  async issue(pluginId: string, input: { name?: unknown; scope?: unknown }) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const scope = typeof input?.scope === 'string' ? input.scope.trim().replace(/\/+$/, '') : '';
    if (!name || name.length > 80) throw new BadRequestException('Device credential name must contain 1-80 characters');
    if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4}$/.test(scope)) throw new BadRequestException('Device credential scope must be a route path prefix such as "terminal"');
    if ((await this.prisma.pluginDeviceCredential.count({ where: { pluginId, revokedAt: null } })) >= 200) throw new BadRequestException('A plugin may keep at most 200 active device credentials');
    const token = `wtd_${randomBytes(24).toString('base64url')}`;
    const row = await this.prisma.pluginDeviceCredential.create({ data: { pluginId, name, scope, tokenHash: this.hash(token), tokenHint: token.slice(-4) } });
    return { ...this.out(row), token };
  }

  async list(pluginId: string) {
    const rows = await this.prisma.pluginDeviceCredential.findMany({ where: { pluginId }, orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((row) => this.out(row));
  }

  async revoke(pluginId: string, id: string) {
    const result = await this.prisma.pluginDeviceCredential.updateMany({ where: { id: String(id || ''), pluginId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id, revoked: result.count > 0 };
  }

  /** The credential behind a presented key, if it is this plugin's and not revoked. */
  async verify(pluginId: string, token: string) {
    if (typeof token !== 'string' || !/^wtd_[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const row = await this.prisma.pluginDeviceCredential.findUnique({ where: { tokenHash: this.hash(token) } });
    if (!row || row.pluginId !== pluginId || row.revokedAt) return null;
    // last use, written at most once a minute per key
    const now = Date.now();
    if (now - (this.lastTouch.get(row.id) || 0) > 60_000) {
      this.lastTouch.set(row.id, now);
      void this.prisma.pluginDeviceCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
    }
    return row;
  }
}
