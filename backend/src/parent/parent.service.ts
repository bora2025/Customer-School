import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ParentService {
  constructor(private prisma: PrismaService) {}

  async getChildren(parentUserId: string) {
    return this.prisma.student.findMany({
      where: { parentId: parentUserId },
      include: {
        user: { select: { id: true, name: true, photo: true, email: true } },
        class: { select: { id: true, name: true, subject: true } },
      },
    });
  }

  async getChildAttendance(studentId: string, from?: string, to?: string) {
    return this.prisma.attendance.findMany({
      where: {
        studentId,
        ...(from && to
          ? { date: { gte: new Date(from), lte: new Date(to) } }
          : {}),
      },
      include: { class: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 90,
    });
  }

  async getChildGrades(studentId: string) {
    return this.prisma.assignmentSubmission.findMany({
      where: { studentId, status: 'GRADED' },
      include: {
        assignment: {
          include: { class: { select: { name: true, subject: true } } },
        },
      },
      orderBy: { gradedAt: 'desc' },
    });
  }

  async getChildFees(studentId: string) {
    return this.prisma.feeRecord.findMany({
      where: { studentId },
      include: { payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Student-side: view own parent / request a link ──────────────────────
  async getMyParent(studentUserId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId: studentUserId },
      include: {
        parent: { select: { id: true, name: true, email: true, phone: true, photo: true } },
      },
    });
    if (!student) return { studentExists: false, parent: null };
    return { studentExists: true, studentId: student.id, parent: student.parent ?? null };
  }

  async getMyParentRequest(studentUserId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId: studentUserId },
      select: { id: true },
    });
    if (!student) return null;
    return this.prisma.parentLinkRequest.findFirst({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createParentLinkRequest(
    studentUserId: string,
    body: { parentEmail: string; parentName?: string; parentPhone?: string; note?: string },
  ) {
    const email = (body?.parentEmail || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Invalid parent email');
    }
    const student = await this.prisma.student.findUnique({
      where: { userId: studentUserId },
      include: { user: { select: { name: true } } },
    });
    if (!student) throw new Error('Student profile not found');
    if (student.parentId) throw new Error('You are already linked to a parent. Contact admin to change.');

    // Reject if there is already a pending request
    const existing = await this.prisma.parentLinkRequest.findFirst({
      where: { studentId: student.id, status: 'PENDING' },
    });
    if (existing) return existing;

    const created = await this.prisma.parentLinkRequest.create({
      data: {
        studentId: student.id,
        parentEmail: email,
        parentName: body.parentName?.trim() || null,
        parentPhone: body.parentPhone?.trim() || null,
        note: body.note?.trim() || null,
      },
    });

    // Notify all admins
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      if (admins.length) {
        await this.prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            type: 'parent_link_request',
            message: `${student.user?.name ?? 'A student'} requested to link parent ${email}`,
          })),
        });
      }
    } catch {}

    return created;
  }

  // ─── Admin-side: list & resolve link requests ────────────────────────────
  async listParentLinkRequests(status?: string) {
    return this.prisma.parentLinkRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, email: true, photo: true } },
            class: { select: { id: true, name: true } },
          },
        },
      },
      take: 200,
    });
  }

  async resolveParentLinkRequest(
    adminUserId: string,
    requestId: string,
    body: { action: 'APPROVE' | 'REJECT'; rejectReason?: string },
  ) {
    const req = await this.prisma.parentLinkRequest.findUnique({
      where: { id: requestId },
      include: { student: { include: { user: { select: { id: true, name: true } } } } },
    });
    if (!req) throw new Error('Request not found');
    if (req.status !== 'PENDING') throw new Error('Request already resolved');

    if (body.action === 'REJECT') {
      const updated = await this.prisma.parentLinkRequest.update({
        where: { id: req.id },
        data: {
          status: 'REJECTED',
          rejectReason: body.rejectReason?.trim() || null,
          resolvedAt: new Date(),
          resolvedBy: adminUserId,
        },
      });
      try {
        await this.prisma.notification.create({
          data: {
            userId: req.student.userId,
            type: 'parent_link_rejected',
            message: `Your parent-link request was rejected${body.rejectReason ? `: ${body.rejectReason}` : ''}.`,
          },
        });
      } catch {}
      return updated;
    }

    // APPROVE
    let parentUser = await this.prisma.user.findUnique({
      where: { email: req.parentEmail },
      select: { id: true, role: true, name: true },
    });
    if (parentUser) {
      // Promote to PARENT role if currently a non-staff role with no other portal use.
      if (parentUser.role !== 'PARENT' && parentUser.role !== 'ADMIN' && parentUser.role !== 'TEACHER') {
        await this.prisma.user.update({
          where: { id: parentUser.id },
          data: { role: 'PARENT' },
        });
      }
    } else {
      // Create a placeholder PARENT account. Admin will share credentials out-of-band.
      const tempPassword = '$2a$10$placeholderPlaceholderPlaceholderPlaceholderPlaceholder12'; // intentionally unusable
      parentUser = await this.prisma.user.create({
        data: {
          email: req.parentEmail,
          password: tempPassword,
          name: req.parentName || req.parentEmail.split('@')[0],
          phone: req.parentPhone ?? null,
          role: 'PARENT',
        },
        select: { id: true, role: true, name: true },
      });
    }

    if (!parentUser?.id) {
      throw new Error('Failed to resolve parent user');
    }

    await this.prisma.student.update({
      where: { id: req.studentId },
      data: { parentId: parentUser.id },
    });

    const updated = await this.prisma.parentLinkRequest.update({
      where: { id: req.id },
      data: {
        status: 'APPROVED',
        resolvedAt: new Date(),
        resolvedBy: adminUserId,
      },
    });

    try {
      await this.prisma.notification.createMany({
        data: [
          {
            userId: req.student.userId,
            type: 'parent_link_approved',
            message: `Your parent (${parentUser.name}) is now linked to your account.`,
          },
          {
            userId: parentUser.id,
            type: 'parent_link_approved',
            message: `You have been linked to student ${req.student.user?.name ?? ''}.`,
          },
        ],
      });
    } catch {}

    return updated;
  }
}
