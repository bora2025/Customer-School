import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AcademicLifecycleSubscriber } from './academic-lifecycle-subscriber.service';
import { PluginEventBus } from '../plugins/plugin-events';

describe('AcademicLifecycleSubscriber', () => {
  let subscriber: AcademicLifecycleSubscriber;
  let eventBus: PluginEventBus;
  const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AcademicLifecycleSubscriber, PluginEventBus],
    }).compile();
    subscriber = module.get(AcademicLifecycleSubscriber);
    eventBus = module.get(PluginEventBus);
    subscriber.onModuleInit();
  });

  afterAll(() => logSpy.mockRestore());

  it('logs study-year and class lifecycle events', async () => {
    eventBus.publish('academic.study-year.created.v1', { studyYear: { id: 'y1', year: 2026, isCurrent: false }, principal: { userId: 'a1' } });
    eventBus.publish('academic.class.updated.v1', { class: { id: 'c1', name: 'G1A', teacherId: 't1' }, principal: { userId: 'a1' } });
    eventBus.publish('academic.class.deleted.v1', { classId: 'c1', principal: { userId: 'a1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.study-year.created.v1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.class.updated.v1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.class.deleted.v1'));
  });

  it('logs student class membership events', async () => {
    eventBus.publish('academic.student.added-to-class.v1', { student: { id: 's1', userId: 'u1' }, classId: 'c1', principal: { userId: 'a1' } });
    eventBus.publish('academic.student.updated.v1', { student: { id: 's1', userId: 'u1' }, principal: { userId: 'a1' } });
    eventBus.publish('academic.student.removed-from-class.v1', { studentId: 's1', classId: 'c1', principal: { userId: 'a1' } });
    eventBus.publish('academic.students.cleaned-up.v1', { studentIds: ['s2'], deleted: 1, principal: { userId: 'a1' } });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.student.added-to-class.v1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.student.updated.v1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.student.removed-from-class.v1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('academic.students.cleaned-up.v1'));
  });
});
