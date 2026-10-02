import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ObjectStorageProvider } from '../storage/object-storage';
import { PLUGIN_OBJECT_STORAGE } from '../storage/storage.module';

@Injectable()
export class PluginStorageService {
  constructor(@Inject(PLUGIN_OBJECT_STORAGE) private readonly storage: ObjectStorageProvider) {}

  async readText(pluginId: string, name: string) {
    const value = await this.storage.get(this.key(pluginId, name));
    return value?.toString('utf8') ?? null;
  }

  async writeText(pluginId: string, name: string, value: string) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > this.maximum()) throw new BadRequestException('Plugin storage value exceeds its per-file limit');
    await this.assertTotal(pluginId, name, Buffer.byteLength(value));
    await this.storage.put(this.key(pluginId, name), Buffer.from(value));
  }

  async readBinary(pluginId: string, name: string) {
    const value = await this.storage.get(this.key(pluginId, name));
    return value ? value.toString('base64') : null;
  }

  async writeBinary(pluginId: string, name: string, base64: string) {
    if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new BadRequestException('Plugin binary storage value must be canonical base64');
    const value = Buffer.from(base64, 'base64');
    if (value.byteLength > this.maximum()) throw new BadRequestException('Plugin storage value exceeds its per-file limit');
    await this.assertTotal(pluginId, name, value.byteLength);
    await this.storage.put(this.key(pluginId, name), value);
  }

  async delete(pluginId: string, name: string) { await this.storage.delete(this.key(pluginId, name)); }

  async list(pluginId: string, prefix = '') {
    if (prefix && !this.safe(prefix)) throw new BadRequestException('Plugin storage prefix is invalid');
    const base = `${pluginId}/`;
    return (await this.storage.list(`${base}${prefix}`)).map((entry) => entry.key.slice(base.length)).sort();
  }

  private key(pluginId: string, name: string) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(pluginId)) throw new BadRequestException('Plugin id is invalid');
    if (!this.safe(name)) throw new BadRequestException('Plugin storage path is invalid');
    return `${pluginId}/${name}`;
  }

  private safe(name: string) { return !!name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.split('/').includes('..'); }
  private maximum() { return Number(process.env.PLUGIN_STORAGE_MAX_FILE_BYTES || 1024 * 1024); }
  private async assertTotal(pluginId: string, name: string, incoming: number) {
    const limit = Number(process.env.PLUGIN_STORAGE_MAX_TOTAL_BYTES || 100 * 1024 * 1024);
    const key = this.key(pluginId, name); const existing = await this.storage.get(key);
    const used = (await this.storage.list(`${pluginId}/`)).reduce((sum, item) => sum + item.size, 0) - (existing?.length || 0);
    if (used + incoming > limit) throw new BadRequestException('Plugin storage exceeds its total quota');
  }
}
