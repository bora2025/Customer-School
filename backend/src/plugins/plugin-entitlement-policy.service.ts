import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type PluginEntitlementMode = 'unmanaged' | 'active' | 'grace' | 'read_only';

export interface PluginEntitlementDecision {
  pluginId: string;
  mode: PluginEntitlementMode;
  reason: string;
  expiresAt: Date | null;
  updatesThrough: Date | null;
  offlineRecheckAfter: Date | null;
}

/**
 * Central runtime policy for per-plugin licences. Absence/NONE means the release is free or
 * subscription-included; a paid Marketplace install creates a verified cache row before it may be
 * activated. Once a paid entitlement exists, outages retain the last-known-good dates, while a
 * terminal status or elapsed licence window makes only that plugin read-only.
 */
@Injectable()
export class PluginEntitlementPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async decision(pluginId: string, now = new Date()): Promise<PluginEntitlementDecision> {
    const cache = await this.prisma.pluginEntitlementCache.findUnique({ where: { pluginId } });
    const base = {
      pluginId,
      expiresAt: cache?.expiresAt ?? null,
      updatesThrough: cache?.updatesThrough ?? null,
      offlineRecheckAfter: cache?.offlineRecheckAfter ?? null,
    };
    if (!cache || cache.status === 'NONE') return { ...base, mode: 'unmanaged', reason: 'No paid entitlement is required' };
    if (['REVOKED', 'REFUNDED', 'EXPIRED'].includes(cache.status)) {
      return { ...base, mode: 'read_only', reason: `Marketplace entitlement is ${cache.status.toLowerCase()}` };
    }
    if (!cache.expiresAt || now.getTime() > cache.expiresAt.getTime()) {
      return { ...base, mode: 'read_only', reason: 'Marketplace entitlement has expired' };
    }
    if (cache.offlineRecheckAfter && now.getTime() > cache.offlineRecheckAfter.getTime()) {
      return { ...base, mode: 'grace', reason: 'Marketplace refresh is overdue; last verified licence remains valid until expiry' };
    }
    return { ...base, mode: 'active', reason: 'Marketplace entitlement is active' };
  }

  async assertCanActivate(pluginId: string, now = new Date()) {
    const decision = await this.decision(pluginId, now);
    if (decision.mode === 'read_only') this.denied(decision, 'activate');
    return decision;
  }

  async assertCanUpdate(pluginId: string, now = new Date()) {
    const decision = await this.decision(pluginId, now);
    if (decision.mode === 'read_only' || (decision.updatesThrough && now.getTime() > decision.updatesThrough.getTime())) {
      this.denied(decision, 'update');
    }
    return decision;
  }

  async assertRouteAllowed(pluginId: string, method: string, now = new Date()) {
    const decision = await this.decision(pluginId, now);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && decision.mode === 'read_only') this.denied(decision, 'write');
    return decision;
  }

  async jobsAllowed(pluginId: string, now = new Date()) {
    return (await this.decision(pluginId, now)).mode !== 'read_only';
  }

  private denied(decision: PluginEntitlementDecision, action: string): never {
    throw new HttpException({
      statusCode: HttpStatus.PAYMENT_REQUIRED,
      code: 'PLUGIN_ENTITLEMENT_READ_ONLY',
      message: `${decision.pluginId} is read-only and cannot ${action}: ${decision.reason}`,
      pluginId: decision.pluginId,
      entitlement: decision,
    }, HttpStatus.PAYMENT_REQUIRED);
  }
}
