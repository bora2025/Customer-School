import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.announcements';

/**
 * Thin, Prisma-free proxy: announcements business data and logic live
 * entirely in the wattanam.announcements plugin (plugins/announcements/).
 * These routes keep the URLs the frontend already calls, translating each
 * into a dispatch() call against the plugin's own routes. No @Roles() here
 * -- the plugin's own permission grants (PluginPermissionsService) are the
 * only authorization check, same as PluginApiController.
 */
@UseGuards(JwtAuthGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly extensions: PluginExtensionsService) {}

  @Get('all')
  listAll(@Request() req: any) {
    return this.dispatch('GET', 'all', req, {});
  }

  @Get('feed')
  feed(@Request() req: any, @Query() query: Record<string, string>) {
    return this.dispatch('GET', 'feed', req, {}, query);
  }

  @Get('unread-count')
  unread(@Request() req: any) {
    return this.dispatch('GET', 'unread-count', req, {});
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.dispatch('PATCH', 'read', req, { id });
  }

  @Post()
  create(@Body() body: unknown, @Request() req: any) {
    return this.dispatch('POST', 'create', req, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.dispatch('DELETE', 'remove', req, { id });
  }

  private dispatch(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, req: any, body: unknown, query: Record<string, string> = {}) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method, path, params: {}, query, body,
      principal: { userId: req.user?.userId, role: req.user?.role, email: req.user?.email },
    });
  }
}
