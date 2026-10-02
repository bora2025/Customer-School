import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AcademicDepartmentsProvider, DepartmentCreateInput, DepartmentUpdateInput } from './academic-departments.contract';

@Injectable()
export class PrismaAcademicDepartmentsProvider implements AcademicDepartmentsProvider {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async create(data: DepartmentCreateInput) {
    return this.prisma.department.create({ data });
  }

  async update(id: string, data: DepartmentUpdateInput) {
    return this.prisma.department.update({ where: { id }, data });
  }

  async delete(input: { id: string; idempotencyKey: string }) {
    if (input.idempotencyKey !== `delete-department:${input.id}`) {
      throw new Error('Academic department delete command has an invalid idempotency key');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { departmentId: input.id }, data: { departmentId: null } });
      return tx.department.delete({ where: { id: input.id } });
    });
  }
}
