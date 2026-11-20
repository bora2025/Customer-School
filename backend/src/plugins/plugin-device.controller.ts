import { All, Controller, ForbiddenException, HttpException, HttpStatus, Param, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PluginDeviceCredentialsService } from './plugin-device-credentials.service';
import { PluginExtensionsService } from './plugin-extensions.service';

/**
 * Machines without a user session (attendance terminals, card readers with network) call a plugin here:
 *   <METHOD> /api/plugin-device/<pluginId>/<path>   with   Authorization: Bearer wtd_…   (or X-Wattanam-Device-Key)
 * The key must be one of that plugin's device credentials, the path must sit under the key's scope, and
 * the route must be registered with access 'device' (user routes are never reachable from here, and
 * device routes never from /api/plugin-api). The plugin sees principal { userId: 'device:<id>', role: 'DEVICE' }.
 */
@Controller('plugin-device')
export class PluginDeviceController {
  private readonly windows = new Map<string, number[]>();
  constructor(private readonly credentials: PluginDeviceCredentialsService, private readonly extensions: PluginExtensionsService) {}

  // a key may send at most 30 requests a second
  private allow(id: string) {
    const now = Date.now();
    const recent = (this.windows.get(id) || []).filter((time) => now - time < 1000);
    if (recent.length >= 30) return false;
    recent.push(now); this.windows.set(id, recent);
    return true;
  }

  @All(':pluginId/*splat')
  async dispatch(@Param('pluginId') pluginId: string, @Req() request: Request) {
    const header = String(request.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(request.headers['x-wattanam-device-key'] || '').trim();
    const credential = await this.credentials.verify(pluginId, token);
    if (!credential) throw new UnauthorizedException('The device key is not valid for this plugin');
    if (!this.allow(credential.id)) throw new HttpException('Too many requests from this device', HttpStatus.TOO_MANY_REQUESTS);
    const splat = (request.params as Record<string, unknown>).splat;
    const path = Array.isArray(splat) ? splat.join('/') : String(splat || '');
    if (path !== credential.scope && !path.startsWith(`${credential.scope}/`)) throw new ForbiddenException('This device key may not use this path');
    return this.extensions.dispatch(pluginId, {
      method: request.method as any,
      path,
      params: {},
      query: request.query as any,
      body: request.body,
      principal: { userId: `device:${credential.id}`, role: 'DEVICE', device: { id: credential.id, name: credential.name } } as any,
    });
  }
}
