import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { isValidEmail, normalizePhone, generatePassword } from '../common/identity';

const MIN_PASSWORD_LENGTH = 6;
const FIELD_MODES = ['REQUIRED', 'OPTIONAL', 'HIDDEN'] as const;
type FieldMode = (typeof FIELD_MODES)[number];
const CUSTOM_FIELD_TYPES = ['TEXT', 'SELECT', 'MULTI_SELECT'] as const;
const CUSTOM_FIELD_TYPES_WITH_OPTIONS = ['SELECT', 'MULTI_SELECT'];

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  );
}

// Shared by createField/updateField — validates fieldType and, when SELECT or
// MULTI_SELECT, cleans the options list (trim/dedupe/drop blanks, require at least 2).
function sanitizeFieldTypeAndOptions(fieldType: string | undefined, options: unknown): { fieldType?: string; options?: string[] | null } {
  if (fieldType === undefined) return {};
  const type = String(fieldType).toUpperCase();
  if (!CUSTOM_FIELD_TYPES.includes(type as any)) {
    throw new BadRequestException(`fieldType must be one of ${CUSTOM_FIELD_TYPES.join(', ')}`);
  }
  if (!CUSTOM_FIELD_TYPES_WITH_OPTIONS.includes(type)) return { fieldType: type, options: null };

  const cleaned = Array.from(
    new Set((Array.isArray(options) ? options : []).map((o) => String(o).trim()).filter(Boolean)),
  );
  if (cleaned.length < 2) throw new BadRequestException('This field needs at least 2 options');
  return { fieldType: type, options: cleaned };
}

@Injectable()
export class ClassRegistrationsService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // ─── Public: form configuration ────────────────────────────────────────
  async getFormConfig() {
    const settings = await this.getOrCreateSettings();
    const fields = await this.prisma.classRegistrationField.findMany({
      where: { enabled: true },
      orderBy: { order: 'asc' },
    });
    return { settings, fields };
  }

  private async getOrCreateSettings() {
    return this.prisma.classRegistrationSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
  }

  // ─── Admin: settings ────────────────────────────────────────────────────
  async getSettings() {
    return this.getOrCreateSettings();
  }

  async updateSettings(body: {
    khmerNameMode?: string;
    phoneMode?: string;
    emailMode?: string;
    photoMode?: string;
    passwordMode?: string;
    sexMode?: string;
    dateOfBirthMode?: string;
    addressMode?: string;
    generationMode?: string;
  }) {
    const data: Record<string, string> = {};
    for (const key of [
      'khmerNameMode',
      'phoneMode',
      'emailMode',
      'photoMode',
      'passwordMode',
      'sexMode',
      'dateOfBirthMode',
      'addressMode',
      'generationMode',
    ] as const) {
      const v = body?.[key];
      if (v === undefined) continue;
      if (!FIELD_MODES.includes(v as FieldMode)) {
        throw new BadRequestException(`${key} must be one of ${FIELD_MODES.join(', ')}`);
      }
      data[key] = v;
    }
    const current = await this.getOrCreateSettings();
    const nextEmailMode = data.emailMode ?? current.emailMode;
    const nextPhoneMode = data.phoneMode ?? current.phoneMode;
    if (nextEmailMode === 'HIDDEN' && nextPhoneMode === 'HIDDEN') {
      throw new BadRequestException('Email and Phone cannot both be hidden — a student needs at least one to create a login');
    }
    return this.prisma.classRegistrationSettings.update({ where: { id: 'singleton' }, data });
  }

  // ─── Admin: custom fields CRUD ──────────────────────────────────────────
  async listFields() {
    return this.prisma.classRegistrationField.findMany({ orderBy: { order: 'asc' } });
  }

  async createField(body: { label: string; required?: boolean; fieldType?: string; options?: string[] }) {
    const label = (body?.label || '').trim();
    if (!label) throw new BadRequestException('label is required');
    const { fieldType, options } = sanitizeFieldTypeAndOptions(body.fieldType ?? 'TEXT', body.options);

    const base = slugify(label);
    let key = base;
    let n = 1;
    while (await this.prisma.classRegistrationField.findUnique({ where: { key } })) {
      key = `${base}_${++n}`;
    }

    const maxOrder = await this.prisma.classRegistrationField.aggregate({ _max: { order: true } });
    return this.prisma.classRegistrationField.create({
      data: {
        key,
        label,
        fieldType,
        options: options ?? undefined,
        required: !!body.required,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
  }

  async updateField(id: string, body: { label?: string; required?: boolean; enabled?: boolean; fieldType?: string; options?: string[] }) {
    const field = await this.prisma.classRegistrationField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException('Field not found');
    const data: Record<string, any> = {};
    if (body.label !== undefined) {
      const label = body.label.trim();
      if (!label) throw new BadRequestException('label cannot be empty');
      data.label = label;
    }
    if (body.required !== undefined) data.required = !!body.required;
    if (body.enabled !== undefined) data.enabled = !!body.enabled;
    if (body.fieldType !== undefined) {
      const { fieldType, options } = sanitizeFieldTypeAndOptions(body.fieldType, body.options ?? field.options);
      data.fieldType = fieldType;
      data.options = options;
    } else if (body.options !== undefined && CUSTOM_FIELD_TYPES_WITH_OPTIONS.includes(field.fieldType)) {
      const { options } = sanitizeFieldTypeAndOptions(field.fieldType, body.options);
      data.options = options;
    }
    return this.prisma.classRegistrationField.update({ where: { id }, data });
  }

  async deleteField(id: string) {
    const field = await this.prisma.classRegistrationField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException('Field not found');
    await this.prisma.classRegistrationField.delete({ where: { id } });
    return { success: true };
  }

  async reorderFields(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('ids is required');
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.classRegistrationField.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.listFields();
  }

  // ─── Public: browse open classes ──────────────────────────────────────
  async listPublicClasses() {
    const classes = await this.prisma.class.findMany({
      where: { registrationStatus: { not: 'HIDDEN' } },
      select: {
        id: true,
        name: true,
        subject: true,
        registrationStatus: true,
        thumbnail: true,
        description: true,
        price: true,
        showPrice: true,
        studyYear: { select: { label: true, year: true } },
      },
      orderBy: { name: 'asc' },
    });
    // Never leak a price the admin chose to hide, even though the UI wouldn't render it.
    return classes.map(c => ({ ...c, price: c.showPrice ? c.price : null }));
  }

  // ─── Public: submit a registration ────────────────────────────────────
  async createRegistration(body: {
    classId: string;
    nameKh?: string;
    nameEn: string;
    email?: string;
    phone?: string;
    password?: string;
    photo?: string;
    sex?: string;
    dateOfBirth?: string;
    address?: string;
    generation?: string;
    customFieldValues?: Record<string, string | string[]>;
  }) {
    const email = (body?.email || '').trim().toLowerCase();
    const nameKh = (body?.nameKh || '').trim();
    const nameEn = (body?.nameEn || '').trim();
    const phone = (body?.phone || '').trim();
    const password = body?.password || '';
    const sex = (body?.sex || '').trim();
    const dateOfBirth = (body?.dateOfBirth || '').trim();
    const address = (body?.address || '').trim();
    const generation = (body?.generation || '').trim();

    if (!body?.classId) throw new BadRequestException('classId is required');
    if (!nameEn) throw new BadRequestException('English name is required');
    if (email && !isValidEmail(email)) throw new BadRequestException('Invalid email address');

    const settings = await this.getOrCreateSettings();
    if (settings.passwordMode === 'REQUIRED' && password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    // Non-REQUIRED but the student typed one anyway — still hold it to the same
    // minimum, since a too-short chosen password is still a bad password.
    if (settings.passwordMode !== 'REQUIRED' && password && password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (settings.khmerNameMode === 'REQUIRED' && !nameKh) {
      throw new BadRequestException('Khmer name is required');
    }
    if (settings.emailMode === 'REQUIRED' && !email) {
      throw new BadRequestException('Email is required');
    }
    if (settings.phoneMode === 'REQUIRED' && !phone) {
      throw new BadRequestException('Phone number is required');
    }
    // Baseline safety net regardless of mode — e.g. both set to Optional and the
    // student left both blank — since the account still needs one identifier.
    if (!email && !phone) {
      throw new BadRequestException('Email or phone number is required');
    }
    if (settings.photoMode === 'REQUIRED' && !body.photo) {
      throw new BadRequestException('Photo is required');
    }
    if (settings.sexMode === 'REQUIRED' && !sex) {
      throw new BadRequestException('Sex is required');
    }
    if (settings.dateOfBirthMode === 'REQUIRED' && !dateOfBirth) {
      throw new BadRequestException('Date of birth is required');
    }
    if (settings.addressMode === 'REQUIRED' && !address) {
      throw new BadRequestException('Address is required');
    }
    if (settings.generationMode === 'REQUIRED' && !generation) {
      throw new BadRequestException('Generation is required');
    }

    // Custom fields: reject unknown keys, enforce required, drop values for disabled/removed fields
    const enabledFields = await this.prisma.classRegistrationField.findMany({ where: { enabled: true } });
    const customFieldValues: Record<string, string | string[]> = {};
    const submitted = body.customFieldValues || {};
    for (const f of enabledFields) {
      const options = Array.isArray(f.options) ? (f.options as string[]) : [];
      if (f.fieldType === 'MULTI_SELECT') {
        const raw = submitted[f.key];
        const arr = Array.from(new Set((Array.isArray(raw) ? raw : []).map((s) => String(s).trim()).filter(Boolean)));
        if (f.required && arr.length === 0) throw new BadRequestException(`${f.label} is required`);
        for (const v of arr) {
          if (!options.includes(v)) throw new BadRequestException(`${f.label} must be one of the listed options`);
        }
        if (arr.length) customFieldValues[f.key] = arr;
        continue;
      }
      const v = (submitted[f.key] ?? '').toString().trim();
      if (f.required && !v) throw new BadRequestException(`${f.label} is required`);
      if (v && f.fieldType === 'SELECT' && !options.includes(v)) {
        throw new BadRequestException(`${f.label} must be one of the listed options`);
      }
      if (v) customFieldValues[f.key] = v;
    }

    // Re-validate the class server-side — don't trust the client's cached status
    const cls = await this.prisma.class.findUnique({ where: { id: body.classId } });
    if (!cls) throw new BadRequestException('Class not found');
    if (cls.registrationStatus !== 'AVAILABLE') {
      throw new BadRequestException('Registration is not currently open for this class');
    }

    // Dedup: a pending request for the same class+identifier (whichever was given) is returned as-is
    const existing = await this.prisma.classRegistration.findFirst({
      where: {
        classId: body.classId,
        status: 'PENDING',
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
    });
    if (existing) return existing;

    // Auto-generate when the student didn't set one (only possible when passwordMode
    // isn't REQUIRED) — kept in plaintext alongside the hash so an admin can relay it,
    // since a bcrypt hash can never be reversed back into a readable password.
    const autoGenerated = !password ? generatePassword() : null;
    const finalPassword = password || autoGenerated!;
    const passwordHash = await bcrypt.hash(finalPassword, 12);
    const created = await this.prisma.classRegistration.create({
      data: {
        classId: body.classId,
        nameKh: settings.khmerNameMode === 'HIDDEN' ? undefined : nameKh || undefined,
        nameEn,
        email: settings.emailMode === 'HIDDEN' ? undefined : email || undefined,
        phone: settings.phoneMode === 'HIDDEN' ? undefined : phone || undefined,
        passwordHash,
        generatedPassword: autoGenerated || undefined,
        photo: settings.photoMode === 'HIDDEN' ? undefined : body.photo || undefined,
        sex: settings.sexMode === 'HIDDEN' ? undefined : sex || undefined,
        dateOfBirth: settings.dateOfBirthMode === 'HIDDEN' ? undefined : dateOfBirth ? new Date(dateOfBirth) : undefined,
        address: settings.addressMode === 'HIDDEN' ? undefined : address || undefined,
        generation: settings.generationMode === 'HIDDEN' ? undefined : generation || undefined,
        customFieldValues: Object.keys(customFieldValues).length ? customFieldValues : undefined,
      },
    });

    try {
      const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      if (admins.length) {
        await this.prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            type: 'class_registration_request',
            message: `${nameEn} requested to register for class ${cls.name}`,
          })),
        });
      }
    } catch {}

    return created;
  }

  // ─── Admin: list & resolve ─────────────────────────────────────────────
  async listRegistrations(status?: string, actorRole?: string, actorUserId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (actorRole === 'CLASS_ADMIN' && actorUserId) {
      where.class = { classAdminId: actorUserId };
    }
    return this.prisma.classRegistration.findMany({
      where,
      include: { class: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  /** Drives the sidebar's red notification badge — same PENDING + CLASS_ADMIN
   * scoping as listRegistrations, just a count instead of the full rows. */
  async countPending(actorRole?: string, actorUserId?: string) {
    const where: any = { status: 'PENDING' };
    if (actorRole === 'CLASS_ADMIN' && actorUserId) {
      where.class = { classAdminId: actorUserId };
    }
    const count = await this.prisma.classRegistration.count({ where });
    return { count };
  }

  async resolveRegistration(
    adminUserId: string,
    id: string,
    body: { action: 'APPROVE' | 'REJECT'; rejectReason?: string },
  ) {
    const reg = await this.prisma.classRegistration.findUnique({
      where: { id },
      include: { class: true },
    });
    if (!reg) throw new NotFoundException('Registration not found');
    if (reg.status !== 'PENDING') throw new BadRequestException('Registration already resolved');

    if (body.action === 'REJECT') {
      const updated = await this.prisma.classRegistration.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectReason: body.rejectReason?.trim() || null,
          resolvedAt: new Date(),
          resolvedBy: adminUserId,
        },
      });
      if (reg.email) {
        try {
          await this.notificationService.sendEmail(
            reg.email,
            'Your class registration was not approved',
            `Hi ${reg.nameEn}, your registration for ${reg.class.name} was not approved${body.rejectReason ? `: ${body.rejectReason}` : '.'}`,
          );
        } catch {}
      }
      return updated;
    }

    // APPROVE — create the User + Student accounts using the password the student set at registration
    const normalizedPhone = normalizePhone(reg.phone);
    const existingUser = reg.email
      ? await this.prisma.user.findUnique({ where: { email: reg.email } })
      : normalizedPhone
        ? await this.prisma.user.findUnique({ where: { phoneNormalized: normalizedPhone } })
        : null;
    if (existingUser) {
      throw new BadRequestException(`A user with this ${reg.email ? 'email' : 'phone number'} already exists. Link the student manually instead.`);
    }

    const user = await this.prisma.user.create({
      data: {
        email: reg.email || undefined,
        password: reg.passwordHash,
        name: reg.nameEn,
        phone: reg.phone || undefined,
        phoneNormalized: normalizedPhone || undefined,
        role: 'STUDENT',
      },
    });

    const count = await this.prisma.student.count({ where: { classId: reg.classId } });
    const studentNumber = String(count + 1).padStart(4, '0');

    const student = await this.prisma.student.create({
      data: {
        userId: user.id,
        classId: reg.classId,
        studentNumber,
        nameKh: reg.nameKh || undefined,
        photo: reg.photo || undefined,
        sex: reg.sex || undefined,
        dateOfBirth: reg.dateOfBirth || undefined,
        address: reg.address || undefined,
        generation: reg.generation || undefined,
        customFieldValues: reg.customFieldValues ?? undefined,
      },
    });

    const updated = await this.prisma.classRegistration.update({
      where: { id },
      data: { status: 'APPROVED', studentId: student.id, resolvedAt: new Date(), resolvedBy: adminUserId },
    });

    if (reg.email) {
      try {
        const loginHint = reg.generatedPassword
          ? 'Your login password was generated for you — please contact your admin or teacher to receive it.'
          : 'Log in at your school portal with the email and password you registered with.';
        await this.notificationService.sendEmail(
          reg.email,
          'Your class registration is approved',
          `Hi ${reg.nameEn}, welcome to ${reg.class.name}! Your registration has been approved. ${loginHint}`,
        );
      } catch {}
    }

    return updated;
  }
}
