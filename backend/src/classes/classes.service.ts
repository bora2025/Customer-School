import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as bcrypt from 'bcryptjs';
import { isValidEmail, normalizePhone } from '../common/identity';

const REGISTRATION_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN'];

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  private assertValidRegistrationStatus(status?: string) {
    if (status !== undefined && !REGISTRATION_STATUSES.includes(status)) {
      throw new BadRequestException('registrationStatus must be one of AVAILABLE, UNAVAILABLE, HIDDEN');
    }
  }

  private assertValidPrice(price?: number | null) {
    if (price !== undefined && price !== null && (typeof price !== 'number' || isNaN(price) || price < 0)) {
      throw new BadRequestException('price must be a non-negative number');
    }
  }

  async createClass(data: { name: string; subject?: string; teacherId: string; classAdminId?: string; schedule?: string; studyYearId?: string; registrationStatus?: string; thumbnail?: string; description?: string; price?: number | null; showPrice?: boolean }) {
    // Validate that teacherId belongs to a user with TEACHER role
    const teacher = await this.prisma.user.findUnique({ where: { id: data.teacherId } });
    if (!teacher || teacher.role !== 'TEACHER') {
      throw new BadRequestException('Only users with TEACHER role can be assigned as teacher');
    }
    // Validate classAdminId if provided
    if (data.classAdminId) {
      const ca = await this.prisma.user.findUnique({ where: { id: data.classAdminId } });
      if (!ca || ca.role !== 'CLASS_ADMIN') {
        throw new BadRequestException('Only users with CLASS_ADMIN role can be assigned as class admin');
      }
    }
    this.assertValidRegistrationStatus(data.registrationStatus);
    this.assertValidPrice(data.price);
    // Optional FK fields arrive as '' from "None" dropdown options — Prisma/Postgres
    // rejects '' as a foreign key value, so normalize to undefined (omit from insert).
    return this.prisma.class.create({
      data: {
        ...data,
        classAdminId: data.classAdminId || undefined,
        studyYearId: data.studyYearId || undefined,
      },
      include: { teacher: { select: { name: true } }, classAdmin: { select: { name: true } }, studyYear: true },
    });
  }

  async updateClass(id: string, data: { name?: string; subject?: string; teacherId?: string; classAdminId?: string | null; schedule?: string; studyYearId?: string; registrationStatus?: string; thumbnail?: string; description?: string; price?: number | null; showPrice?: boolean }) {
    // Validate that teacherId belongs to a user with TEACHER role
    if (data.teacherId) {
      const teacher = await this.prisma.user.findUnique({ where: { id: data.teacherId } });
      if (!teacher || teacher.role !== 'TEACHER') {
        throw new BadRequestException('Only users with TEACHER role can be assigned as teacher');
      }
    }
    // Validate classAdminId if provided (null = unset)
    if (data.classAdminId) {
      const ca = await this.prisma.user.findUnique({ where: { id: data.classAdminId } });
      if (!ca || ca.role !== 'CLASS_ADMIN') {
        throw new BadRequestException('Only users with CLASS_ADMIN role can be assigned as class admin');
      }
    }
    this.assertValidRegistrationStatus(data.registrationStatus);
    this.assertValidPrice(data.price);
    // '' from "None"/"No study year" dropdowns must clear the FK (null), not be sent as '' —
    // Postgres rejects '' as a foreign key value with an unhandled constraint error.
    return this.prisma.class.update({
      where: { id },
      data: {
        ...data,
        classAdminId: data.classAdminId === '' ? null : data.classAdminId,
        studyYearId: data.studyYearId === '' ? null : data.studyYearId,
      },
      include: { teacher: { select: { name: true } }, classAdmin: { select: { name: true } }, studyYear: true },
    });
  }

  async getClasses(teacherId?: string, studyYearId?: string) {
    const where: any = {};
    if (teacherId) where.teacherId = teacherId;
    if (studyYearId) where.studyYearId = studyYearId;
    return this.prisma.class.findMany({
      where,
      include: { teacher: { select: { name: true } }, classAdmin: { select: { name: true } }, studyYear: true },
    });
  }

  /** Returns classes where the given user is assigned as classAdmin. */
  async getClassesByAdmin(classAdminId: string, studyYearId?: string) {
    const where: any = { classAdminId };
    if (studyYearId) where.studyYearId = studyYearId;
    return this.prisma.class.findMany({
      where,
      include: { teacher: { select: { name: true } }, classAdmin: { select: { name: true } }, studyYear: true },
    });
  }

  async getStudentsInClass(classId: string) {
    const students = await this.prisma.student.findMany({
      where: { classId },
      include: {
        user: true,
        class: true,
        parent: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    return students.map(s => ({
      id: s.id,
      studentNumber: s.studentNumber || '',
      userId: s.userId,
      name: s.user.name,
      nameKh: s.nameKh || '',
      email: s.user.email,
      phone: s.user.phone || '',
      qrCode: s.qrCode,
      photo: s.photo,
      sex: s.sex,
      dateOfBirth: s.dateOfBirth,
      address: s.address || '',
      generation: s.generation || '',
      customFieldValues: s.customFieldValues || {},
      className: s.class?.name || null,
      parentId: s.parentId,
      parent: s.parent,
    }));
  }

  /**
   * Batch fetch students for many classes in a single query.
   * Returns a map of { [classId]: Student[] } — empty arrays for classes with no students.
   */
  async getStudentsByClasses(classIds: string[]): Promise<Record<string, any[]>> {
    const result: Record<string, any[]> = {};
    for (const id of classIds) result[id] = [];
    if (classIds.length === 0) return result;
    const students = await this.prisma.student.findMany({
      where: { classId: { in: classIds } },
      include: {
        user: true,
        class: true,
        parent: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    for (const s of students) {
      const mapped = {
        id: s.id,
        studentNumber: s.studentNumber || '',
        userId: s.userId,
        name: s.user.name,
        nameKh: s.nameKh || '',
        email: s.user.email,
        phone: s.user.phone || '',
        qrCode: s.qrCode,
        photo: s.photo,
        sex: s.sex,
        dateOfBirth: s.dateOfBirth,
        address: s.address || '',
        generation: s.generation || '',
        customFieldValues: s.customFieldValues || {},
        className: s.class?.name || null,
        parentId: s.parentId,
        parent: s.parent,
      };
      const cid = s.classId as string;
      if (!result[cid]) result[cid] = [];
      result[cid].push(mapped);
    }
    return result;
  }

  async listParents() {
    const parents = await this.prisma.user.findMany({
      where: { role: 'PARENT' },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });
    return parents;
  }

  async addStudentToClass(classId: string, studentId: string) {
    // studentId could be either a Student record id or a User id
    // Try finding by Student id first, then by userId
    let existingStudent = await this.prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!existingStudent) {
      existingStudent = await this.prisma.student.findUnique({
        where: { userId: studentId },
      });
    }

    if (existingStudent) {
      // Backfill studentNumber if missing
      const updateData: any = { classId };
      if (!existingStudent.studentNumber) {
        updateData.studentNumber = await this.generateStudentNumber(classId);
      }
      return this.prisma.student.update({
        where: { id: existingStudent.id },
        data: updateData,
        include: { user: true, class: true },
      });
    } else {
      // Create new student record — studentId must be a userId
      const studentNumber = await this.generateStudentNumber(classId);
      return this.prisma.student.create({
        data: {
          userId: studentId,
          classId,
          studentNumber,
        },
        include: { user: true, class: true },
      });
    }
  }

  private async generateStudentNumber(classId: string): Promise<string> {
    const count = await this.prisma.student.count({ where: { classId } });
    return String(count + 1).padStart(4, '0');
  }

  async removeStudentFromClass(classId: string, studentId: string) {
    // Fully delete the student and their user account from the database.
    // This prevents orphaned duplicates accumulating across CSV re-imports.
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, userId: true },
    });
    if (!student) return { success: false, message: 'Student not found' };

    await this.prisma.$transaction(async (tx) => {
      // 1. Delete all child records that reference student (no DB-level cascade)
      await tx.attendance.deleteMany({ where: { studentId } });
      await tx.feeRecord.deleteMany({ where: { studentId } });
      await tx.parentLinkRequest.deleteMany({ where: { studentId } });

      // ExamAttempt, AssignmentSubmission, CourseEnrollment, CourseAttendance,
      // LessonView — delete only if the models exist in this Prisma client.
      const p = tx as any;
      if (p.examAttempt) await p.examAttempt.deleteMany({ where: { studentId } });
      if (p.assignmentSubmission) await p.assignmentSubmission.deleteMany({ where: { studentId } });
      if (p.courseEnrollment) await p.courseEnrollment.deleteMany({ where: { studentId } });
      if (p.courseAttendance) await p.courseAttendance.deleteMany({ where: { studentId } });
      if (p.lessonView) await p.lessonView.deleteMany({ where: { studentId } });

      // 2. Delete student (cardAliases cascade via DB onDelete: Cascade)
      await tx.student.delete({ where: { id: studentId } });

      // 3. Delete the linked user account
      await tx.refreshToken.deleteMany({ where: { userId: student.userId } });
      await tx.notification.deleteMany({ where: { userId: student.userId } });
      await tx.user.delete({ where: { id: student.userId, role: 'STUDENT' } });
    });

    return { success: true };
  }

  async getAvailableStudents(classId: string) {
    const students = await this.prisma.student.findMany({
      where: {
        classId: null,
      },
      include: { user: true },
    });
    return students.map(s => ({
      id: s.id,
      name: s.user.name,
      email: s.user.email,
      qrCode: s.qrCode,
      photo: s.photo,
      sex: s.sex,
    }));
  }

  async deleteClass(id: string) {
    // Find all students in this class
    const students = await this.prisma.student.findMany({
      where: { classId: id },
      select: { id: true, userId: true },
    });

    const studentIds = students.map(s => s.id);
    const userIds = students.map(s => s.userId);

    // Delete attendance records for these students
    if (studentIds.length > 0) {
      await this.prisma.attendance.deleteMany({
        where: { studentId: { in: studentIds } },
      });
    }

    // Delete student records
    await this.prisma.student.deleteMany({
      where: { classId: id },
    });

    // Delete session configs for this class
    await this.prisma.sessionConfig.deleteMany({
      where: { classId: id },
    });

    // Delete attendance records for this class (in case any remain)
    await this.prisma.attendance.deleteMany({
      where: { classId: id },
    });

    // Delete self-registration requests for this class — classId is a required
    // FK with no cascade, so leaving these would block the delete below.
    await this.prisma.classRegistration.deleteMany({
      where: { classId: id },
    });

    // Delete the class
    const deletedClass = await this.prisma.class.delete({ where: { id } });

    // Delete user accounts for these students
    if (userIds.length > 0) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await this.prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await this.prisma.user.deleteMany({
        where: { id: { in: userIds }, role: 'STUDENT' },
      });
    }

    return deletedClass;
  }

  async cleanupOrphanedStudents() {
    // Find students with no class (orphaned from deleted classes)
    const orphanedStudents = await this.prisma.student.findMany({
      where: { classId: null },
      select: { id: true, userId: true },
    });

    if (orphanedStudents.length === 0) {
      return { deleted: 0 };
    }

    const studentIds = orphanedStudents.map(s => s.id);
    const userIds = orphanedStudents.map(s => s.userId);

    // Delete attendance records for orphaned students
    await this.prisma.attendance.deleteMany({
      where: { studentId: { in: studentIds } },
    });

    // Delete orphaned student records
    await this.prisma.student.deleteMany({
      where: { id: { in: studentIds } },
    });

    // Delete user accounts for orphaned students
    if (userIds.length > 0) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await this.prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await this.prisma.user.deleteMany({
        where: { id: { in: userIds }, role: 'STUDENT' },
      });
    }

    return { deleted: orphanedStudents.length };
  }

  async bulkAddStudentsFromCsv(classId: string, fileBuffer: Buffer) {
    const content = fileBuffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());

    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have a header row and at least one data row');
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    // Support flexible column names
    const idIdx = header.findIndex(h => h === 'id');
    const nameIdx = header.findIndex(h => h === 'name');
    const sexIdx = header.findIndex(h => h === 'sex');
    const classIdx = header.findIndex(h => h === 'class');
    const emailIdx = header.findIndex(h => h.includes('mail'));
    const phoneIdx = header.findIndex(h => h.includes('phone') || h.includes('contact'));
    const photoIdx = header.findIndex(h => h === 'photo');
    const passwordIdx = header.findIndex(h => h === 'password');
    const dobIdx = header.findIndex(h => h.includes('birth') || h.includes('dob') || h === 'date of birth');
    const addressIdx = header.findIndex(h => h === 'address');
    const generationIdx = header.findIndex(h => h === 'generation' || h.includes('generation'));

    if (nameIdx === -1) {
      throw new BadRequestException('CSV must have a "Name" column');
    }

    // Verify class exists
    const classRecord = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!classRecord) {
      throw new BadRequestException('Class not found');
    }

    const results: { row: number; id: string; name: string; email: string; status: string; error?: string }[] = [];
    const usedIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      const studentId = idIdx !== -1 ? cols[idIdx]?.trim() : String(i).padStart(4, '0');
      const name = cols[nameIdx]?.trim();
      const rawSex = sexIdx !== -1 ? cols[sexIdx]?.trim() : '';
      const rawEmail = emailIdx !== -1 ? cols[emailIdx]?.trim() : '';
      const rawPhone = phoneIdx !== -1 ? cols[phoneIdx]?.trim() : '';
      const rawPhoto = photoIdx !== -1 ? cols[photoIdx]?.trim() : '';
      const password = passwordIdx !== -1 ? cols[passwordIdx]?.trim() : '';
      const dateOfBirth = dobIdx !== -1 ? cols[dobIdx]?.trim() : '';
      const address = addressIdx !== -1 ? cols[addressIdx]?.trim() : '';
      const generation = generationIdx !== -1 ? cols[generationIdx]?.trim() : '';

      if (!name) {
        results.push({ row: i + 1, id: studentId, name: '', email: '', status: 'skipped', error: 'Missing name' });
        continue;
      }

      // Convert Google Drive sharing links to direct image URLs
      const photo = this.convertGoogleDriveUrl(rawPhoto);

      // Map sex: support Khmer (ប្រុស=MALE, ស្រី=FEMALE) and English
      let sex: string | undefined;
      if (rawSex === 'ប្រុស' || rawSex.toUpperCase() === 'MALE' || rawSex.toUpperCase() === 'M') {
        sex = 'MALE';
      } else if (rawSex === 'ស្រី' || rawSex.toUpperCase() === 'FEMALE' || rawSex.toUpperCase() === 'F') {
        sex = 'FEMALE';
      }

      const email = rawEmail && isValidEmail(rawEmail) ? rawEmail.toLowerCase() : '';
      const phone = rawPhone;
      const normalizedPhone = normalizePhone(phone);

      // Track student IDs to detect duplicates within this batch
      if (usedIds.has(studentId)) {
        results.push({ row: i + 1, id: studentId, name, email: '', status: 'error', error: 'Duplicate student ID in CSV' });
        continue;
      }
      usedIds.add(studentId);

      // Use provided password or default
      const finalPassword = password || `student${studentId}`;

      try {
        // Match against an existing roster entry for THIS class + student ID only —
        // never by a globally-derived synthetic email. Row-position-based IDs reset
        // to 0001 on every upload with no "ID" column, so matching by email alone
        // let a later CSV (even for a different class) silently rename and re-parent
        // an earlier, unrelated student into itself.
        let student = await this.prisma.student.findFirst({ where: { classId, studentNumber: studentId } });
        let user;

        if (student) {
          user = await this.prisma.user.update({
            where: { id: student.userId },
            data: {
              name,
              ...(phone ? { phone, phoneNormalized: normalizedPhone || undefined } : {}),
              ...(email ? { email } : {}),
            },
          });
        } else {
          // Prefer a real email or phone from the CSV as the login identity; only
          // fall back to a synthetic placeholder email when neither was given.
          let finalEmail = email;
          if (finalEmail) {
            const clash = await this.prisma.user.findUnique({ where: { email: finalEmail } });
            if (clash) throw new Error(`Email ${finalEmail} is already used by another account`);
          } else if (normalizedPhone) {
            const clash = await this.prisma.user.findUnique({ where: { phoneNormalized: normalizedPhone } });
            if (clash) throw new Error(`Phone number ${phone} is already used by another account`);
          } else {
            finalEmail = `student${studentId}@school.local`;
            let suffix = 1;
            while (await this.prisma.user.findUnique({ where: { email: finalEmail } })) {
              suffix++;
              finalEmail = `student${studentId}-${suffix}@school.local`;
            }
          }
          const hashedPassword = await bcrypt.hash(finalPassword, 10);
          user = await this.prisma.user.create({
            data: {
              email: finalEmail || undefined,
              password: hashedPassword,
              name,
              role: 'STUDENT',
              ...(phone ? { phone, phoneNormalized: normalizedPhone || undefined } : {}),
            },
          });
        }

        const studentData: any = {
          classId,
          studentNumber: studentId,
          ...(sex ? { sex } : {}),
          ...(photo ? { photo } : {}),
          ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
          ...(address ? { address } : {}),
          ...(generation ? { generation } : {}),
        };

        if (!student) {
          student = await this.prisma.student.create({
            data: { userId: user.id, ...studentData },
          });
        } else {
          student = await this.prisma.student.update({
            where: { id: student.id },
            data: studentData,
          });
        }

        results.push({ row: i + 1, id: studentId, name, email: user.email || '', status: 'success' });
      } catch (err: any) {
        results.push({ row: i + 1, id: studentId, name, email: '', status: 'error', error: err.message || 'Unknown error' });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    return { total: results.length, success: successCount, errors: errorCount, skipped: skippedCount, details: results };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current);
    return result;
  }

  private convertGoogleDriveUrl(url: string): string {
    if (!url) return url;
    const match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return `https://lh3.googleusercontent.com/d/${match[1]}`;
    }
    return url;
  }

  async updateStudent(studentId: string, data: { name?: string; nameKh?: string; sex?: string; phone?: string; photo?: string; dateOfBirth?: string; address?: string; generation?: string; studentNumber?: string; parentId?: string | null; customFieldValues?: Record<string, string> }) {
    // Update student fields (sex, photo, dateOfBirth, address, generation, studentNumber, parentId)
    const studentData: any = {};
    if (data.nameKh !== undefined) studentData.nameKh = data.nameKh;
    if (data.sex !== undefined) studentData.sex = data.sex;
    if (data.photo !== undefined) studentData.photo = this.convertGoogleDriveUrl(data.photo || '');
    if (data.dateOfBirth !== undefined) studentData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    if (data.address !== undefined) studentData.address = data.address;
    if (data.generation !== undefined) studentData.generation = data.generation;
    if (data.studentNumber !== undefined) studentData.studentNumber = data.studentNumber.trim() || null;
    if (data.customFieldValues !== undefined) studentData.customFieldValues = data.customFieldValues;
    if (data.parentId !== undefined) {
      if (data.parentId) {
        const parent = await this.prisma.user.findUnique({
          where: { id: data.parentId },
          select: { id: true, role: true },
        });
        if (!parent || parent.role !== 'PARENT') {
          throw new Error('parentId must reference a user with role PARENT');
        }
      }
      studentData.parentId = data.parentId || null;
    }

    const student = await this.prisma.student.update({
      where: { id: studentId },
      data: studentData,
      include: { user: true, class: true },
    });

    // Update user fields (name, phone) if provided
    const userData: any = {};
    if (data.name) userData.name = data.name;
    if (data.phone !== undefined) userData.phone = data.phone;
    if (Object.keys(userData).length > 0) {
      await this.prisma.user.update({
        where: { id: student.userId },
        data: userData,
      });
    }

    const updatedUser = data.name
      ? await this.prisma.user.findUnique({ where: { id: student.userId } })
      : student.user;

    return {
      id: student.id,
      studentNumber: student.studentNumber || '',
      userId: student.userId,
      name: updatedUser?.name || student.user.name,
      nameKh: student.nameKh || '',
      email: updatedUser?.email || student.user.email,
      phone: updatedUser?.phone || student.user.phone || '',
      qrCode: student.qrCode,
      photo: student.photo,
      sex: student.sex,
      dateOfBirth: student.dateOfBirth,
      address: student.address || '',
      generation: student.generation || '',
      customFieldValues: student.customFieldValues || {},
      parentId: student.parentId,
      className: student.class?.name || null,
    };
  }
}