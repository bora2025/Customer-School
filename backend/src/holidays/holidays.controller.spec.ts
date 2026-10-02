import { HolidaysController } from './holidays.controller';

function req(userId: string) {
  return { user: { userId, role: 'ADMIN' } } as any;
}

describe('HolidaysController', () => {
  it('createHoliday always attributes createdById to the authenticated caller, never a body-supplied value', async () => {
    const createHoliday = jest.fn().mockResolvedValue({ id: 'h1' });
    const controller = new HolidaysController({ createHoliday } as any);

    const body = { date: '2026-01-01', name: 'New Year', createdById: 'some-other-admin-id' };
    await controller.createHoliday(body, req('the-real-caller-id'));

    expect(createHoliday).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-01-01', name: 'New Year', createdById: 'the-real-caller-id',
    }));
  });

  it('still works when the body omits createdById entirely', async () => {
    const createHoliday = jest.fn().mockResolvedValue({ id: 'h1' });
    const controller = new HolidaysController({ createHoliday } as any);

    await controller.createHoliday({ date: '2026-01-01', name: 'New Year' } as any, req('caller-2'));

    expect(createHoliday).toHaveBeenCalledWith(expect.objectContaining({ createdById: 'caller-2' }));
  });
});
