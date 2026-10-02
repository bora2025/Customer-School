import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PluginSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(pluginId: string, key: string, fallback?: T): Promise<T | undefined> {
    this.validateKey(key);
    const setting = await this.prisma.pluginSetting.findUnique({ where: { pluginId_key: { pluginId, key } } });
    return setting ? JSON.parse(setting.valueJson) as T : fallback;
  }

  async set(pluginId: string, key: string, value: unknown) {
    this.validateKey(key);
    const valueJson = JSON.stringify(value);
    if (valueJson === undefined || Buffer.byteLength(valueJson) > 64 * 1024) throw new BadRequestException('Plugin setting must be JSON and no larger than 64 KiB');
    await this.prisma.pluginSetting.upsert({ where: { pluginId_key: { pluginId, key } }, create: { pluginId, key, valueJson }, update: { valueJson } });
  }

  async delete(pluginId: string, key: string) {
    this.validateKey(key);
    await this.prisma.pluginSetting.deleteMany({ where: { pluginId, key } });
  }

  private validateKey(key: string) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(key)) throw new BadRequestException('Plugin setting key is invalid');
  }
}
