import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  async getAll(year?: number, month?: number, search?: string) {
    const salaries = await this.prisma.salary.findMany({
      where: {
        ...(year ? { year: Number(year) } : {}),
        ...(month ? { month: Number(month) } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, photo: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { user: { name: 'asc' } }],
    });

    if (search) {
      const q = search.toLowerCase();
      return salaries.filter(s => s.user.name.toLowerCase().includes(q));
    }
    return salaries;
  }

  async getSummary(year: number, month: number) {
    const salaries = await this.prisma.salary.findMany({
      where: { year: Number(year), month: Number(month) },
    });
    return {
      total: salaries.length,
      totalNet: salaries.reduce((s, r) => s + r.netSalary, 0),
      paid: salaries.filter(r => r.isPaid).length,
      unpaid: salaries.filter(r => !r.isPaid).length,
    };
  }

  async getOne(id: string) {
    const salary = await this.prisma.salary.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, photo: true } },
      },
    });
    if (!salary) throw new NotFoundException('Salary record not found');
    return salary;
  }

  async getStaffList() {
    return this.prisma.user.findMany({
      where: { role: { not: 'STUDENT' } },
      select: { id: true, name: true, role: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: {
    userId: string;
    month: number;
    year: number;
    baseSalary: number;
    allowances?: number;
    deductions?: number;
    notes?: string;
    createdById: string;
  }) {
    const net = (data.baseSalary ?? 0) + (data.allowances ?? 0) - (data.deductions ?? 0);
    return this.prisma.salary.create({
      data: {
        userId: data.userId,
        month: Number(data.month),
        year: Number(data.year),
        baseSalary: Number(data.baseSalary),
        allowances: Number(data.allowances ?? 0),
        deductions: Number(data.deductions ?? 0),
        netSalary: net,
        notes: data.notes,
        createdById: data.createdById,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async update(id: string, data: {
    baseSalary?: number;
    allowances?: number;
    deductions?: number;
    notes?: string;
  }) {
    const existing = await this.getOne(id);
    const base = data.baseSalary ?? existing.baseSalary;
    const allow = data.allowances ?? existing.allowances;
    const deduct = data.deductions ?? existing.deductions;
    return this.prisma.salary.update({
      where: { id },
      data: {
        baseSalary: Number(base),
        allowances: Number(allow),
        deductions: Number(deduct),
        netSalary: Number(base) + Number(allow) - Number(deduct),
        notes: data.notes,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
  }

  async markPaid(id: string, isPaid: boolean) {
    return this.prisma.salary.update({
      where: { id },
      data: { isPaid, paidAt: isPaid ? new Date() : null },
    });
  }

  async delete(id: string) {
    await this.getOne(id);
    return this.prisma.salary.delete({ where: { id } });
  }
}
