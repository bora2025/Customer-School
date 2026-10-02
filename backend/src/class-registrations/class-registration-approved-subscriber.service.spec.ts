import { Test, TestingModule } from '@nestjs/testing';
import { ClassRegistrationApprovedSubscriber } from './class-registration-approved-subscriber.service';
import { PluginEventBus } from '../plugins/plugin-events';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';

describe('ClassRegistrationApprovedSubscriber', () => {
  let subscriber: ClassRegistrationApprovedSubscriber;
  let eventBus: PluginEventBus;
  const txUserCreate = jest.fn();
  const txStudentCreate = jest.fn();
  const txStudentCount = jest.fn().mockResolvedValue(5);
  const txExecuteRaw = jest.fn();
  const sendEmail = jest.fn().mockResolvedValue({ sent: true });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassRegistrationApprovedSubscriber,
        PluginEventBus,
        {
          provide: PrismaService,
          useValue: {
            $transaction: async (work: any) => work({
              user: { create: txUserCreate, findUnique: jest.fn().mockResolvedValue(null) },
              student: { create: txStudentCreate, count: txStudentCount },
              $executeRawUnsafe: txExecuteRaw,
            }),
          },
        },
        { provide: NotificationService, useValue: { sendEmail } },
      ],
    }).compile();

    subscriber = module.get(ClassRegistrationApprovedSubscriber);
    eventBus = module.get(PluginEventBus);
    subscriber.onModuleInit();
  });

  it('creates a user and student on approved registration event', async () => {
    txUserCreate.mockResolvedValue({ id: 'u-new' });
    txStudentCreate.mockResolvedValue({ id: 's-new' });

    eventBus.publish('academic.registration.approved.v1', {
      registrationId: 'r1',
      classId: 'c1',
      nameEn: 'Student One',
      email: 'student@school.test',
      phone: '+85512345678',
      passwordHash: 'bcrypt-hash',
      photo: 'photo-url',
      sex: 'MALE',
      generation: '2026',
      customFieldValues: { field1: 'value1' },
      resolvedBy: 'a1',
      resolvedAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(txUserCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'student@school.test', name: 'Student One', role: 'STUDENT', password: 'bcrypt-hash' }),
    }));
    expect(txStudentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u-new', classId: 'c1', studentNumber: '0006' }),
    }));
    expect(txExecuteRaw).toHaveBeenCalledWith(
      'UPDATE "plugin_wattanam_academic_management_class_registration" SET "studentId" = $1 WHERE "id" = $2',
      's-new',
      'r1',
    );
  });

  it('skips when a user with the same email already exists', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassRegistrationApprovedSubscriber,
        PluginEventBus,
        {
          provide: PrismaService,
          useValue: {
            $transaction: async (work: any) => work({
              user: { create: txUserCreate, findUnique: jest.fn().mockResolvedValue({ id: 'u-existing' }) },
              student: { create: txStudentCreate, count: txStudentCount },
              $executeRawUnsafe: txExecuteRaw,
            }),
          },
        },
        { provide: NotificationService, useValue: { sendEmail } },
      ],
    }).compile();
    const localSubscriber = module.get(ClassRegistrationApprovedSubscriber);
    const localEventBus = module.get(PluginEventBus);
    localSubscriber.onModuleInit();

    localEventBus.publish('academic.registration.approved.v1', {
      registrationId: 'r2',
      classId: 'c1',
      nameEn: 'Student Two',
      email: 'existing@school.test',
      passwordHash: 'bcrypt-hash',
      resolvedBy: 'a1',
      resolvedAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(txUserCreate).not.toHaveBeenCalled();
    expect(txStudentCreate).not.toHaveBeenCalled();
  });
});
