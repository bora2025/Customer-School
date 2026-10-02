import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MarketplaceCommerceService } from './marketplace-commerce.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/marketplace')
export class MarketplaceCommerceController {
  constructor(private readonly commerce: MarketplaceCommerceService) {}

  @Get('catalog')
  catalog() { return this.commerce.catalog(); }

  @Get('starter-bundles')
  starterBundles() { return this.commerce.starterBundles(); }

  @Get('orders')
  listOrders() { return this.commerce.listOrders(); }

  @Post('orders')
  createOrder(@Body() body: { priceId?: string; priceIds?: string[]; currency?: string }) {
    const priceIds = Array.isArray(body?.priceIds) ? body.priceIds.map(String) : [String(body?.priceId || '')];
    return this.commerce.createOrder(priceIds, String(body?.currency || ''));
  }

  @Post('plugins/:pluginId/:version/install')
  install(@Param('pluginId') pluginId: string, @Param('version') version: string, @Body() body: { activate?: boolean; consentDigest?: string }) {
    return this.commerce.install(pluginId, version, body?.activate === true, String(body?.consentDigest || ''));
  }

  @Post('starter-bundles/:bundleId/install')
  installBundle(
    @Param('bundleId') bundleId: string,
    @Body() body: { plugins?: Array<{ pluginId?: string; version?: string; consentDigest?: string }>; activate?: boolean },
  ) {
    return this.commerce.installBundle(bundleId, body?.plugins, body?.activate === true);
  }
}
