import { ScoringService } from './scoring.service';

describe('ScoringService', () => {
  it('scopes class-admin sheets through DirectoryService classesForUser', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'sheet-1' }]);
    const prisma = {
      scoreSheet: { findMany },
      class: { findMany: jest.fn() },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1', 'class-2']),
    } as any;
    const service = new ScoringService(prisma, directory);

    const result = await service.getSheetsForClassAdmin('admin-1');

    expect(directory.classesForUser).toHaveBeenCalledWith('admin-1', 'CLASS_ADMIN');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        classes: { some: { classId: { in: ['class-1', 'class-2'] } } },
      },
    }));
    expect(prisma.class.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 'sheet-1' }]);
  });

  it('returns empty list when directory has no class-admin memberships', async () => {
    const findMany = jest.fn();
    const prisma = {
      scoreSheet: { findMany },
      class: { findMany: jest.fn() },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new ScoringService(prisma, directory);

    const result = await service.getSheetsForClassAdmin('admin-2');

    expect(directory.classesForUser).toHaveBeenCalledWith('admin-2', 'CLASS_ADMIN');
    expect(findMany).not.toHaveBeenCalled();
    expect(prisma.class.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
