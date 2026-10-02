import { DigestService } from './digest.service';

describe('DigestService and the billing lock', () => {
  function harness(suspended: boolean) {
    const prisma = {
      notificationPreference: { findMany: jest.fn().mockResolvedValue([{ userId: 'parent-1', user: { id: 'parent-1', email: 'parent@school.test', name: 'Dara' } }]) },
      message: { count: jest.fn().mockResolvedValue(2) },
      notification: { count: jest.fn().mockResolvedValue(0) },
    } as any;
    const notifications = { sendEmail: jest.fn() } as any;
    const service = new DigestService(prisma, notifications, { isSuspended: jest.fn().mockResolvedValue(suspended) } as any);
    return { service, prisma, notifications };
  }

  // A school locked for an unpaid platform bill gets no service, and that includes these emails.
  it('sends no digest while the school is locked', async () => {
    const { service, prisma, notifications } = harness(true);
    await service.sendDailyDigests();
    await service.sendWeeklyDigests();
    expect(prisma.notificationPreference.findMany).not.toHaveBeenCalled();
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('sends as before for an active school', async () => {
    const { service, notifications } = harness(false);
    await service.sendDailyDigests();
    expect(notifications.sendEmail).toHaveBeenCalledWith('parent@school.test', 'Your daily school summary', expect.stringContaining('Unread messages: 2'));
  });
});
