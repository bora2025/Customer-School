import { AnnouncementsController } from './announcements.controller';

function req(user: { userId: string; role: string; email?: string }) {
  return { user } as any;
}

describe('AnnouncementsController (proxy)', () => {
  const principal = { userId: 'u1', role: 'TEACHER', email: 't@example.com' };

  it('translates each REST route to a dispatch() call against the plugin, with no Prisma involved', async () => {
    const dispatch = jest.fn().mockResolvedValue({ ok: true });
    const controller = new AnnouncementsController({ dispatch } as any);

    await controller.listAll(req(principal));
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'GET', path: 'all', params: {}, query: {}, body: {}, principal });

    await controller.feed(req(principal), { take: '10', skip: '0' });
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'GET', path: 'feed', params: {}, query: { take: '10', skip: '0' }, body: {}, principal });

    await controller.unread(req(principal));
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'GET', path: 'unread-count', params: {}, query: {}, body: {}, principal });

    await controller.markRead('a1', req(principal));
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'PATCH', path: 'read', params: {}, query: {}, body: { id: 'a1' }, principal });

    const createBody = { title: 'Hi', body: 'There', audience: 'SCHOOL' };
    await controller.create(createBody, req(principal));
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'POST', path: 'create', params: {}, query: {}, body: createBody, principal });

    await controller.remove('a1', req(principal));
    expect(dispatch).toHaveBeenLastCalledWith('wattanam.announcements', { method: 'DELETE', path: 'remove', params: {}, query: {}, body: { id: 'a1' }, principal });

    expect(dispatch).toHaveBeenCalledTimes(6);
  });
});
