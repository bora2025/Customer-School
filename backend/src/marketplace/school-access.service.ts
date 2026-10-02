import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * No successful billing sync for this long lifts the lock. After a week without contact the likely
 * cause is on Wattanam's side -- an outage, a URL, a key -- and the standing rule (ADR-0006) is that
 * a Wattanam failure must never harm a school. Safe only because hosting is managed: a school cannot
 * cut its own server off from the marketplace to get unlocked.
 */
export const OUTAGE_UNLOCK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Short enough that a lock or an unlock written by the sync -- possibly in another process -- is felt within seconds. */
const CACHE_MS = 5_000;

export type SchoolAccessRow = { access: string; reason?: string | null; lastVerifiedAt?: Date | null } | null;
export type SchoolAccess = { suspended: boolean; reason: string | null; lockLiftedByOutage: boolean };

/**
 * Whether the stored billing decision locks the school right now.
 *
 * The seven-day rule is applied here, when the decision is read, rather than written back: the stored
 * row stays the marketplace's last word, so the moment contact is restored a school that is still
 * unpaid locks again, and one that paid in the meantime stays open. A row with no verification time
 * was never written by a sync, so there is no outage to measure and it is taken as it stands.
 */
export function evaluateSchoolAccess(row: SchoolAccessRow, now: Date): SchoolAccess {
  if (!row || row.access !== 'SUSPENDED') return { suspended: false, reason: null, lockLiftedByOutage: false };
  const verifiedAt = row.lastVerifiedAt ? new Date(row.lastVerifiedAt).getTime() : null;
  if (verifiedAt !== null && now.getTime() - verifiedAt > OUTAGE_UNLOCK_AFTER_MS) {
    return { suspended: false, reason: null, lockLiftedByOutage: true };
  }
  return { suspended: true, reason: row.reason || null, lockLiftedByOutage: false };
}

/**
 * The one answer to "is this school locked for an unpaid platform bill?". Every surface that serves
 * the school asks it: the HTTP guard, the three Socket.IO gateways, the email digests and plugin jobs.
 *
 * Deliberately NOT paused by the lock, because they protect the school or are how it recovers:
 * - backups (BackupService.scheduledBackup) and audit clean-up (AuditService.runScheduledCleanup)
 *   look after the school's own data;
 * - the billing sync (SchoolBillingControlService) is how the lock learns it can lift;
 * - the entitlement refresh (EntitlementCacheService) keeps plugin licences current for the day the
 *   school returns.
 */
@Injectable()
export class SchoolAccessService {
  private cached: { at: number; value: SchoolAccess } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async current(now = new Date()): Promise<SchoolAccess> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const row = await this.prisma.marketplaceSchoolControl.findUnique({
      where: { id: 'singleton' },
      select: { access: true, reason: true, lastVerifiedAt: true },
    });
    const value = evaluateSchoolAccess(row, now);
    this.cached = { at: Date.now(), value };
    return value;
  }

  async isSuspended(now = new Date()): Promise<boolean> {
    return (await this.current(now)).suspended;
  }

  /**
   * What the public lock screen may know: whether the school is locked, and what it is called.
   * Never an amount or a reason -- students and parents have no business seeing the school's debts.
   */
  async publicStatus(): Promise<{ access: 'ACTIVE' | 'SUSPENDED'; schoolName: string | null }> {
    const [access, installation] = await Promise.all([
      this.current(),
      this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { schoolName: true } }),
    ]);
    return { access: access.suspended ? 'SUSPENDED' : 'ACTIVE', schoolName: installation?.schoolName ?? null };
  }
}
