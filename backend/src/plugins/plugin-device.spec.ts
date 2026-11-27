import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PluginDeviceController } from './plugin-device.controller';
import { PluginDeviceCredentialsService } from './plugin-device-credentials.service';
import { PluginExtensionsService } from './plugin-extensions.service';

// Device credentials: keys for terminals calling a plugin without a user session.
describe('plugin device credentials', () => {
  function credentials() {
    const rows: any[] = [];
    const prisma = {
      pluginDeviceCredential: {
        count: jest.fn(async ({ where }: any) => rows.filter((r) => r.pluginId === where.pluginId && !r.revokedAt).length),
        create: jest.fn(async ({ data }: any) => { const row = { id: `c${rows.length + 1}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data }; rows.push(row); return row; }),
        findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.pluginId === where.pluginId)),
        findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) || null),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async ({ where, data }: any) => { const hit = rows.filter((r) => r.id === where.id && r.pluginId === where.pluginId && !r.revokedAt); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
      },
    } as any;
    return { service: new PluginDeviceCredentialsService(prisma), rows };
  }

  it('issues a key once, keeps only its hash, and verifies it for its own plugin only', async () => {
    const { service, rows } = credentials();
    const issued = await service.issue('wattanam.smart-attendance', { name: 'Gate terminal', scope: 'terminal/' });
    expect(issued.token).toMatch(/^wtd_[A-Za-z0-9_-]{32}$/);
    expect(issued.scope).toBe('terminal');
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(JSON.stringify(await service.list('wattanam.smart-attendance'))).not.toContain(issued.token);
    expect((await service.verify('wattanam.smart-attendance', issued.token))?.id).toBe(issued.id);
    expect(await service.verify('wattanam.other', issued.token)).toBeNull();
    expect(await service.verify('wattanam.smart-attendance', 'wtd_wrong-key-0123456789abcdef')).toBeNull();
    expect(await service.verify('wattanam.smart-attendance', 'not a key')).toBeNull();
    expect((await service.revoke('wattanam.smart-attendance', issued.id)).revoked).toBe(true);
    expect(await service.verify('wattanam.smart-attendance', issued.token)).toBeNull();
  });

  it('refuses unclear names and scopes', async () => {
    const { service } = credentials();
    await expect(service.issue('p', { name: '', scope: 'terminal' })).rejects.toThrow('name');
    await expect(service.issue('p', { name: 'x', scope: '../admin' })).rejects.toThrow('scope');
    await expect(service.issue('p', { name: 'x', scope: '' })).rejects.toThrow('scope');
  });

  it('the device endpoint checks the key and its scope, and calls the plugin as a DEVICE', async () => {
    const credential = { id: 'c1', pluginId: 'wattanam.smart-attendance', name: 'Gate', scope: 'terminal' };
    const verify = jest.fn(async (pluginId: string, token: string) => (token === 'wtd_good-key-0123456789abcdef' && pluginId === credential.pluginId ? credential : null));
    const dispatch = jest.fn(async () => ({ ok: true }));
    const controller = new PluginDeviceController({ verify } as any, { dispatch } as any);
    const request = (path: string, headers: Record<string, string>) => ({ method: 'POST', params: { splat: path.split('/') }, headers, query: {}, body: { events: [] } }) as any;
    await expect(controller.dispatch(credential.pluginId, request('terminal/events', {}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.dispatch(credential.pluginId, request('terminal/events', { authorization: 'Bearer wtd_bad' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.dispatch(credential.pluginId, request('stations', { authorization: 'Bearer wtd_good-key-0123456789abcdef' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.dispatch(credential.pluginId, request('terminalx/events', { authorization: 'Bearer wtd_good-key-0123456789abcdef' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.dispatch(credential.pluginId, request('terminal/events', { 'x-wattanam-device-key': 'wtd_good-key-0123456789abcdef' }))).resolves.toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledWith(credential.pluginId, expect.objectContaining({ path: 'terminal/events', principal: expect.objectContaining({ userId: 'device:c1', role: 'DEVICE' }) }));
  });

  it('device routes answer only devices, user routes only users', async () => {
    const grants = { isGranted: jest.fn().mockResolvedValue(true) } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const extensions = new PluginExtensionsService(grants, audit);
    const declared = new Set(['acme.widget.view']);
    extensions.registerRoute('acme.widget', declared, { method: 'POST', path: 'terminal/events', permission: 'acme.widget.view', access: 'device', handler: () => 'device-ok' });
    extensions.registerRoute('acme.widget', declared, { method: 'GET', path: 'stations', permission: 'acme.widget.view', handler: () => 'user-ok' });
    expect(() => extensions.registerRoute('acme.widget', declared, { method: 'GET', path: 'x', permission: 'acme.widget.view', access: 'robot' as any, handler: () => null })).toThrow('access');
    const call = (method: string, path: string, role: string) => extensions.dispatch('acme.widget', { method: method as any, path, params: {}, query: {}, body: {}, principal: { userId: role === 'DEVICE' ? 'device:c1' : 'u1', role } });
    await expect(call('POST', 'terminal/events', 'DEVICE')).resolves.toBe('device-ok');
    expect(grants.isGranted).not.toHaveBeenCalled();
    await expect(call('POST', 'terminal/events', 'SUPER_ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    await expect(call('GET', 'stations', 'DEVICE')).rejects.toBeInstanceOf(NotFoundException);
    await expect(call('GET', 'stations', 'TEACHER')).resolves.toBe('user-ok');
  });
});
