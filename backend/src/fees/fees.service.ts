import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DirectoryService } from '../directory/directory.service';

@Injectable()
export class FeesService {
  constructor(private prisma: PrismaService, private readonly directory: DirectoryService) {}

  // ─── Students list (for the "Add Fee" dropdown) ───────────────────────────

  async getStudents() {
    const feeRecords = await this.prisma.feeRecord.findMany({
      distinct: ['studentId'],
      select: { studentId: true },
      orderBy: { studentId: 'asc' },
    });
    const studentIds = feeRecords.map((r) => r.studentId);
    const result: Array<{ id: string; studentNumber: string; name: string; class: string }> = [];
    for (const studentId of studentIds) {
      const enrollment = await this.directory.getEnrollmentAtDate(studentId, await this.todayIso());
      if (!enrollment.enrolled) continue;
      result.push({
        id: studentId,
        studentNumber: '',
        name: 'Student', // placeholder until read-model enrichment is published
        class: enrollment.className ?? '',
      });
    }
    return result;
  }

  private async todayIso(): Promise<string> {
    const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
    if (!installation) throw new Error('Installation timezone is unavailable');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: installation.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  // ─── Fee Records ──────────────────────────────────────────────────────────

  async getAll(status?: string, search?: string) {
    const records = await this.prisma.feeRecord.findMany({
      include: {
        student: {
          include: {
            user: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mapped = records.map(r => this.mapRecord(r));

    // Filter by status
    let filtered = mapped;
    if (status && status !== 'all') {
      filtered = filtered.filter(r => this.computeStatus(r) === status);
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        r =>
          r.studentName.toLowerCase().includes(q) ||
          r.class.toLowerCase().includes(q),
      );
    }

    return filtered;
  }

  async getOne(id: string) {
    const r = await this.prisma.feeRecord.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            user: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Fee record not found');
    return this.mapRecord(r);
  }

  async create(data: {
    studentId: string;
    totalAmount: number;
    discount?: number;
    discountReason?: string;
    dueDate: string;
    term?: string;
    subject?: string;
    feeClass?: string;
    notes?: string;
    createdById: string;
  }) {
    const student = await this.prisma.student.findUnique({ where: { id: data.studentId } });
    if (!student) throw new BadRequestException('Student not found');

    const discount = data.discount ?? 0;
    if (discount < 0) throw new BadRequestException('Discount cannot be negative');
    if (discount > data.totalAmount) throw new BadRequestException('Discount cannot exceed total amount');

    const record = await this.prisma.feeRecord.create({
      data: {
        studentId: data.studentId,
        totalAmount: data.totalAmount,
        discount,
        discountReason: data.discountReason ?? null,
        paidAmount: 0,
        dueDate: new Date(data.dueDate),
        term: data.term ?? null,
        subject: data.subject ?? null,
        feeClass: data.feeClass ?? null,
        notes: data.notes ?? null,
        createdById: data.createdById,
      },
      include: {
        student: {
          include: {
            user: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
        payments: true,
      },
    });
    return this.mapRecord(record);
  }

  async update(
    id: string,
    data: { totalAmount?: number; discount?: number; discountReason?: string; dueDate?: string; term?: string; subject?: string; feeClass?: string; notes?: string },
  ) {
    const existing = await this.prisma.feeRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Fee record not found');

    const resolvedTotal = data.totalAmount ?? existing.totalAmount;
    const resolvedDiscount = data.discount ?? existing.discount;
    if (resolvedDiscount < 0) throw new BadRequestException('Discount cannot be negative');
    if (resolvedDiscount > resolvedTotal) throw new BadRequestException('Discount cannot exceed total amount');

    const record = await this.prisma.feeRecord.update({
      where: { id },
      data: {
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.discount !== undefined && { discount: data.discount }),
        ...(data.discountReason !== undefined && { discountReason: data.discountReason }),
        ...(data.dueDate !== undefined && { dueDate: new Date(data.dueDate) }),
        ...(data.term !== undefined && { term: data.term }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.feeClass !== undefined && { feeClass: data.feeClass }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: {
        student: {
          include: {
            user: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    return this.mapRecord(record);
  }

  async delete(id: string) {
    const existing = await this.prisma.feeRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Fee record not found');
    await this.prisma.feeRecord.delete({ where: { id } });
    return { success: true };
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  async recordPayment(
    feeRecordId: string,
    data: { amount: number; note?: string; createdById: string },
  ) {
    const record = await this.prisma.feeRecord.findUnique({ where: { id: feeRecordId } });
    if (!record) throw new NotFoundException('Fee record not found');

    const effective = record.totalAmount - (record.discount ?? 0);
    const balance = effective - record.paidAmount;
    if (data.amount <= 0) throw new BadRequestException('Amount must be greater than 0');
    if (data.amount > balance) {
      throw new BadRequestException(`Amount exceeds outstanding balance ($${balance})`);
    }

    await this.prisma.$transaction([
      this.prisma.feePayment.create({
        data: {
          feeRecordId,
          amount: data.amount,
          note: data.note ?? null,
          createdById: data.createdById,
        },
      }),
      this.prisma.feeRecord.update({
        where: { id: feeRecordId },
        data: { paidAmount: { increment: data.amount } },
      }),
    ]);

    return this.getOne(feeRecordId);
  }

  // ─── Summary stats ────────────────────────────────────────────────────────

  async getSummary() {
    const records = await this.getAll();
    const totalRevenue = records.reduce((s, r) => s + r.paidAmount, 0);
    const pendingAmount = records.reduce((s, r) => s + Math.max(0, (r.effectiveAmount ?? r.totalAmount) - r.paidAmount), 0);
    const paidCount = records.filter(r => this.computeStatus(r) === 'paid').length;
    const collectionRate =
      records.length > 0 ? Math.round((paidCount / records.length) * 100) : 0;

    return { totalRevenue, pendingAmount, paidCount, collectionRate, total: records.length };
  }

  // ─── Settings (singleton) ─────────────────────────────────────────────────

  async getSettings() {
    const s = await this.prisma.feeSettings.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
    return { ...s, discountPresets: JSON.parse(s.discountPresets), promotions: JSON.parse(s.promotions) };
  }

  async updateSettings(data: {
    schoolName?: string; schoolAddress?: string; schoolPhone?: string; schoolEmail?: string;
    invoiceTitle?: string; invoiceSubtitle?: string; invoiceFooter?: string;
    discountPresets?: any[]; promotions?: any[];
  }) {
    const payload: Record<string, any> = { ...data };
    if (data.discountPresets !== undefined) payload.discountPresets = JSON.stringify(data.discountPresets);
    if (data.promotions     !== undefined) payload.promotions      = JSON.stringify(data.promotions);
    const s = await this.prisma.feeSettings.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton', ...payload },
      update: payload,
    });
    return { ...s, discountPresets: JSON.parse(s.discountPresets), promotions: JSON.parse(s.promotions) };
  }

  // ─── Budget Report ────────────────────────────────────────────────────────

  async getBudgetReport(period: string, anchorDate: Date) {
    const y = anchorDate.getUTCFullYear();
    const m = anchorDate.getUTCMonth();
    const d = anchorDate.getUTCDate();

    let rangeStart: Date;
    let rangeEnd: Date;

    if (period === 'weekly') {
      const dow = anchorDate.getUTCDay();
      const daysToMon = (dow + 6) % 7;
      rangeStart = new Date(Date.UTC(y, m, d - daysToMon, 0, 0, 0));
      rangeEnd   = new Date(Date.UTC(y, m, d - daysToMon + 6, 23, 59, 59, 999));
    } else if (period === 'monthly') {
      rangeStart = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      rangeEnd   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    } else if (period === 'yearly') {
      rangeStart = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
      rangeEnd   = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    } else {
      // daily
      rangeStart = new Date(Date.UTC(y, m, d, 0, 0, 0));
      rangeEnd   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
    }

    const [payments, feesCreated] = await Promise.all([
      this.prisma.feePayment.findMany({
        where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
        include: {
          feeRecord: {
            include: {
              student: {
                include: {
                  user:  { select: { name: true } },
                  class: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.feeRecord.findMany({
        where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
      }),
    ]);

    const totalCollected  = payments.reduce((s, p) => s + p.amount, 0);
    const totalFees       = feesCreated.reduce((s, r) => s + r.totalAmount, 0);
    const discountGiven   = feesCreated.reduce((s, r) => s + (r.discount ?? 0), 0);
    const outstanding     = feesCreated.reduce((s, r) => s + Math.max(0, r.totalAmount - (r.discount ?? 0) - r.paidAmount), 0);
    const effective       = totalFees - discountGiven;
    const collectionRate  = effective > 0 ? Math.round((totalCollected / effective) * 100) : 0;

    // Build per-bucket breakdown
    const breakdown: { label: string; collected: number; fees: number }[] = [];

    const sumPayments = (from: Date, to: Date) =>
      payments.filter(p => p.createdAt >= from && p.createdAt <= to).reduce((s, p) => s + p.amount, 0);
    const sumFees = (from: Date, to: Date) =>
      feesCreated.filter(r => r.createdAt >= from && r.createdAt <= to).reduce((s, r) => s + r.totalAmount, 0);

    if (period === 'daily') {
      for (let h = 0; h < 24; h++) {
        const hStart = new Date(Date.UTC(y, m, d, h, 0, 0));
        const hEnd   = new Date(Date.UTC(y, m, d, h, 59, 59, 999));
        breakdown.push({ label: `${String(h).padStart(2, '0')}:00`, collected: sumPayments(hStart, hEnd), fees: sumFees(hStart, hEnd) });
      }
    } else if (period === 'weekly') {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (let i = 0; i < 7; i++) {
        const rs = rangeStart;
        const ds = new Date(Date.UTC(rs.getUTCFullYear(), rs.getUTCMonth(), rs.getUTCDate() + i, 0, 0, 0));
        const de = new Date(Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth(), ds.getUTCDate(), 23, 59, 59, 999));
        breakdown.push({ label: dayNames[i], collected: sumPayments(ds, de), fees: sumFees(ds, de) });
      }
    } else if (period === 'monthly') {
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const ds = new Date(Date.UTC(y, m, day, 0, 0, 0));
        const de = new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
        breakdown.push({ label: String(day), collected: sumPayments(ds, de), fees: sumFees(ds, de) });
      }
    } else {
      // yearly
      const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (let mo = 0; mo < 12; mo++) {
        const ds = new Date(Date.UTC(y, mo, 1, 0, 0, 0));
        const de = new Date(Date.UTC(y, mo + 1, 0, 23, 59, 59, 999));
        breakdown.push({ label: monthLabels[mo], collected: sumPayments(ds, de), fees: sumFees(ds, de) });
      }
    }

    return {
      period,
      dateRange: {
        start: rangeStart.toISOString().split('T')[0],
        end:   rangeEnd.toISOString().split('T')[0],
      },
      summary: { totalCollected, totalFees, discountGiven, outstanding, collectionRate, feeRecordsCreated: feesCreated.length, paymentsCount: payments.length },
      breakdown,
      payments: payments.map(p => ({
        id:          p.id,
        studentName: p.feeRecord.student.user.name,
        class:       p.feeRecord.student.class?.name ?? '',
        amount:      p.amount,
        note:        p.note ?? '',
        date:        p.createdAt.toISOString().split('T')[0],
        time:        p.createdAt.toISOString().split('T')[1].slice(0, 5),
      })),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private mapRecord(r: any) {
    const discount = r.discount ?? 0;
    return {
      id: r.id,
      studentId: r.studentId,
      studentName: r.student.user.name,
      studentNumber: r.student.studentNumber ?? '',
      class: r.student.class?.name ?? '',
      totalAmount: r.totalAmount,
      discount,
      discountReason: r.discountReason ?? '',
      effectiveAmount: r.totalAmount - discount,
      paidAmount: r.paidAmount,
      dueDate: r.dueDate instanceof Date
        ? r.dueDate.toISOString().split('T')[0]
        : String(r.dueDate).split('T')[0],
      term: r.term ?? '',
      subject: r.subject ?? '',
      feeClass: r.feeClass ?? '',
      notes: r.notes ?? '',
      payments: (r.payments ?? []).map((p: any) => ({
        id: p.id,
        amount: p.amount,
        date: p.createdAt instanceof Date
          ? p.createdAt.toISOString().split('T')[0]
          : String(p.createdAt).split('T')[0],
        note: p.note ?? '',
        createdBy: p.createdById,
      })),
    };
  }

  private computeStatus(r: { totalAmount: number; discount?: number; paidAmount: number; dueDate: string }) {
    const effective = r.totalAmount - (r.discount ?? 0);
    const balance = effective - r.paidAmount;
    if (balance <= 0) return 'paid';
    if (new Date(r.dueDate) < new Date()) return 'overdue';
    if (r.paidAmount > 0) return 'partial';
    return 'pending';
  }
}
