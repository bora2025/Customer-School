import { CanActivate, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { SchoolAccessService } from './school-access.service';

export const SCHOOL_BILLING_SUSPENDED = 'SCHOOL_BILLING_SUSPENDED';
const SUSPENDED_MESSAGE = 'School access is suspended because a platform invoice is unpaid';

/**
 * The billing lock for Socket.IO messages.
 *
 * Global guards never reach a gateway: Nest builds the WebSocket guard runner without the application
 * config (`new GuardsContextCreator(container)` in @nestjs/websockets' socket-module), so APP_GUARD is
 * simply not consulted there. Each gateway therefore names this guard with @UseGuards. It is what stops
 * a socket opened before the lock from carrying on after it -- a driver's phone writing bus positions.
 */
@Injectable()
export class SchoolAccessWsGuard implements CanActivate {
  constructor(private readonly access: SchoolAccessService) {}

  async canActivate(): Promise<boolean> {
    if (await this.access.isSuspended()) throw new WsException({ code: SCHOOL_BILLING_SUSPENDED, message: SUSPENDED_MESSAGE });
    return true;
  }
}

/**
 * For handleConnection, which no guard reaches: tell the client why, then close the socket. A
 * server-side disconnect is not retried by the Socket.IO client, so a locked school's pages do not
 * hammer the server with reconnects. If the lock cannot be read at all the connection is let through,
 * as the HTTP guard's database failure would surface elsewhere -- and throwing from handleConnection
 * would be an unhandled rejection.
 */
export async function disconnectIfSuspended(access: SchoolAccessService, client: Socket): Promise<boolean> {
  const suspended = await access.isSuspended().catch(() => false);
  if (!suspended) return false;
  client.emit('exception', { status: 'error', code: SCHOOL_BILLING_SUSPENDED, message: SUSPENDED_MESSAGE });
  client.disconnect(true);
  return true;
}
