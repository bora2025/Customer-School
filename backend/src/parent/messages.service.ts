import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MessagesGateway } from './messages.gateway';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService, private gateway: MessagesGateway) {}

  /**
   * Safeguarding policy:
   *   - PARENT ↔ PARENT  blocked
   *   - STUDENT ↔ STUDENT blocked
   *   - PARENT ↔ STUDENT allowed only when student is the parent's own child
   *   - TEACHER/ADMIN can message anyone
   */
  private async assertCanMessage(senderId: string, receiverId: string) {
    if (senderId === receiverId) throw new BadRequestException('Cannot message yourself');
    const [sender, receiver] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: senderId }, select: { id: true, role: true } }),
      this.prisma.user.findUnique({ where: { id: receiverId }, select: { id: true, role: true } }),
    ]);
    if (!sender || !receiver) throw new BadRequestException('User not found');

    const a = sender.role;
    const b = receiver.role;
    if (a === 'ADMIN' || a === 'TEACHER' || b === 'ADMIN' || b === 'TEACHER') return;
    if (a === 'PARENT' && b === 'PARENT') throw new ForbiddenException('Parents cannot message other parents');
    if (a === 'STUDENT' && b === 'STUDENT') throw new ForbiddenException('Students cannot message other students');
    if ((a === 'PARENT' && b === 'STUDENT') || (a === 'STUDENT' && b === 'PARENT')) {
      const parentId = a === 'PARENT' ? sender.id : receiver.id;
      const studentUserId = a === 'STUDENT' ? sender.id : receiver.id;
      const child = await this.prisma.student.findFirst({
        where: { userId: studentUserId, parentId },
        select: { id: true },
      });
      if (!child) throw new ForbiddenException('You may only message your own child / parent');
    }
  }

  async getConversation(userA: string, userB: string) {
    return this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: userA, receiverId: userB },
          { senderId: userB, receiverId: userA },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, photo: true } },
        receiver: { select: { id: true, name: true, photo: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getInbox(userId: string) {
    // Latest message per conversation partner.
    // Include both sender and receiver on each row so the frontend can always
    // read `lastMessage.sender.id` regardless of message direction.
    const both = {
      sender: { select: { id: true, name: true, photo: true, role: true } },
      receiver: { select: { id: true, name: true, photo: true, role: true } },
    } as const;
    const sent = await this.prisma.message.findMany({
      where: { senderId: userId },
      include: both,
      orderBy: { createdAt: 'desc' },
    });
    const received = await this.prisma.message.findMany({
      where: { receiverId: userId },
      include: both,
      orderBy: { createdAt: 'desc' },
    });
    // Group by partner
    const partners = new Map<string, any>();
    for (const m of [...sent, ...received]) {
      const partnerId = m.senderId === userId ? m.receiverId : m.senderId;
      const partner = m.senderId === userId ? (m as any).receiver : (m as any).sender;
      if (!partners.has(partnerId)) partners.set(partnerId, { partner, lastMessage: m });
    }
    return Array.from(partners.values()).sort(
      (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
    );
  }

  async send(senderId: string, receiverId: string, content: string) {
    if (!content?.trim()) throw new BadRequestException('Message cannot be empty');
    await this.assertCanMessage(senderId, receiverId);
    const created = await this.prisma.message.create({
      data: { senderId, receiverId, content: content.trim() },
      include: {
        sender: { select: { id: true, name: true, photo: true } },
        receiver: { select: { id: true, name: true, photo: true } },
      },
    });
    try { this.gateway.notifyNewMessage(receiverId, senderId, created); } catch {}
    return created;
  }

  async markRead(userId: string, partnerId: string) {
    await this.prisma.message.updateMany({
      where: { senderId: partnerId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    try { this.gateway.notifyRead(partnerId, userId); } catch {}
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.message.count({
      where: { receiverId: userId, readAt: null },
    });
    return { count };
  }

  async getTeachers() {
    return this.prisma.user.findMany({
      where: { role: { in: ['TEACHER', 'ADMIN'] } },
      select: { id: true, name: true, photo: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  async getParentsStudents() {
    return this.prisma.user.findMany({
      where: { role: { in: ['PARENT', 'STUDENT'] } },
      select: { id: true, name: true, photo: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Returns the user's family contacts:
   *   - PARENT  → their linked children (User rows, role=STUDENT)
   *   - STUDENT → their linked parent  (User row, role=PARENT) — if any
   *   - others  → []
   */
  async getFamilyContacts(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!me) return [];
    if (me.role === 'PARENT') {
      const kids = await this.prisma.student.findMany({
        where: { parentId: userId },
        include: { user: { select: { id: true, name: true, photo: true, role: true } } },
      });
      return kids
        .filter(k => k.user)
        .map(k => ({ ...k.user, relation: 'child' as const }));
    }
    if (me.role === 'STUDENT') {
      const student = await this.prisma.student.findUnique({
        where: { userId },
        select: { parentId: true },
      });
      if (!student?.parentId) return [];
      const parent = await this.prisma.user.findUnique({
        where: { id: student.parentId },
        select: { id: true, name: true, photo: true, role: true },
      });
      return parent ? [{ ...parent, relation: 'parent' as const }] : [];
    }
    return [];
  }
}
