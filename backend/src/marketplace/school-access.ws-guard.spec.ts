jest.mock('../common/socket-auth', () => ({
  authenticateSocket: jest.fn().mockResolvedValue({ userId: 'driver-1', role: 'WATTAMAN' }),
  requireSocketUser: jest.fn().mockReturnValue({ userId: 'driver-1', role: 'WATTAMAN' }),
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WsException } from '@nestjs/websockets';
import { AttendanceGateway } from '../attendance/attendance.gateway';
import { BusGateway } from '../bus/bus.gateway';
import { MessagesGateway } from '../parent/messages.gateway';
import { SchoolAccessWsGuard, disconnectIfSuspended } from './school-access.ws-guard';

const access = (suspended: boolean) => ({ isSuspended: jest.fn().mockResolvedValue(suspended) }) as any;
const socket = () => ({ id: 'socket-1', emit: jest.fn(), disconnect: jest.fn(), handshake: { auth: {}, headers: {} }, data: {} }) as any;

describe('SchoolAccessWsGuard', () => {
  it('refuses every socket message while the school is locked, and says why', async () => {
    const refusal = await new SchoolAccessWsGuard(access(true)).canActivate().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(WsException);
    expect((refusal as WsException).getError()).toMatchObject({ code: 'SCHOOL_BILLING_SUSPENDED' });
  });

  it('lets messages through for an active school', async () => {
    await expect(new SchoolAccessWsGuard(access(false)).canActivate()).resolves.toBe(true);
  });

  // Global guards never reach a gateway, so each has to name the lock itself -- or it is not locked.
  it.each([
    ['bus', BusGateway],
    ['attendance', AttendanceGateway],
    ['messages', MessagesGateway],
  ])('puts every %s gateway message behind the lock', (_name, gateway) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, gateway)).toContain(SchoolAccessWsGuard);
  });
});

describe('disconnectIfSuspended', () => {
  it('tells the client why and closes the socket while locked', async () => {
    const client = socket();
    await expect(disconnectIfSuspended(access(true), client)).resolves.toBe(true);
    expect(client.emit).toHaveBeenCalledWith('exception', expect.objectContaining({ code: 'SCHOOL_BILLING_SUSPENDED' }));
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("leaves an active school's socket alone", async () => {
    const client = socket();
    await expect(disconnectIfSuspended(access(false), client)).resolves.toBe(false);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  // Throwing from handleConnection would be an unhandled rejection, which can take the process down.
  it('lets the connection through when the lock cannot be read', async () => {
    const client = socket();
    const unreadable = { isSuspended: jest.fn().mockRejectedValue(new Error('database unavailable')) } as any;
    await expect(disconnectIfSuspended(unreadable, client)).resolves.toBe(false);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});

describe('gateway connections while the school is locked', () => {
  it('the bus gateway closes a signed-in socket instead of accepting it', async () => {
    const client = socket();
    await new BusGateway({} as any, {} as any, access(true)).handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('the attendance and messages gateways do the same', async () => {
    const first = socket();
    const second = socket();
    await new AttendanceGateway({} as any, access(true)).handleConnection(first);
    await new MessagesGateway({} as any, access(true)).handleConnection(second);
    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.disconnect).toHaveBeenCalledWith(true);
  });

  it('an active school keeps its sockets', async () => {
    const client = socket();
    await new MessagesGateway({} as any, access(false)).handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
