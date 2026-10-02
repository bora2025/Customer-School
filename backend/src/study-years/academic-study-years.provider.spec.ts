import { PrismaAcademicStudyYearsProvider } from './academic-study-years.provider';
import { StudyYearsService } from './study-years.service';

describe('Academic Management study-year boundary', () => {
  it('delegates the current-year command with a deterministic key', async () => {
    const academic = { setCurrent: jest.fn().mockResolvedValue({ id: 'y1' }) } as any;
    await expect(new StudyYearsService(academic).setCurrent('y1')).resolves.toEqual({ id: 'y1' });
    expect(academic.setCurrent).toHaveBeenCalledWith({ id: 'y1', idempotencyKey: 'set-current-study-year:y1' });
  });

  it('serializes and atomically changes current year only after target existence is checked', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      studyYear: {
        findUnique: jest.fn().mockResolvedValue({ id: 'y1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'y1', isCurrent: true }),
      },
    } as any;
    const prisma = { $transaction: jest.fn((work) => work(tx)) } as any;
    await expect(new PrismaAcademicStudyYearsProvider(prisma).setCurrent({ id: 'y1', idempotencyKey: 'set-current-study-year:y1' }))
      .resolves.toMatchObject({ isCurrent: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.studyYear.findUnique).toHaveBeenCalledWith({ where: { id: 'y1' }, select: { id: true } });
    expect(tx.studyYear.updateMany).toHaveBeenCalledWith({ where: { isCurrent: true, NOT: { id: 'y1' } }, data: { isCurrent: false } });
  });

  it('does not unset the existing year for a missing target or bad command key', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      studyYear: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), update: jest.fn() },
    } as any;
    const prisma = { $transaction: jest.fn((work) => work(tx)) } as any;
    const provider = new PrismaAcademicStudyYearsProvider(prisma);
    await expect(provider.setCurrent({ id: 'missing', idempotencyKey: 'bad' })).rejects.toThrow('invalid idempotency key');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(provider.setCurrent({ id: 'missing', idempotencyKey: 'set-current-study-year:missing' }))
      .rejects.toThrow('Study year not found');
    expect(tx.studyYear.updateMany).not.toHaveBeenCalled();
    expect(tx.studyYear.update).not.toHaveBeenCalled();
  });
});
