import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AcademicIdentityProvider } from './academic-identity.contract';

@Injectable()
export class PrismaAcademicIdentityProvider implements AcademicIdentityProvider {
  private pluginCommands?: {
    assignUserDepartment(input: { userId: string; departmentId: string | null; idempotencyKey: string }): Promise<unknown>;
    assignStudentParent(input: { studentUserId: string; parentId: string | null; idempotencyKey: string }): Promise<unknown>;
    detachUserAcademicIdentity(input: { userId: string; idempotencyKey: string }): Promise<unknown>;
    attachAcademicProfiles(userIds: string[]): Promise<unknown>;
  };
  constructor(private readonly prisma: PrismaService) {}

  bindAcademicPluginCommands(commands: {
    assignUserDepartment(input: { userId: string; departmentId: string | null; idempotencyKey: string }): Promise<unknown>;
    assignStudentParent(input: { studentUserId: string; parentId: string | null; idempotencyKey: string }): Promise<unknown>;
    detachUserAcademicIdentity(input: { userId: string; idempotencyKey: string }): Promise<unknown>;
    attachAcademicProfiles(userIds: string[]): Promise<unknown>;
  }): () => void {
    if (this.pluginCommands) throw new Error('Academic plugin identity command dispatcher is already bound');
    this.pluginCommands = commands;
    return () => { if (this.pluginCommands === commands) this.pluginCommands = undefined; };
  }

  async attachAcademicProfiles(users: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
    if (!users.length) return users;
    const ids = users.map((user) => user.id);
    const owner = process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER ?? 'legacy';
    if (owner !== 'legacy' && owner !== 'plugin') {
      throw new Error('ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER must be legacy or plugin');
    }
    const profileOwner = process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER ?? 'legacy';
    if (profileOwner !== 'legacy' && profileOwner !== 'plugin') {
      throw new Error('ACADEMIC_STUDENT_PROFILES_READ_OWNER must be legacy or plugin');
    }
    if (owner === 'plugin' && profileOwner === 'plugin') {
      if (!this.pluginCommands) throw new Error('Academic Management plugin profile contract is unavailable');
      const value = await this.pluginCommands.attachAcademicProfiles(ids);
      const result = value as { schemaVersion?: unknown; profiles?: unknown };
      if (result?.schemaVersion !== 1 || !Array.isArray(result.profiles)) throw new Error('Academic profile contract payload is invalid');
      const rows = result.profiles as Array<Record<string, any>>;
      if (rows.length !== ids.length || new Set(rows.map((row) => row?.userId)).size !== ids.length || rows.some((row) => !row || !ids.includes(row.userId))) {
        throw new Error('Academic profile contract coverage is invalid');
      }
      const byUser = new Map(rows.map((row) => [row.userId, row]));
      return users.map((user) => {
        const academic = byUser.get(user.id)!;
        return {
          ...user, departmentId: academic.departmentId ?? null, department: academic.department ?? null,
          studentProfile: academic.studentProfile ?? null, parentStudents: academic.parentStudents ?? [],
        };
      });
    }
    const query = {
      where: { id: { in: ids } },
      select: {
        id: true,
        departmentId: true,
        department: { select: { id: true, name: true, nameKh: true } },
        studentProfile: {
          select: {
            id: true,
            studentNumber: true,
            sex: true,
            photo: true,
            dateOfBirth: true,
            address: true,
            parentId: true,
            class: { select: { id: true, name: true } },
            parent: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
        parentStudents: {
          select: {
            id: true,
            user: { select: { name: true } },
          },
        },
      },
    } as const;
    if (profileOwner === 'plugin') {
      return this.attachPluginStudentProfiles(users, ids, owner);
    }
    const enriched = owner === 'plugin'
      ? await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string; departmentId: string | null }>>(
          'SELECT "id", "departmentId" FROM "User" WHERE "id" = ANY($1::text[]) FOR SHARE', ids,
        );
        const mirrored = await tx.$queryRawUnsafe<Array<{ userId: string; departmentId: string }>>(
          'SELECT "userId", "departmentId" FROM "plugin_wattanam_academic_management_user_department" WHERE "userId" = ANY($1::text[])', ids,
        );
        const byUser = new Map(mirrored.map((row) => [row.userId, row.departmentId]));
        for (const row of locked) {
          if ((row.departmentId ?? null) !== (byUser.get(row.id) ?? null)) {
            throw new Error('Academic department membership mirror differs from legacy; profile lookup rejected');
          }
        }
        return tx.user.findMany(query);
      })
      : await this.prisma.user.findMany(query);
    const byId = new Map(enriched.map((row) => [row.id, row]));
    return users.map((user) => {
      const academic = byId.get(user.id);
      return {
        ...user,
        departmentId: academic?.departmentId ?? null,
        department: academic?.department ?? null,
        studentProfile: academic?.studentProfile ?? null,
        parentStudents: academic?.parentStudents ?? [],
      };
    });
  }

  async assignStudentParent(input: { studentUserId: string; parentId: string | null; idempotencyKey: string }): Promise<void> {
    const expectedKey = `assign-parent:${input.studentUserId}:${input.parentId ?? 'none'}`;
    if (input.idempotencyKey !== expectedKey) {
      throw new Error('Academic parent assignment command has an invalid idempotency key');
    }
    const writeOwner = process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER ?? 'legacy';
    if (writeOwner !== 'legacy' && writeOwner !== 'plugin') throw new Error('ACADEMIC_STUDENT_PROFILE_WRITE_OWNER must be legacy or plugin');
    const shadowSetting = process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE;
    if (shadowSetting !== undefined && shadowSetting !== 'true' && shadowSetting !== 'false') {
      throw new Error('ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE must be true or false');
    }
    if (writeOwner === 'plugin') {
      if (shadowSetting === 'true') throw new Error('ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE cannot be enabled when the plugin owns Student Profile writes');
      if (!this.pluginCommands) throw new Error('Academic Management plugin guardian command is unavailable');
      await this.pluginCommands.assignStudentParent(input);
      return;
    }
    if (shadowSetting === 'true') {
      await this.assignStudentParentWithShadow(input);
      return;
    }
    const student = await this.prisma.student.findUnique({ where: { userId: input.studentUserId } });
    if (!student) throw new Error('Student profile not found for this user');

    if (input.parentId) {
      const parent = await this.prisma.user.findUnique({
        where: { id: input.parentId },
        select: { id: true, role: true },
      });
      if (!parent || parent.role !== 'PARENT') {
        throw new Error('parentId must reference a user with role PARENT');
      }
    }

    await this.prisma.student.update({
      where: { id: student.id },
      data: { parentId: input.parentId },
    });
  }

  private async assignStudentParentWithShadow(input: { studentUserId: string; parentId: string | null }): Promise<void> {
    const table = 'plugin_wattanam_academic_management_student_profile';
    await this.prisma.$transaction(async (tx) => {
      const legacy = await tx.student.findUnique({ where: { userId: input.studentUserId }, select: { id: true, parentId: true } });
      if (!legacy) throw new Error('Student profile not found for this user');
      const mirror = await tx.$queryRawUnsafe<Array<{ id: string; guardianUserId: string | null }>>(
        `SELECT "id", "guardianUserId" FROM "${table}" WHERE "userId" = $1 FOR UPDATE`, input.studentUserId,
      );
      if (!mirror[0]) throw new Error('Student profile is not present in the plugin store');
      if ((legacy.parentId ?? null) !== (mirror[0].guardianUserId ?? null)) {
        throw new Error('Academic Student profile mirror differs from legacy; no parent assignment was written');
      }
      if (input.parentId) {
        const parent = await tx.user.findUnique({ where: { id: input.parentId }, select: { id: true, role: true } });
        if (!parent || parent.role !== 'PARENT') throw new Error('parentId must reference a user with role PARENT');
      }
      await tx.student.update({ where: { id: legacy.id }, data: { parentId: input.parentId } });
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "guardianUserId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        input.parentId, mirror[0].id,
      );
    });
  }

  private async attachPluginStudentProfiles(
    users: Array<Record<string, any>>,
    ids: string[],
    departmentOwner: 'legacy' | 'plugin',
  ): Promise<Array<Record<string, any>>> {
    return this.prisma.$transaction(async (tx) => {
      if (departmentOwner === 'plugin') {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string; departmentId: string | null }>>(
          'SELECT "id", "departmentId" FROM "User" WHERE "id" = ANY($1::text[]) FOR SHARE', ids,
        );
        const mirrored = await tx.$queryRawUnsafe<Array<{ userId: string; departmentId: string }>>(
          'SELECT "userId", "departmentId" FROM "plugin_wattanam_academic_management_user_department" WHERE "userId" = ANY($1::text[])', ids,
        );
        const byUser = new Map(mirrored.map((row) => [row.userId, row.departmentId]));
        for (const row of locked) {
          if ((row.departmentId ?? null) !== (byUser.get(row.id) ?? null)) {
            throw new Error('Academic department membership mirror differs from legacy; profile lookup rejected');
          }
        }
      }

      const base = await tx.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          departmentId: true,
          department: { select: { id: true, name: true, nameKh: true } },
        },
      });
      const profiles = await tx.$queryRawUnsafe<Array<Record<string, any>>>(
        `SELECT p."id", p."userId", p."studentNumber", p."sex", p."photo", p."dateOfBirth", p."address", p."guardianUserId" AS "parentId",
          CASE WHEN c."id" IS NULL THEN NULL ELSE jsonb_build_object('id', c."id", 'name', c."name") END AS "class",
          CASE WHEN parent."id" IS NULL THEN NULL ELSE jsonb_build_object('id', parent."id", 'name', parent."name", 'email', parent."email", 'phone', parent."phone") END AS "parent"
        FROM "plugin_wattanam_academic_management_student_profile" p
        LEFT JOIN "plugin_wattanam_academic_management_enrollment_interval" e ON e."studentId" = p."id" AND e."validTo" IS NULL
        LEFT JOIN "plugin_wattanam_academic_management_class" c ON c."id" = e."classId"
        LEFT JOIN "User" parent ON parent."id" = p."guardianUserId"
        WHERE p."userId" = ANY($1::text[])`,
        ids,
      );
      const children = await tx.$queryRawUnsafe<Array<{ parentId: string; id: string; name: string }>>(
        `SELECT p."guardianUserId" AS "parentId", p."id", child."name"
        FROM "plugin_wattanam_academic_management_student_profile" p
        JOIN "User" child ON child."id" = p."userId"
        WHERE p."guardianUserId" = ANY($1::text[])
        ORDER BY p."id" ASC`,
        ids,
      );
      const baseById = new Map(base.map((row) => [row.id, row]));
      const profileByUser = new Map(profiles.map((row) => [row.userId, { ...row, userId: undefined }]));
      const childrenByParent = new Map<string, Array<{ id: string; user: { name: string } }>>();
      for (const child of children) {
        const list = childrenByParent.get(child.parentId) ?? [];
        list.push({ id: child.id, user: { name: child.name } });
        childrenByParent.set(child.parentId, list);
      }
      return users.map((user) => {
        const academic = baseById.get(user.id);
        const profile = profileByUser.get(user.id);
        if (profile) delete profile.userId;
        return {
          ...user,
          departmentId: academic?.departmentId ?? null,
          department: academic?.department ?? null,
          studentProfile: profile ?? null,
          parentStudents: childrenByParent.get(user.id) ?? [],
        };
      });
    });
  }

  async assignUserDepartment(input: { userId: string; departmentId: string | null; idempotencyKey: string }): Promise<void> {
    const expectedKey = `assign-department:${input.userId}:${input.departmentId ?? 'none'}`;
    if (input.idempotencyKey !== expectedKey) {
      throw new Error('Academic department assignment command has an invalid idempotency key');
    }
    const writeOwner = process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER ?? 'legacy';
    if (writeOwner !== 'legacy' && writeOwner !== 'plugin') throw new Error('ACADEMIC_DEPARTMENT_WRITE_OWNER must be legacy or plugin');
    const shadowSetting = process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE;
    if (shadowSetting !== undefined && shadowSetting !== 'true' && shadowSetting !== 'false') {
      throw new Error('ACADEMIC_DEPARTMENT_SHADOW_WRITE must be true or false');
    }
    if (writeOwner === 'plugin') {
      if (shadowSetting === 'true') throw new Error('ACADEMIC_DEPARTMENT_SHADOW_WRITE cannot be enabled when the plugin owns Department writes');
      if (!this.pluginCommands) throw new Error('Academic Management plugin Department command is unavailable');
      await this.pluginCommands.assignUserDepartment(input);
      return;
    }
    if (shadowSetting === 'true') {
      await this.assignDepartmentWithShadow(input);
      return;
    }
    if (input.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: input.departmentId },
        select: { id: true },
      });
      if (!department) throw new Error('Department not found');
    }
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { departmentId: input.departmentId },
    });
  }

  private async assignDepartmentWithShadow(input: { userId: string; departmentId: string | null }): Promise<void> {
    const membershipTable = 'plugin_wattanam_academic_management_user_department';
    const departmentTable = 'plugin_wattanam_academic_management_department';
    await this.prisma.$transaction(async (tx) => {
      const legacy = await tx.$queryRawUnsafe<Array<{ departmentId: string | null }>>(
        'SELECT "departmentId" FROM "User" WHERE "id" = $1 FOR UPDATE', input.userId,
      );
      if (!legacy[0]) throw new Error('User not found');
      const mirror = await tx.$queryRawUnsafe<Array<{ departmentId: string }>>(
        `SELECT "departmentId" FROM "${membershipTable}" WHERE "userId" = $1 FOR UPDATE`, input.userId,
      );
      if ((legacy[0].departmentId ?? null) !== (mirror[0]?.departmentId ?? null)) {
        throw new Error('Academic department membership mirror differs from legacy; no assignment was written');
      }
      if (input.departmentId) {
        const source = await tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true } });
        const target = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "${departmentTable}" WHERE "id" = $1`, input.departmentId,
        );
        if (!source || !target[0]) throw new Error('Department is not present in both academic stores');
      }
      await tx.user.update({ where: { id: input.userId }, data: { departmentId: input.departmentId } });
      if (input.departmentId) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${membershipTable}" ("userId","departmentId") VALUES ($1,$2) ON CONFLICT ("userId") DO UPDATE SET "departmentId" = EXCLUDED."departmentId", "updatedAt" = CURRENT_TIMESTAMP`,
          input.userId, input.departmentId,
        );
      } else {
        await tx.$executeRawUnsafe(`DELETE FROM "${membershipTable}" WHERE "userId" = $1`, input.userId);
      }
    });
  }

  async detachUserAcademicIdentity(input: { userId: string; idempotencyKey: string }): Promise<void> {
    if (input.idempotencyKey !== `delete-user:${input.userId}`) {
      throw new Error('Academic identity detach command has an invalid idempotency key');
    }

    const owner = process.env.ACADEMIC_IDENTITY_DETACH_OWNER ?? 'legacy';
    if (owner !== 'legacy' && owner !== 'plugin') throw new Error('ACADEMIC_IDENTITY_DETACH_OWNER must be legacy or plugin');
    if (owner === 'plugin') {
      if (!this.pluginCommands) throw new Error('Academic Management plugin identity detach command is unavailable');
      await this.pluginCommands.detachUserAcademicIdentity(input);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { userId: input.userId } });

      await tx.class.updateMany({ where: { teacherId: input.userId }, data: { teacherId: null } });

      if (student) {
        await tx.attendance.deleteMany({ where: { studentId: student.id } });
        await tx.feeRecord.deleteMany({ where: { studentId: student.id } });
        await tx.student.delete({ where: { id: student.id } });
      }

      await tx.student.updateMany({ where: { parentId: input.userId }, data: { parentId: null } });
    });
  }
}
