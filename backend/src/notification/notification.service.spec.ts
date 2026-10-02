jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));
jest.mock('twilio', () => jest.fn());

import { NotificationService } from './notification.service';

describe('NotificationService.notifyInApp', () => {
  it('logs a row in the shared Notification inbox and returns its id', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'notif-1' });
    const service = new NotificationService({ notification: { create } } as any);

    await expect(service.notifyInApp('user-1', 'Title: Body', 'announcement')).resolves.toEqual({ id: 'notif-1' });
    expect(create).toHaveBeenCalledWith({ data: { userId: 'user-1', message: 'Title: Body', type: 'announcement' } });
  });
});
