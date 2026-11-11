import { Controller, Get, Logger, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { pluginUiAssetPath, pluginUiResponseHeaders, readVerifiedPluginUiAsset } from './plugin-ui-assets';

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Public on purpose: a sandboxed iframe has an opaque origin, so the browser sends no school cookies
 * with these requests. Only the ui/ files of an ACTIVE plugin at its exact installed version are
 * served (plugin code, never user data); everything else is a uniform 404.
 */
@Controller('plugin-ui')
export class PluginUiAssetsController {
  private readonly logger = new Logger(PluginUiAssetsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':pluginId/:version/*splat')
  async asset(@Param('pluginId') pluginId: string, @Param('version') version: string, @Req() request: Request, @Res() response: Response) {
    const splat = (request.params as Record<string, unknown>).splat;
    const relative = pluginUiAssetPath(Array.isArray(splat) ? splat.join('/') : String(splat || ''));
    if (!PLUGIN_ID.test(pluginId) || !VERSION.test(version) || !relative) throw new NotFoundException();
    const plugin = await this.prisma.pluginInstallation.findUnique({ where: { id: pluginId } });
    if (!plugin || plugin.status !== 'active' || plugin.version !== version) throw new NotFoundException();
    let asset: Awaited<ReturnType<typeof readVerifiedPluginUiAsset>>;
    try {
      asset = await readVerifiedPluginUiAsset(plugin.installedPath, relative);
    } catch (error) {
      this.logger.error(`Refused plugin UI file ${pluginId}@${version}/${relative}: ${error instanceof Error ? error.message : String(error)}`);
      throw new NotFoundException();
    }
    if (!asset) throw new NotFoundException();
    for (const [name, value] of Object.entries(pluginUiResponseHeaders(asset.contentType))) response.setHeader(name, value);
    response.removeHeader('Cross-Origin-Opener-Policy');
    response.status(200).send(asset.body);
  }
}
