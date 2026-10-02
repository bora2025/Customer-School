import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { isValidEmail, looksLikeEmail, normalizePhone } from '../common/identity';
import { getDistribution } from '../config/environment';
import { ACADEMIC_IDENTITY_PROVIDER, AcademicIdentityProvider } from './academic-identity.contract';

const CORE_AUTH_USER_SELECT = {
  id: true,
  email: true,
  password: true,
  name: true,
  phone: true,
  phoneNormalized: true,
  role: true,
  photo: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AUTH_USER_LIST_BASE_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  photo: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    @Optional() @Inject(ACADEMIC_IDENTITY_PROVIDER)
    private readonly academicIdentity?: AcademicIdentityProvider,
  ) {}

  /** `identifier` is whatever the user typed into the login field — an email
   * address or a phone number. Routed to the matching unique column.
   * Case-insensitive email match (not just a .toLowerCase() before the lookup)
   * because existing accounts predate any case normalization on write — an
   * exact-match lookup would silently break login for any account whose stored
   * email has uppercase characters. */
  async validateUser(identifier: string, password: string): Promise<any> {
    const trimmed = (identifier || '').trim();
    let user: any = null;
    if (looksLikeEmail(trimmed)) {
      user = await this.prisma.user.findFirst({
        where: { email: { equals: trimmed, mode: 'insensitive' } },
        select: CORE_AUTH_USER_SELECT,
      });
    } else {
      const normalized = normalizePhone(trimmed);
      if (normalized) {
        user = await this.prisma.user.findUnique({
          where: { phoneNormalized: normalized },
          select: CORE_AUTH_USER_SELECT,
        });
      }
    }
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password, mfaSecretEncrypted, mfaRecoveryCodes, ...result } = user;
      return result;
    }
    return null;
  }

  /** Issue an access token (default 2h) */
  signAccessToken(user: any): string {
    const payload = { email: user.email, sub: user.id, role: user.role };
    return this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_ACCESS_EXPIRY || '2h') as StringValue,
    });
  }

  /** Create a secure random refresh token, store in DB, return the raw token */
  async createRefreshToken(userId: string): Promise<string> {
    return this.createRefreshTokenWithClient(this.prisma, userId);
  }

  private tokenHash(raw: string): string {
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  private async createRefreshTokenWithClient(client: any, userId: string): Promise<string> {
    const raw = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    const days = parseInt(process.env.JWT_REFRESH_EXPIRY || '7', 10) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await client.refreshToken.create({
      data: { tokenHash: this.tokenHash(raw), userId, expiresAt },
    });
    return raw;
  }

  /** Validate a refresh token — returns the user or throws */
  async validateRefreshToken(token: string) {
    const record = await this.prisma.refreshToken.findFirst({
      where: { OR: [{ tokenHash: this.tokenHash(token) }, { token }] },
      include: { user: { select: CORE_AUTH_USER_SELECT } },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return record.user;
  }

  /** Rotate atomically. Reuse of a consumed token revokes the whole token family. */
  async rotateRefreshToken(oldToken: string) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.refreshToken.findFirst({
        where: { OR: [{ tokenHash: this.tokenHash(oldToken) }, { token: oldToken }] },
        include: { user: { select: CORE_AUTH_USER_SELECT } },
      });
      if (!record) return { ok: false as const };
      if (record.revokedAt || record.expiresAt < now) {
        await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
        return { ok: false as const };
      }
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null }, data: { revokedAt: now, token: null, tokenHash: record.tokenHash ?? this.tokenHash(oldToken) },
      });
      if (claimed.count !== 1) {
        await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
        return { ok: false as const };
      }
      const refreshToken = await this.createRefreshTokenWithClient(tx, record.userId);
      return { ok: true as const, user: record.user, refreshToken };
    }, { isolationLevel: 'Serializable' });
    if (!result.ok) throw new UnauthorizedException('Invalid or expired refresh token');
    return { accessToken: this.signAccessToken(result.user), refreshToken: result.refreshToken, user: result.user };
  }

  /** Revoke all refresh tokens for a user (logout everywhere) */
  async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  async login(user: any) {
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async register(email: string | undefined, password: string, name: string, role: string, departmentId?: string, phone?: string) {
    const normalizedRole = role.trim();
    if (!normalizedRole || normalizedRole.startsWith('__')) {
      throw new Error('Invalid role');
    }
    this.assertCoreAdministrativeRole(normalizedRole);
    const trimmedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);
    if (!trimmedEmail && !normalizedPhone) {
      throw new Error('Email or phone is required');
    }
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      throw new Error('Invalid email address');
    }
    try {
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await this.prisma.user.create({
        data: {
          email: trimmedEmail || undefined,
          phone: phone || undefined,
          phoneNormalized: normalizedPhone || undefined,
          password: hashedPassword, name, role: normalizedRole as any,
        },
      });
      if (departmentId && getDistribution() === 'legacy-full') {
        await this.assignDepartment(user.id, departmentId);
      }
      const loginResult = await this.login(user);
      return {
        ...loginResult,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
        throw new Error(target.includes('phone') ? 'Phone number already registered' : 'Email already exists');
      }
      throw error;
    }
  }

  async getUserById(userId: string) {
    if (getDistribution() === 'core') {
      return this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, phone: true, role: true, photo: true },
      });
    }
    const academicIdentity = this.requireAcademicIdentity();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, role: true, photo: true },
    });
    if (!user) return null;
    const [enriched] = await academicIdentity.attachAcademicProfiles([user]);
    return enriched;
  }

  async getUsers(role?: string, roles?: string[]) {
    const where: any = {};
    if (roles && roles.length > 0) {
      where.role = { in: roles };
    } else if (role) {
      where.role = role.toUpperCase();
    }
    if (getDistribution() === 'core') {
      return this.prisma.user.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: AUTH_USER_LIST_BASE_SELECT,
      });
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: AUTH_USER_LIST_BASE_SELECT,
    });
    return this.requireAcademicIdentity().attachAcademicProfiles(users as any);
  }

  async setStudentParent(studentUserId: string, parentId: string | null) {
    this.assertLegacyFeature();
    await this.requireAcademicIdentity().assignStudentParent({
      studentUserId,
      parentId,
      idempotencyKey: `assign-parent:${studentUserId}:${parentId ?? 'none'}`,
    });
    return { ok: true };
  }

  async bulkRegister(users: { email: string; password: string; name: string; role: string; photo?: string }[]) {
    for (const user of users) this.assertCoreAdministrativeRole(user.role?.trim());
    const hashedUsers = await Promise.all(
      users.map(async (u) => ({
        email: u.email,
        name: u.name,
        role: u.role,
        password: await bcrypt.hash(u.password, 12),
        ...(u.photo ? { photo: u.photo } : {}),
      }))
    );
    return this.prisma.user.createMany({ data: hashedUsers });
  }

  /**
   * Photos are stored inline as data URLs rather than in object storage, so an unvalidated value
   * is both a stored-content risk and an unbounded row. Anything that is not a small raster image
   * is refused: a `data:text/html` or SVG payload would otherwise sit in a column that UIs render
   * straight into an `img` src.
   */
  private validatePhoto(photo: string): string | null {
    const value = (photo || '').trim();
    if (!value) return null; // Clearing the photo is legitimate.
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) throw new BadRequestException('Photo must be a base64 PNG, JPEG, or WebP data URL');
    // ~1.5 MB of image. Large enough for a portrait, small enough that a row stays sane.
    if (value.length > 2_000_000) throw new BadRequestException('Photo must be smaller than about 1.5 MB');
    return value;
  }

  async updateUserPhoto(userId: string, photo: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { photo: this.validatePhoto(photo) },
      select: { id: true, email: true, name: true, role: true, photo: true },
    });
  }

  async findById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  async resetUserPassword(userId: string, newPassword: string) {
    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    // Revoke all existing refresh tokens so old sessions cannot continue.
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { ok: true };
  }

  /**
   * Changes the signed-in user's own password.
   *
   * Separate from `resetUserPassword`, which an administrator uses on someone else and which
   * deliberately takes no current password — an admin resetting a teacher's password does not know
   * it. Doing the same to your own account would mean a stolen session is enough to take the
   * account permanently, so this proves the person at the keyboard knows the existing password
   * before it changes.
   *
   * The minimum matches `ConfirmPasswordResetDto`, so a password chosen here is held to the same
   * standard as one chosen through an emailed reset link.
   */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      throw new BadRequestException('New password must be at least 12 characters');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, password: true } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!(await bcrypt.compare(currentPassword || '', user.password))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BadRequestException('New password must differ from the current one');
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    // Everything signed in elsewhere stops, and any unspent reset link is consumed: a link issued
    // before this point would otherwise let its holder set a password of their own afterwards.
    const revoked = await this.prisma.refreshToken.deleteMany({ where: { userId } });
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null }, data: { consumedAt: new Date() },
    });
    return { ok: true, revokedSessions: revoked.count };
  }

  async deleteUser(userId: string) {
    if (getDistribution() === 'core') {
      await this.prisma.$transaction([
        this.prisma.notification.deleteMany({ where: { userId } }),
        this.prisma.notificationPreference.deleteMany({ where: { userId } }),
        this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
        this.prisma.refreshToken.deleteMany({ where: { userId } }),
        this.prisma.user.delete({ where: { id: userId } }),
      ]);
      return { ok: true, id: userId };
    }

    if (!this.academicIdentity) {
      throw new Error('Academic identity provider is required to delete a legacy-distribution user');
    }

    // Academic Management owns its detach transaction. The deterministic command key makes a
    // retry safe if core cleanup fails after the academic side has already committed.
    await this.academicIdentity.detachUserAcademicIdentity({
      userId,
      idempotencyKey: `delete-user:${userId}`,
    });

    // Wipe every record that references this user, in dependency order.
    await this.prisma.$transaction(async (tx) => {
      // Attendance marker (student + staff)
      await tx.attendance.deleteMany({ where: { markedById: userId } });
      await tx.staffAttendance.deleteMany({ where: { markedById: userId } });
      await tx.staffAttendance.deleteMany({ where: { userId } });

      // Communication
      await tx.message.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } });
      await tx.announcementRead.deleteMany({ where: { userId } });
      await tx.announcement.deleteMany({ where: { authorId: userId } });

      // Modules
      await tx.salary.deleteMany({ where: { userId } });
      await tx.exam.deleteMany({ where: { createdById: userId } });
      await tx.assignment.deleteMany({ where: { createdById: userId } });

      // Preferences / notifications / sessions
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });

      // Finally the user
      await tx.user.delete({ where: { id: userId } });
    });

    return { ok: true, id: userId };
  }

  async updateUser(userId: string, data: { name?: string; email?: string; role?: string; phone?: string; departmentId?: string | null }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) {
      updateData.phone = data.phone;
      updateData.phoneNormalized = normalizePhone(data.phone) || null;
    }
    if (data.role) {
      const trimmed = data.role.trim();
      if (!trimmed || trimmed.startsWith('__')) {
        throw new Error('Invalid role');
      }
      this.assertCoreAdministrativeRole(trimmed);
      updateData.role = trimmed;
    }
    try {
      if (getDistribution() === 'core') {
        return await this.prisma.user.update({
          where: { id: userId }, data: updateData,
          select: { id: true, email: true, name: true, phone: true, role: true, photo: true, createdAt: true, updatedAt: true },
        });
      }
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: { id: true, email: true, name: true, phone: true, role: true, photo: true, createdAt: true, updatedAt: true },
      });
      if (data.departmentId !== undefined) {
        await this.assignDepartment(userId, data.departmentId || null);
      }
      const [enriched] = await this.requireAcademicIdentity().attachAcademicProfiles([user]);
      return enriched;
    } catch (error: any) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
        throw new Error(target.includes('phone') ? 'Phone number already registered' : 'Email already exists');
      }
      throw error;
    }
  }

  async searchUsers(query: string, role?: string) {
    const where: any = {};
    if (role) {
      where.role = role.toUpperCase();
    }
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
      ];
    }

    if (getDistribution() === 'core') {
      return this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, phone: true, photo: true, role: true, createdAt: true },
        orderBy: { name: 'asc' }, take: 50,
      });
    }
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, email: true, name: true, phone: true, photo: true, role: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return this.requireAcademicIdentity().attachAcademicProfiles(users as any);
  }

  private _ttClassInclude() {
    return {
      timetable: {
        select: {
          id: true, name: true, academicYear: true, status: true,
          periodsPerDay: true, numberOfDays: true,
          periodTimes: true, weekend: true,
        },
      },
      entries: {
        include: {
          subject: { select: { name: true, short: true, color: true } },
          teacher: { select: { firstName: true, lastName: true, short: true, color: true } },
          classroom: { select: { name: true, short: true } },
        },
        orderBy: [{ day: 'asc' }, { period: 'asc' }] as any,
      },
    };
  }

  async getTeacherSchedule(userId: string) {
    this.assertLegacyFeature();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      return { _debug: { reason: 'User not found or has no email' } };
    }
    const include = {
      timetable: {
        select: {
          id: true, name: true, academicYear: true, status: true,
          periodsPerDay: true, numberOfDays: true,
          periodTimes: true, weekend: true,
        },
      },
      entries: {
        include: {
          subject: { select: { name: true, short: true, color: true } },
          class: { select: { name: true, short: true, color: true } },
          classroom: { select: { name: true, short: true } },
        },
        orderBy: [{ day: 'asc' }, { period: 'asc' }] as any,
      },
    };
    let ttTeacher = await this.prisma.timetableTeacher.findFirst({
      where: { email: { equals: user.email, mode: 'insensitive' }, timetable: { status: 'PUBLISHED' } },
      include,
      orderBy: { timetable: { createdAt: 'desc' } } as any,
    });
    if (!ttTeacher) {
      ttTeacher = await this.prisma.timetableTeacher.findFirst({
        where: { email: { equals: user.email, mode: 'insensitive' } },
        include,
        orderBy: { timetable: { createdAt: 'desc' } } as any,
      });
    }
    if (!ttTeacher) {
      return { _debug: { reason: 'No timetable teacher found matching your email', email: user.email } };
    }
    return ttTeacher;
  }

  async getStudentSchedule(userId: string) {
    this.assertLegacyFeature();
    const student = await this.prisma.student.findUnique({
      where: { userId },
      include: { class: { select: { name: true } } },
    });

    const studentClass = student?.class?.name ?? null;

    if (!studentClass) {
      return { _debug: { studentClass: null, reason: 'Student has no class assigned', allPublishedClasses: [] } };
    }

    const include = this._ttClassInclude();

    // 1️⃣ Try exact match in PUBLISHED timetable
    let ttClass = await this.prisma.timetableClass.findFirst({
      where: { name: { equals: studentClass, mode: 'insensitive' }, timetable: { status: 'PUBLISHED' } },
      include,
      orderBy: { timetable: { createdAt: 'desc' } },
    });

    // 2️⃣ Fallback: DRAFT timetable (show with warning)
    if (!ttClass) {
      ttClass = await this.prisma.timetableClass.findFirst({
        where: { name: { equals: studentClass, mode: 'insensitive' } },
        include,
        orderBy: { timetable: { createdAt: 'desc' } },
      });
    }

    // 3️⃣ If still nothing, return debug info with available class names
    if (!ttClass) {
      const allClasses = await this.prisma.timetableClass.findMany({
        select: { name: true, timetable: { select: { name: true, status: true } } },
        orderBy: { timetable: { createdAt: 'desc' } },
      });
      return {
        _debug: {
          studentClass,
          reason: 'No timetable class name matches the student class name',
          allClasses: allClasses.map(c => ({ className: c.name, timetableName: c.timetable.name, status: c.timetable.status })),
        },
      };
    }

    return ttClass;
  }

  async getFullProfile(userId: string) {
    if (getDistribution() === 'core') return this.getUserById(userId);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, phone: true, photo: true,
        role: true, createdAt: true,
        department: { select: { id: true, name: true, nameKh: true } },
        studentProfile: {
          select: {
            id: true, studentNumber: true, sex: true, photo: true,
            dateOfBirth: true, address: true,
            class: { select: { id: true, name: true } },
            feeRecords: {
              select: {
                id: true, totalAmount: true, paidAmount: true, dueDate: true,
                term: true, notes: true, createdAt: true,
                payments: {
                  select: { id: true, amount: true, note: true, createdAt: true },
                  orderBy: { createdAt: 'desc' },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
            attendances: {
              where: { date: { gte: thirtyDaysAgo } },
              select: { date: true, session: true, status: true, checkInTime: true, permissionType: true },
              orderBy: [{ date: 'asc' }, { session: 'asc' }],
            },
          },
        },
        staffAttendances: {
          where: { date: { gte: thirtyDaysAgo } },
          select: { date: true, session: true, status: true, checkInTime: true, permissionType: true },
          orderBy: [{ date: 'asc' }, { session: 'asc' }],
        },
      },
    });

    if (!user) return null;

    const base = {
      ...user,
      scoreEntries: [] as any[],
      rankingMap: {} as Record<string, { rank: number; total: number }>,
    };
    if (!user.studentProfile) return base;

    const scoreEntries = await this.prisma.scoreEntry.findMany({
      where: { studentId: user.studentProfile.id },
      select: {
        score: true,
        subject: { select: { name: true, maxScore: true, color: true } },
        examTab: {
          select: {
            id: true, label: true, type: true, order: true,
            scoreSheet: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ examTab: { order: 'asc' } }, { subject: { order: 'asc' } }],
    });

    const classId = user.studentProfile.class?.id;
    const rankingMap: Record<string, { rank: number; total: number }> = {};

    if (classId && scoreEntries.length > 0) {
      const classStudentIds = await this.prisma.student
        .findMany({ where: { classId }, select: { id: true } })
        .then(ss => ss.map(s => s.id));

      const uniqueTabIds = [...new Set(scoreEntries.map(e => e.examTab.id))];
      // Fetch all tab rankings in parallel instead of sequential loop
      await Promise.all(uniqueTabIds.map(async (examTabId) => {
        const grouped = await this.prisma.scoreEntry.groupBy({
          by: ['studentId'],
          where: { examTabId, studentId: { in: classStudentIds } },
          _sum: { score: true },
          orderBy: { _sum: { score: 'desc' } },
        });
        const myIdx = grouped.findIndex(g => g.studentId === user.studentProfile!.id);
        rankingMap[examTabId] = { rank: myIdx >= 0 ? myIdx + 1 : 0, total: grouped.length };
      }));
    }

    return { ...user, scoreEntries, rankingMap };
  }

  private assertLegacyFeature(): void {
    if (getDistribution() === 'core') throw new NotFoundException('This feature requires a business plugin');
  }

  private requireAcademicIdentity(): AcademicIdentityProvider {
    if (!this.academicIdentity) {
      throw new Error('Academic identity provider is required in legacy-full distribution');
    }
    return this.academicIdentity;
  }

  private async assignDepartment(userId: string, departmentId: string | null): Promise<void> {
    await this.requireAcademicIdentity().assignUserDepartment({
      userId,
      departmentId,
      idempotencyKey: `assign-department:${userId}:${departmentId ?? 'none'}`,
    });
  }

  private assertCoreAdministrativeRole(role: string): void {
    if (getDistribution() === 'core' && !['SUPER_ADMIN', 'ADMIN'].includes(role)) {
      throw new BadRequestException('Core installations can create only SUPER_ADMIN or ADMIN accounts; install the owning business plugin before creating another role');
    }
  }
}
