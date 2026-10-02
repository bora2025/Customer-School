import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { CardTemplatesService } from './card-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.document-designer';
type RouteOwner = 'legacy' | 'plugin';

export function documentDesignerRouteOwner(value = process.env.DOCUMENT_DESIGNER_ROUTE_OWNER): RouteOwner {
  const normalized = String(value || 'legacy').trim().toLowerCase();
  if (normalized !== 'legacy' && normalized !== 'plugin') {
    throw new Error('DOCUMENT_DESIGNER_ROUTE_OWNER must be legacy or plugin');
  }
  return normalized;
}

@Controller('card-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CardTemplatesController {
  constructor(
    private readonly cardTemplatesService: CardTemplatesService,
    private readonly extensions: PluginExtensionsService,
  ) {}

  @Get()
  @Roles('ADMIN')
  findAll(@Request() req: any) {
    return this.pluginOwned() ? this.dispatch('GET', 'templates', req, {}) : this.cardTemplatesService.findAll();
  }

  @Get('active/:cardType')
  getActiveDesign(@Param('cardType') cardType: string, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('GET', `active/${encodeURIComponent(cardType)}`, req, {}, { documentType: cardType })
      : this.cardTemplatesService.getActiveDesign(cardType);
  }

  @Get(':id')
  @Roles('ADMIN')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('GET', `templates/${encodeURIComponent(id)}`, req, {}, { id })
      : this.cardTemplatesService.findOne(id);
  }

  @Put('active/:cardType')
  @Roles('ADMIN')
  setActiveDesign(@Param('cardType') cardType: string, @Body() body: { design: object }, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('PUT', `active/${encodeURIComponent(cardType)}`, req, body, { documentType: cardType })
      : this.cardTemplatesService.setActiveDesign(cardType, body.design);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() body: { name: string; cardType: string; design: object }, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('POST', 'templates', req, { name: body.name, documentType: body.cardType, design: body.design })
      : this.cardTemplatesService.create(body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  delete(@Param('id') id: string, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('DELETE', `templates/${encodeURIComponent(id)}`, req, {}, { id })
      : this.cardTemplatesService.delete(id);
  }

  private pluginOwned() { return documentDesignerRouteOwner() === 'plugin'; }

  private dispatch(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, req: any, body: unknown, params: Record<string, string> = {}) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method, path, params, query: {}, body,
      principal: { userId: req.user?.userId, role: req.user?.role, email: req.user?.email },
    });
  }
}
