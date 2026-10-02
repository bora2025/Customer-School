import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SchoolAccessService } from './school-access.service';

// A suspended school must still be able to authenticate, sign out, and reach the one recovery
// surface that explains the debt. Blocking /auth made an expired administrator session
// unrecoverable: the person who could resolve the bill could no longer sign in. /school-access is
// what the lock screen polls, and /admin/data-export lets the SUPER_ADMIN take the school's own
// records out. Every controller on this list still checks who is asking; the list only lets a
// request get past the lock, which runs before sign-in is checked and so cannot tell roles apart.
const ALLOWED_WHILE_SUSPENDED = ['/health', '/health/ready', '/version', '/auth', '/admin/marketplace/billing-control', '/school-access', '/admin/data-export'];

@Injectable()
export class SchoolBillingAccessGuard implements CanActivate {
  constructor(private readonly access: SchoolAccessService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ path?: string; url?: string }>();
    const path = request.path || request.url?.split('?')[0] || '';
    if (ALLOWED_WHILE_SUSPENDED.some(allowed => path === allowed || path.startsWith(`${allowed}/`))) return true;
    const state = await this.access.current();
    if (state.suspended) throw new HttpException({ code: 'SCHOOL_BILLING_SUSPENDED', message: state.reason || 'School access is suspended because a platform invoice is unpaid' }, HttpStatus.PAYMENT_REQUIRED);
    return true;
  }
}
