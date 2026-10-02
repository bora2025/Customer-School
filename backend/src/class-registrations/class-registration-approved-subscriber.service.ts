import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PluginEventBus } from '../plugins/plugin-events';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { normalizePhone } from '../common/identity';

const REGISTRATION_TABLE = 'plugin_wattanam_academic_management_class_registration';

interface ApprovedRegistrationEvent {
  registrationId: string;
  classId: string;
  nameEn: string;
  nameKh?: string | null;
  email?: string | null;
  phone?: string | null;
  passwordHash: string;
  photo?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  generation?: string | null;
  customFieldValues?: Record<string, string | string[]> | null;
  resolvedBy: string;
  resolvedAt: string;
}

@Injectable()
export class ClassRegistrationApprovedSubscriber implements OnModuleInit {
  private readonly logger = new Logger(ClassRegistrationApprovedSubscriber.name);

  constructor(
    private readonly eventBus: PluginEventBus,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe<ApprovedRegistrationEvent>('academic.registration.approved.v1', (payload) => this.handle(payload));
  }

  private async handle(payload: ApprovedRegistrationEvent) {
    const normalizedPhone = normalizePhone(payload.phone);
    try {
      await this.prisma.$transaction(async (tx) => {
        const existingUser = payload.email
          ? await tx.user.findUnique({ where: { email: payload.email } })
          : normalizedPhone
            ? await tx.user.findUnique({ where: { phoneNormalized: normalizedPhone } })
            : null;
        if (existingUser) {
          this.logger.warn(`Approved registration ${payload.registrationId} skipped: user already exists`);
          return;
        }

        const user = await tx.user.create({
          data: {
            email: payload.email || undefined,
            password: payload.passwordHash,
            name: payload.nameEn,
            phone: payload.phone || undefined,
            phoneNormalized: normalizedPhone || undefined,
            role: 'STUDENT',
          },
        });

        const count = await tx.student.count({ where: { classId: payload.classId } });
        const studentNumber = String(count + 1).padStart(4, '0');

        const student = await tx.student.create({
          data: {
            userId: user.id,
            classId: payload.classId,
            studentNumber,
            nameKh: payload.nameKh || undefined,
            photo: payload.photo || undefined,
            sex: payload.sex || undefined,
            dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : undefined,
            address: payload.address || undefined,
            generation: payload.generation || undefined,
            customFieldValues: payload.customFieldValues ?? undefined,
          },
        });

        await tx.$executeRawUnsafe(
          `UPDATE "${REGISTRATION_TABLE}" SET "studentId" = $1 WHERE "id" = $2`,
          student.id,
          payload.registrationId,
        );
      });

      if (payload.email) {
        try {
          await this.notificationService.sendEmail(
            payload.email,
            'Your class registration is approved',
            `Hi ${payload.nameEn}, your registration has been approved. Log in at your school portal with the email and password you registered with.`,
          );
        } catch {}
      }
    } catch (error) {
      this.logger.error(`Failed to create student for approved registration ${payload.registrationId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
