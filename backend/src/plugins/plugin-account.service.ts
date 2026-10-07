import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { normalizePhone } from '../common/identity';

export interface CreatePluginStudentAccountInput {
  commandKey: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  passwordHash: string;
}

export interface PluginStudentAccount {
  id: string;
  name: string;
  role: 'STUDENT';
  email: string | null;
  phone: string | null;
}

export interface CreatePluginStaffAccountInput {
  commandKey: string;
  name: string;
  email: string;
  phone?: string | null;
  photo?: string | null;
  passwordHash: string;
  role: 'STAFF' | 'TEACHER';
}

export interface UpdatePluginStudentAccountInput {
  commandKey: string;
  userId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface ResolvePluginParentAccountInput {
  commandKey: string;
  name: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
}

export interface PluginParentAccount {
  id: string;
  name: string;
  role: 'PARENT';
  email: string | null;
  phone: string | null;
  created: boolean;
}

@Injectable()
export class PluginAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async createStaff(pluginId: string, value: CreatePluginStaffAccountInput) {
    const role = String(value?.role || '').toUpperCase();
    if (!['STAFF', 'TEACHER'].includes(role)) throw new BadRequestException('staff role must be STAFF or TEACHER');
    const photo = String(value?.photo || '').trim() || null;
    if (photo && (photo.length > 2000 || !/^https:\/\//i.test(photo))) throw new BadRequestException('photo must be an HTTPS URL');
    const input = { ...this.validate(value), photo, role: role as 'STAFF' | 'TEACHER' };
    if (!input.email) throw new BadRequestException('staff email is required');
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${pluginId}:${input.commandKey}`}, 0))`;
      const command = await tx.pluginAccountCommand.findUnique({ where: { pluginId_commandKey: { pluginId, commandKey: input.commandKey } } });
      if (command) {
        if (command.requestHash !== requestHash) throw new ConflictException('Plugin account command payload does not match its first execution');
        const existing = await tx.user.findUnique({ where: { id: command.userId }, select: { id: true, name: true, role: true, email: true, phone: true } });
        if (!existing || existing.role !== input.role) throw new ConflictException('Plugin account command journal references an invalid staff account');
        return existing;
      }
      if (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ConflictException('Email is already used by another account');
      if (input.phoneNormalized && await tx.user.findUnique({ where: { phoneNormalized: input.phoneNormalized }, select: { id: true } })) throw new ConflictException('Phone number is already used by another account');
      const id = randomUUID();
      const account = await tx.user.create({ data: { id, name: input.name, email: input.email, phone: input.phone || undefined, phoneNormalized: input.phoneNormalized || undefined, photo: input.photo || undefined, password: input.passwordHash, role: input.role }, select: { id: true, name: true, role: true, email: true, phone: true } });
      await tx.pluginAccountCommand.create({ data: { pluginId, commandKey: input.commandKey, requestHash, userId: id } });
      return account;
    });
  }

  async createStudent(pluginId: string, value: CreatePluginStudentAccountInput): Promise<PluginStudentAccount> {
    const input = this.validate(value);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      // Serialize a single command across API replicas before checking its journal row.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${pluginId}:${input.commandKey}`}, 0))`;
      const existingCommand = await tx.pluginAccountCommand.findUnique({
        where: { pluginId_commandKey: { pluginId, commandKey: input.commandKey } },
      });
      if (existingCommand) {
        if (existingCommand.requestHash !== requestHash) throw new ConflictException('Plugin account command payload does not match its first execution');
        const existingUser = await tx.user.findUnique({
          where: { id: existingCommand.userId },
          select: { id: true, name: true, role: true, email: true, phone: true },
        });
        if (!existingUser || existingUser.role !== 'STUDENT') throw new ConflictException('Plugin account command journal references an invalid account');
        return existingUser as PluginStudentAccount;
      }

      if (input.email && await tx.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw new ConflictException('Email is already used by another account');
      }
      if (input.phoneNormalized && await tx.user.findUnique({ where: { phoneNormalized: input.phoneNormalized }, select: { id: true } })) {
        throw new ConflictException('Phone number is already used by another account');
      }

      const id = randomUUID();
      const email = input.email || (!input.phoneNormalized ? `plugin-student-${requestHash.slice(0, 24)}@school.local` : null);
      const user = await tx.user.create({
        data: {
          id,
          name: input.name,
          email: email || undefined,
          phone: input.phone || undefined,
          phoneNormalized: input.phoneNormalized || undefined,
          password: input.passwordHash,
          role: 'STUDENT',
        },
        select: { id: true, name: true, role: true, email: true, phone: true },
      });
      await tx.pluginAccountCommand.create({ data: { pluginId, commandKey: input.commandKey, requestHash, userId: id } });
      return user as PluginStudentAccount;
    });
  }

  async updateStudent(pluginId: string, value: UpdatePluginStudentAccountInput): Promise<PluginStudentAccount> {
    const input = this.validateUpdate(value);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${pluginId}:${input.commandKey}`}, 0))`;
      const existingCommand = await tx.pluginAccountCommand.findUnique({
        where: { pluginId_commandKey: { pluginId, commandKey: input.commandKey } },
      });
      if (existingCommand) {
        if (existingCommand.requestHash !== requestHash || existingCommand.userId !== input.userId) {
          throw new ConflictException('Plugin account command payload does not match its first execution');
        }
        return this.requireStudent(tx, input.userId);
      }

      await this.requireStudent(tx, input.userId);
      if (input.email) {
        const clash = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
        if (clash && clash.id !== input.userId) throw new ConflictException('Email is already used by another account');
      }
      if (input.phoneNormalized) {
        const clash = await tx.user.findUnique({ where: { phoneNormalized: input.phoneNormalized }, select: { id: true } });
        if (clash && clash.id !== input.userId) throw new ConflictException('Phone number is already used by another account');
      }
      const user = await tx.user.update({
        where: { id: input.userId },
        data: { name: input.name, ...(input.email ? { email: input.email } : {}), ...(input.phone ? { phone: input.phone, phoneNormalized: input.phoneNormalized || undefined } : {}) },
        select: { id: true, name: true, role: true, email: true, phone: true },
      });
      await tx.pluginAccountCommand.create({ data: { pluginId, commandKey: input.commandKey, requestHash, userId: input.userId } });
      return user as PluginStudentAccount;
    });
  }

  async resolveParent(pluginId: string, value: ResolvePluginParentAccountInput): Promise<PluginParentAccount> {
    const input = this.validate(value);
    if (!input.email) throw new BadRequestException('parent email is required');
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${pluginId}:${input.commandKey}`}, 0))`;
      const existingCommand = await tx.pluginAccountCommand.findUnique({ where: { pluginId_commandKey: { pluginId, commandKey: input.commandKey } } });
      if (existingCommand) {
        if (existingCommand.requestHash !== requestHash) throw new ConflictException('Plugin account command payload does not match its first execution');
        const account = await tx.user.findUnique({ where: { id: existingCommand.userId }, select: { id: true, name: true, role: true, email: true, phone: true } });
        if (!account || account.role !== 'PARENT') throw new ConflictException('Plugin account command journal references an invalid parent account');
        return { ...account, role: 'PARENT', created: false };
      }
      const byEmail = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, name: true, role: true, email: true, phone: true } });
      if (byEmail && byEmail.role !== 'PARENT') throw new ConflictException('Email belongs to an account that is not a PARENT');
      if (input.phoneNormalized) {
        const byPhone = await tx.user.findUnique({ where: { phoneNormalized: input.phoneNormalized }, select: { id: true } });
        if (byPhone && byPhone.id !== byEmail?.id) throw new ConflictException('Phone number is already used by another account');
      }
      const account = byEmail || await tx.user.create({
        data: { id: randomUUID(), name: input.name, email: input.email, phone: input.phone || undefined, phoneNormalized: input.phoneNormalized || undefined, password: input.passwordHash, role: 'PARENT' },
        select: { id: true, name: true, role: true, email: true, phone: true },
      });
      await tx.pluginAccountCommand.create({ data: { pluginId, commandKey: input.commandKey, requestHash, userId: account.id } });
      return { ...account, role: 'PARENT', created: !byEmail };
    });
  }

  private validate(value: CreatePluginStudentAccountInput) {
    const commandKey = String(value?.commandKey || '').trim();
    const name = String(value?.name || '').trim();
    const email = String(value?.email || '').trim().toLowerCase() || null;
    const phone = String(value?.phone || '').trim() || null;
    const phoneNormalized = normalizePhone(phone);
    const passwordHash = String(value?.passwordHash || '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(commandKey)) throw new BadRequestException('commandKey is invalid');
    if (!name || name.length > 160) throw new BadRequestException('name must contain 1-160 characters');
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new BadRequestException('email is invalid');
    if (phone && (!phoneNormalized || phone.length > 40)) throw new BadRequestException('phone is invalid');
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw new BadRequestException('passwordHash must be a bcrypt hash');
    return { commandKey, name, email, phone, phoneNormalized: phoneNormalized || null, passwordHash };
  }

  private validateUpdate(value: UpdatePluginStudentAccountInput) {
    const base = this.validate({ ...value, passwordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const userId = String(value?.userId || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(userId)) throw new BadRequestException('userId is invalid');
    const { passwordHash: _passwordHash, ...identity } = base;
    return { ...identity, userId };
  }

  private async requireStudent(tx: any, userId: string): Promise<PluginStudentAccount> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, email: true, phone: true } });
    if (!user || user.role !== 'STUDENT') throw new ConflictException('Target account is not a STUDENT');
    return user as PluginStudentAccount;
  }
}
