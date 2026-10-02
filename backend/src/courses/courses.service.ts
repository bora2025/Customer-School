import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  validatePageContent,
  gradeQuestion,
  computeLessonMaxScore,
  resolveNextPageId,
  QuestionPagePayload,
  SubmittedAnswer,
} from './lesson-content';
import { DirectoryService } from '../directory/directory.service';

// ─── Lifecycle constants ──────────────────────────────────────────────────
// Mirrors the documented state-flow:
//   DRAFT  →  PUBLISHED  →  ENROLLMENT  →  ACTIVE  →  COMPLETED  →  ARCHIVED
export const COURSE_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ENROLLMENT',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

// Allowed direct transitions. Linear forward, plus archive from any non-archived
// state, plus moving back to DRAFT from PUBLISHED (in case of mistake).
const ALLOWED_TRANSITIONS: Record<CourseStatus, CourseStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ENROLLMENT', 'DRAFT', 'ARCHIVED'],
  ENROLLMENT: ['ACTIVE', 'PUBLISHED', 'ARCHIVED'],
  ACTIVE: ['COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

const LESSON_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
const LESSON_GRADING_MODES = ['GRADED', 'PRACTICE', 'UNGRADED'] as const;
const PAGE_TYPES = ['CONTENT', 'QUESTION', 'BRANCH'] as const;

function toDate(v: string | Date | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

interface CourseInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  classId?: string;
  status?: string;
  enrollmentOpen?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  coverImageUrl?: string | null;
}

interface LessonInput {
  title?: string;
  description?: string | null;
  order?: number;
  status?: string;
  gradingMode?: string;
  availableFrom?: string | null;
  availableUntil?: string | null;
  showProgressBar?: boolean;
  branchingEnabled?: boolean;
  totalPoints?: number;
  passingScore?: number | null;
  requireVideoWatch?: boolean;
  videoWatchPct?: number;
  maxAttempts?: number;
}

interface PageInput {
  title?: string;
  pageType?: string;
  content?: any;
  order?: number;
  nextPageId?: string | null;
}

function sanitizeCourseInput(input: CourseInput) {
  const data: any = {};
  if (input.title !== undefined) data.title = String(input.title).trim();
  if (input.description !== undefined)
    data.description = input.description ? String(input.description).trim() : null;
  if (input.category !== undefined)
    data.category = input.category ? String(input.category).trim() : null;
  if (input.classId !== undefined) data.classId = String(input.classId);
  if (input.coverImageUrl !== undefined)
    data.coverImageUrl = input.coverImageUrl ? String(input.coverImageUrl).trim() : null;
  if (input.enrollmentOpen !== undefined) data.enrollmentOpen = !!input.enrollmentOpen;
  if (input.status !== undefined) {
    const s = String(input.status).toUpperCase();
    if (!COURSE_STATUSES.includes(s as CourseStatus)) {
      throw new BadRequestException(
        `status must be one of ${COURSE_STATUSES.join(', ')}`,
      );
    }
    data.status = s;
  }
  const sd = toDate(input.startDate);
  if (sd !== undefined) data.startDate = sd;
  const ed = toDate(input.endDate);
  if (ed !== undefined) data.endDate = ed;
  return data;
}

function sanitizeLessonInput(input: LessonInput) {
  const data: any = {};
  if (input.title !== undefined) data.title = String(input.title).trim();
  if (input.description !== undefined)
    data.description = input.description ? String(input.description).trim() : null;
  if (input.order !== undefined) data.order = Math.max(0, Number(input.order) || 0);
  if (input.status !== undefined) {
    const s = String(input.status).toUpperCase();
    if (!LESSON_STATUSES.includes(s as any)) {
      throw new BadRequestException(
        `Lesson status must be one of ${LESSON_STATUSES.join(', ')}`,
      );
    }
    data.status = s;
  }
  if (input.gradingMode !== undefined) {
    const g = String(input.gradingMode).toUpperCase();
    if (!LESSON_GRADING_MODES.includes(g as any)) {
      throw new BadRequestException(
        `gradingMode must be one of ${LESSON_GRADING_MODES.join(', ')}`,
      );
    }
    data.gradingMode = g;
  }
  if (input.availableFrom !== undefined) data.availableFrom = toDate(input.availableFrom);
  if (input.availableUntil !== undefined) data.availableUntil = toDate(input.availableUntil);
  if (input.showProgressBar !== undefined)
    data.showProgressBar = !!input.showProgressBar;
  if (input.branchingEnabled !== undefined)
    data.branchingEnabled = !!input.branchingEnabled;
  if (input.totalPoints !== undefined)
    data.totalPoints = Math.max(0, Number(input.totalPoints) || 0);
  if (input.passingScore !== undefined) {
    if (input.passingScore === null) data.passingScore = null;
    else data.passingScore = Math.max(0, Number(input.passingScore) || 0);
  }
  if (input.requireVideoWatch !== undefined)
    data.requireVideoWatch = !!input.requireVideoWatch;
  if (input.videoWatchPct !== undefined) {
    const pct = Math.max(1, Math.min(100, Number(input.videoWatchPct) || 90));
    data.videoWatchPct = Math.round(pct);
  }
  if (input.maxAttempts !== undefined) {
    data.maxAttempts = Math.max(0, Math.round(Number(input.maxAttempts) || 0));
  }
  return data;
}

function sanitizePageInput(input: PageInput) {
  const data: any = {};
  if (input.title !== undefined) data.title = String(input.title).trim();
  if (input.pageType !== undefined) {
    const t = String(input.pageType).toUpperCase();
    if (!PAGE_TYPES.includes(t as any)) {
      throw new BadRequestException(
        `pageType must be one of ${PAGE_TYPES.join(', ')}`,
      );
    }
    data.pageType = t;
  }
  if (input.content !== undefined) data.content = input.content ?? {};
  if (input.order !== undefined) data.order = Math.max(0, Number(input.order) || 0);
  if (input.nextPageId !== undefined)
    data.nextPageId = input.nextPageId ? String(input.nextPageId) : null;
  return data;
}

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService, private readonly directory: DirectoryService) {}

  // ──────────────────────────────────────────────────────────────────────
  //  Authorisation helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Ensures the teacher owns the class, or the user is admin. */
  private async assertCanManageCourse(
    courseId: string,
    userId: string,
    role: string,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { class: { select: { teacherId: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (this.isAdmin(role)) return course;
    if (course.createdById === userId) return course;
    if (course.class?.teacherId === userId) return course;
    throw new ForbiddenException('You do not have access to this course');
  }

  private isAdmin(role?: string) {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Course CRUD
  // ──────────────────────────────────────────────────────────────────────

  async list(opts: {
    teacherUserId?: string;
    role?: string;
    classId?: string;
    status?: string;
  }) {
    const where: any = {};
    if (opts.classId) where.classId = opts.classId;
    if (opts.status) where.status = String(opts.status).toUpperCase();

    // Scope to teacher's own classes unless admin
    if (!this.isAdmin(opts.role) && opts.teacherUserId) {
      const classes = await this.prisma.class.findMany({
        where: { teacherId: opts.teacherUserId },
        select: { id: true },
      });
      const myClassIds = classes.map((c) => c.id);
      where.OR = [
        { createdById: opts.teacherUserId },
        { classId: { in: myClassIds } },
      ];
    }

    return this.prisma.course.findMany({
      where,
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { lessons: true, enrollments: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async getOne(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        lessons: {
          orderBy: { order: 'asc' },
          include: { _count: { select: { pages: true } } },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  // ── 1. Draft State: create a course (status defaults to DRAFT) ─────────
  async create(body: CourseInput, createdById: string) {
    if (!body.title?.trim()) throw new BadRequestException('Title is required');
    if (!body.classId) throw new BadRequestException('classId is required');
    const data = sanitizeCourseInput(body);
    // Force DRAFT on create — explicit transitions handle the rest.
    data.status = 'DRAFT';
    return this.prisma.course.create({
      data: { ...data, createdById },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        _count: { select: { lessons: true, enrollments: true } },
      },
    });
  }

  async update(id: string, body: CourseInput, userId: string, role: string) {
    await this.assertCanManageCourse(id, userId, role);
    const data = sanitizeCourseInput(body);
    // Ignore status changes via update() — use transition() instead.
    delete data.status;
    return this.prisma.course.update({
      where: { id },
      data,
      include: {
        class: { select: { id: true, name: true, subject: true } },
        _count: { select: { lessons: true, enrollments: true } },
      },
    });
  }

  async remove(id: string, userId: string, role: string) {
    await this.assertCanManageCourse(id, userId, role);
    return this.prisma.course.delete({ where: { id } });
  }

  // ── State transition orchestrator ──────────────────────────────────────
  async transition(
    id: string,
    nextStatus: string,
    userId: string,
    role: string,
  ) {
    const course = await this.assertCanManageCourse(id, userId, role);
    const next = String(nextStatus || '').toUpperCase() as CourseStatus;
    if (!COURSE_STATUSES.includes(next)) {
      throw new BadRequestException(
        `status must be one of ${COURSE_STATUSES.join(', ')}`,
      );
    }
    const current = course.status as CourseStatus;
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    if (current === next) return course;
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot transition from ${current} to ${next}. Allowed: ${
          allowed.join(', ') || '(none)'
        }`,
      );
    }
    const data: any = { status: next };
    const now = new Date();
    if (next === 'PUBLISHED') {
      data.publishedAt = course.publishedAt ?? now;
    }
    if (next === 'ENROLLMENT') {
      data.enrollmentOpen = true;
    }
    if (next === 'ACTIVE') {
      // Close enrollment when the course actually starts
      data.enrollmentOpen = false;
      if (!course.startDate) data.startDate = now;
    }
    if (next === 'COMPLETED') {
      data.completedAt = now;
      data.enrollmentOpen = false;
      if (!course.endDate) data.endDate = now;
    }
    if (next === 'ARCHIVED') {
      data.archivedAt = now;
      data.enrollmentOpen = false;
    }
    const updated = await this.prisma.course.update({
      where: { id },
      data,
      include: {
        class: { select: { id: true, name: true, subject: true } },
        _count: { select: { lessons: true, enrollments: true } },
      },
    });

    if (next === 'PUBLISHED') {
      await this.notifyStudentsCoursePublished(updated.id);
    }
    if (next === 'ENROLLMENT') {
      await this.autoEnrollClassStudents(updated.id, updated.classId);
    }
    return updated;
  }

  private async notifyStudentsCoursePublished(courseId: string) {
    try {
      const c = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { title: true, classId: true, class: { select: { name: true } } },
      });
      if (!c) return;
      const students = await this.prisma.student.findMany({
        where: { classId: c.classId },
        select: { userId: true },
      });
      if (!students.length) return;
      await this.prisma.notification.createMany({
        data: students.map((s) => ({
          userId: s.userId,
          type: 'course_published',
          message: `New course available: "${c.title}" in ${c.class?.name ?? 'your class'}`,
        })),
      });
    } catch {
      /* best-effort */
    }
  }

  // ── 3. Enrollment State ───────────────────────────────────────────────
  private async autoEnrollClassStudents(courseId: string, classId: string) {
    const students = await this.prisma.student.findMany({
      where: { classId },
      select: { id: true },
    });
    if (!students.length) return;
    // Use individual upserts to respect the unique([courseId, studentId]) index.
    await this.prisma.$transaction(
      students.map((s) =>
        this.prisma.courseEnrollment.upsert({
          where: { courseId_studentId: { courseId, studentId: s.id } },
          create: { courseId, studentId: s.id, status: 'ENROLLED' },
          update: {},
        }),
      ),
    );
  }

  async enrollStudent(
    courseId: string,
    studentId: string,
    userId: string,
    role: string,
  ) {
    const course = await this.assertCanManageCourse(courseId, userId, role);
    if (!course.enrollmentOpen && course.status !== 'ENROLLMENT') {
      throw new ForbiddenException('Course is not open for enrollment');
    }
    return this.prisma.courseEnrollment.upsert({
      where: { courseId_studentId: { courseId, studentId } },
      create: { courseId, studentId, status: 'ENROLLED' },
      update: {},
    });
  }

  async listEnrollments(courseId: string, userId: string, role: string) {
    await this.assertCanManageCourse(courseId, userId, role);
    return this.prisma.courseEnrollment.findMany({
      where: { courseId },
      include: {
        student: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { enrolledAt: 'asc' },
    });
  }

  async unenrollStudent(
    courseId: string,
    studentId: string,
    userId: string,
    role: string,
  ) {
    await this.assertCanManageCourse(courseId, userId, role);
    return this.prisma.courseEnrollment.deleteMany({
      where: { courseId, studentId },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lessons (CRUD)
  // ──────────────────────────────────────────────────────────────────────

  async listLessons(courseId: string) {
    return this.prisma.courseLesson.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { pages: true } } },
    });
  }

  async createLesson(
    courseId: string,
    body: LessonInput,
    userId: string,
    role: string,
  ) {
    const course = await this.assertCanManageCourse(courseId, userId, role);
    if (course.status === 'ARCHIVED' || course.status === 'COMPLETED') {
      throw new ForbiddenException(
        'Cannot add lessons to a completed or archived course',
      );
    }
    if (!body.title?.trim()) throw new BadRequestException('Lesson title is required');
    const data = sanitizeLessonInput(body);
    data.status = data.status || 'DRAFT';
    if (data.order === undefined) {
      const last = await this.prisma.courseLesson.findFirst({
        where: { courseId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      data.order = (last?.order ?? -1) + 1;
    }
    return this.prisma.courseLesson.create({
      data: { ...data, courseId },
      include: { _count: { select: { pages: true } } },
    });
  }

  async updateLesson(
    lessonId: string,
    body: LessonInput,
    userId: string,
    role: string,
  ) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true, status: true, publishedAt: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertCanManageCourse(lesson.courseId, userId, role);

    const data = sanitizeLessonInput(body);
    if (
      data.status === 'PUBLISHED' &&
      lesson.status !== 'PUBLISHED' &&
      !lesson.publishedAt
    ) {
      data.publishedAt = new Date();
    }
    return this.prisma.courseLesson.update({
      where: { id: lessonId },
      data,
      include: { _count: { select: { pages: true } } },
    });
  }

  async deleteLesson(lessonId: string, userId: string, role: string) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertCanManageCourse(lesson.courseId, userId, role);
    return this.prisma.courseLesson.delete({ where: { id: lessonId } });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lesson Pages (CRUD)
  // ──────────────────────────────────────────────────────────────────────

  async listPages(lessonId: string) {
    return this.prisma.lessonPage.findMany({
      where: { lessonId },
      orderBy: { order: 'asc' },
    });
  }

  async createPage(
    lessonId: string,
    body: PageInput,
    userId: string,
    role: string,
  ) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertCanManageCourse(lesson.courseId, userId, role);

    if (!body.title?.trim()) throw new BadRequestException('Page title is required');
    const data = sanitizePageInput(body);
    data.pageType = data.pageType || 'CONTENT';
    data.content = validatePageContent(data.pageType, data.content ?? body.content ?? {});
    if (data.order === undefined) {
      const last = await this.prisma.lessonPage.findFirst({
        where: { lessonId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      data.order = (last?.order ?? -1) + 1;
    }
    return this.prisma.lessonPage.create({ data: { ...data, lessonId } });
  }

  async updatePage(
    pageId: string,
    body: PageInput,
    userId: string,
    role: string,
  ) {
    const page = await this.prisma.lessonPage.findUnique({
      where: { id: pageId },
      include: { lesson: { select: { courseId: true } } },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertCanManageCourse(page.lesson.courseId, userId, role);
    const data = sanitizePageInput(body);
    if (data.content !== undefined || data.pageType !== undefined) {
      const nextType = data.pageType || page.pageType;
      const nextContent = data.content !== undefined ? data.content : page.content;
      data.content = validatePageContent(nextType, nextContent);
    }
    return this.prisma.lessonPage.update({ where: { id: pageId }, data });
  }

  async deletePage(pageId: string, userId: string, role: string) {
    const page = await this.prisma.lessonPage.findUnique({
      where: { id: pageId },
      include: { lesson: { select: { courseId: true } } },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertCanManageCourse(page.lesson.courseId, userId, role);
    return this.prisma.lessonPage.delete({ where: { id: pageId } });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Student-side
  // ──────────────────────────────────────────────────────────────────────

  async getStudentCourses(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return [];

    const classIds = await this.directory.classesForUser(userId, 'STUDENT');
    const publishedClassScope = classIds.length
      ? {
          classId: { in: classIds },
          status: { in: ['PUBLISHED', 'ENROLLMENT', 'ACTIVE', 'COMPLETED'] },
        }
      : null;

    // Visible to a student: any course in their class that's at least PUBLISHED,
    // plus any course they're already enrolled in.
    return this.prisma.course.findMany({
      where: {
        OR: [
          ...(publishedClassScope ? [publishedClassScope] : []),
          { enrollments: { some: { studentId: student.id } } },
        ],
      },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        enrollments: { where: { studentId: student.id }, take: 1 },
        _count: { select: { lessons: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lesson attempts (student player)
  // ──────────────────────────────────────────────────────────────────────

  private async getStudentByUserId(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true, classId: true },
    });
    if (!student) throw new ForbiddenException('Student profile required');
    return student;
  }

  private async assertLessonVisibleToStudent(
    lessonId: string,
    student: { id: string; classId: string | null },
  ) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      include: {
        course: {
          select: {
            id: true,
            classId: true,
            status: true,
            enrollments: {
              where: { studentId: student.id },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (lesson.status !== 'PUBLISHED') {
      throw new ForbiddenException('Lesson is not published');
    }
    const sameClass = lesson.course.classId === student.classId;
    const enrolled = lesson.course.enrollments.length > 0;
    const visibleStatus = ['PUBLISHED', 'ENROLLMENT', 'ACTIVE', 'COMPLETED'].includes(
      lesson.course.status,
    );
    if (!enrolled && !(sameClass && visibleStatus)) {
      throw new ForbiddenException('You do not have access to this lesson');
    }
    return lesson;
  }

  /** Start a new attempt or return the in-progress one. */
  async startLessonAttempt(lessonId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    const lesson = await this.assertLessonVisibleToStudent(lessonId, student);

    const existing = await this.prisma.lessonAttempt.findFirst({
      where: { lessonId, studentId: student.id, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) return existing;

    const maxAttempts = (lesson as any).maxAttempts ?? 0;
    if (maxAttempts > 0) {
      // A teacher's reset (see resetLessonAttempt) marks the voided attempt
      // ABANDONED specifically so it doesn't count against this cap.
      const takenCount = await this.prisma.lessonAttempt.count({
        where: { lessonId, studentId: student.id, status: { not: 'ABANDONED' } },
      });
      if (takenCount >= maxAttempts) {
        throw new ForbiddenException(`Maximum attempts (${maxAttempts}) reached for this lesson`);
      }
    }

    const pages = await this.prisma.lessonPage.findMany({
      where: { lessonId },
      orderBy: { order: 'asc' },
      select: { id: true, pageType: true, content: true },
    });
    const maxScore = computeLessonMaxScore(pages as any);
    const firstPage = pages[0];

    const attempt = await this.prisma.lessonAttempt.create({
      data: {
        lessonId,
        studentId: student.id,
        status: 'IN_PROGRESS',
        currentPageId: firstPage?.id ?? null,
        score: 0,
        maxScore,
      },
    });
    // Auto-mark attendance for any sessions linked to this lesson
    await this.autoMarkAttendanceForLesson(lessonId, student.id);
    return attempt;
  }

  /** If any CourseSession is tied to this lesson, mark this student PRESENT. */
  private async autoMarkAttendanceForLesson(lessonId: string, studentId: string) {
    const sessions = await this.prisma.courseSession.findMany({
      where: { lessonId },
      select: { id: true },
    });
    if (sessions.length === 0) return;
    const now = new Date();
    for (const s of sessions) {
      const existing = await this.prisma.courseAttendance.findUnique({
        where: { sessionId_studentId: { sessionId: s.id, studentId } },
        select: { id: true, source: true, status: true },
      });
      // Skip if a teacher already marked manually (don't override)
      if (existing && existing.source === 'MANUAL') continue;
      if (existing) {
        await this.prisma.courseAttendance.update({
          where: { id: existing.id },
          data: { status: 'PRESENT', source: 'AUTO_LESSON', checkInTime: now },
        });
      } else {
        await this.prisma.courseAttendance.create({
          data: {
            sessionId: s.id,
            studentId,
            status: 'PRESENT',
            source: 'AUTO_LESSON',
            checkInTime: now,
          },
        });
      }
    }
  }

  /** Get the latest attempt (in-progress preferred) for the current student. */
  async getMyLessonAttempt(lessonId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    await this.assertLessonVisibleToStudent(lessonId, student);
    return this.prisma.lessonAttempt.findFirst({
      where: { lessonId, studentId: student.id },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      include: { responses: true },
    });
  }

  /** Submit an answer for a page within an attempt. Returns grading + next page. */
  async submitPageResponse(
    attemptId: string,
    pageId: string,
    answer: SubmittedAnswer,
    userId: string,
  ) {
    const student = await this.getStudentByUserId(userId);
    const attempt = await this.prisma.lessonAttempt.findUnique({
      where: { id: attemptId },
      include: { lesson: { select: { id: true, gradingMode: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.studentId !== student.id) {
      throw new ForbiddenException('Not your attempt');
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt is no longer active');
    }

    const page = await this.prisma.lessonPage.findUnique({
      where: { id: pageId },
    });
    if (!page || page.lessonId !== attempt.lessonId) {
      throw new NotFoundException('Page not in this lesson');
    }

    let correct: boolean | null = null;
    let pointsAwarded: number | null = 0;
    if (page.pageType === 'QUESTION') {
      const grading = gradeQuestion(page.content as unknown as QuestionPagePayload, answer);
      correct = grading.correct;
      pointsAwarded = grading.pointsAwarded;
    }

    const allPages = await this.prisma.lessonPage.findMany({
      where: { lessonId: attempt.lessonId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    });
    const nextPageId = resolveNextPageId(page as any, allPages, answer);

    // Upsert so retrying the same page replaces the prior answer.
    const prior = await this.prisma.pageResponse.findUnique({
      where: { attemptId_pageId: { attemptId, pageId } },
    });
    await this.prisma.pageResponse.upsert({
      where: { attemptId_pageId: { attemptId, pageId } },
      create: {
        attemptId,
        pageId,
        answer: answer as any,
        correct,
        pointsAwarded,
        nextPageId,
      },
      update: {
        answer: answer as any,
        correct,
        pointsAwarded,
        nextPageId,
        answeredAt: new Date(),
      },
    });

    const scoreDelta = (pointsAwarded ?? 0) - (prior?.pointsAwarded ?? 0);
    await this.prisma.lessonAttempt.update({
      where: { id: attemptId },
      data: {
        score: { increment: scoreDelta },
        currentPageId: nextPageId,
      },
    });

    return {
      correct,
      pointsAwarded,
      nextPageId,
      done: nextPageId === null,
    };
  }

  /** Finalize an attempt: compute pass/fail, update enrollment progress. */
  async finishLessonAttempt(attemptId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    const attempt = await this.prisma.lessonAttempt.findUnique({
      where: { id: attemptId },
      include: {
        lesson: {
          select: {
            id: true,
            passingScore: true,
            gradingMode: true,
            courseId: true,
            requireVideoWatch: true,
            videoWatchPct: true,
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.studentId !== student.id) {
      throw new ForbiddenException('Not your attempt');
    }
    if (attempt.status === 'COMPLETED') return attempt;

    // Video-watch gate
    if (attempt.lesson.requireVideoWatch) {
      const view = await this.prisma.lessonView.findUnique({
        where: {
          lessonId_studentId: {
            lessonId: attempt.lesson.id,
            studentId: student.id,
          },
        },
      });
      const need = attempt.lesson.videoWatchPct ?? 90;
      const dur = view?.videoDurationSec ?? 0;
      const watched = view?.watchedSeconds ?? 0;
      const pct = dur > 0 ? Math.round((watched / dur) * 100) : 0;
      if (!view || dur === 0 || pct < need) {
        throw new BadRequestException(
          `You must watch at least ${need}% of the video before finishing this lesson (current: ${pct}%).`,
        );
      }
    }

    // Essay (and any future manually-graded H5P type) leaves its PageResponse
    // with pointsAwarded: null until a teacher grades it — hold the attempt
    // open rather than finalizing pass/fail on an incomplete score.
    const pendingCount = await this.prisma.pageResponse.count({
      where: { attemptId, pointsAwarded: null },
    });

    if (pendingCount > 0) {
      return this.prisma.lessonAttempt.update({
        where: { id: attemptId },
        data: { status: 'AWAITING_GRADE', completedAt: new Date() },
      });
    }

    const passing = attempt.lesson.passingScore;
    const passed =
      attempt.lesson.gradingMode === 'UNGRADED'
        ? null
        : passing != null
          ? attempt.score >= passing
          : attempt.maxScore === 0
            ? true
            : attempt.score >= attempt.maxScore / 2;

    const finished = await this.prisma.lessonAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'COMPLETED',
        passed,
        completedAt: new Date(),
      },
    });

    await this.recomputeEnrollmentProgress(
      attempt.lesson.courseId,
      student.id,
    );

    return finished;
  }

  // ── Manual grading (Essay / H5P questions pending review) ────────────

  /** Teacher/Admin: list attempts awaiting manual grading for a lesson, with
   * only the still-pending responses included (already-graded ones omitted). */
  async listPendingGrading(lessonId: string, userId: string, role: string) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertCanManageCourse(lesson.courseId, userId, role);

    const attempts = await this.prisma.lessonAttempt.findMany({
      where: { lessonId, status: 'AWAITING_GRADE' },
      include: {
        responses: {
          where: { pointsAwarded: null },
          include: { page: { select: { id: true, title: true, content: true } } },
        },
      },
      orderBy: { completedAt: 'desc' },
    });
    // LessonAttempt has no `student` relation (only a scalar studentId) — join manually.
    const studentIds = [...new Set(attempts.map((a) => a.studentId))];
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      include: { user: { select: { name: true } } },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));
    return attempts.map((a) => ({ ...a, student: studentById.get(a.studentId) ?? null }));
  }

  /** Teacher/Admin: void an attempt so it no longer counts. Course lessons can
   * already be freely retaken once an attempt is COMPLETED — this exists for
   * the cases that would otherwise stay stuck: an IN_PROGRESS attempt (the
   * player always resumes it, so a stuck one blocks a fresh start) and an
   * AWAITING_GRADE one the teacher would rather void than grade. */
  async resetLessonAttempt(attemptId: string, userId: string, role: string) {
    const attempt = await this.prisma.lessonAttempt.findUnique({
      where: { id: attemptId },
      include: { lesson: { select: { courseId: true, title: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    await this.assertCanManageCourse(attempt.lesson.courseId, userId, role);

    const updated = await this.prisma.lessonAttempt.update({
      where: { id: attemptId },
      data: { status: 'ABANDONED' },
    });

    try {
      const student = await this.prisma.student.findUnique({
        where: { id: attempt.studentId },
        select: { userId: true },
      });
      if (student) {
        await this.prisma.notification.create({
          data: {
            userId: student.userId,
            type: 'lesson_attempt_reset',
            message: `Your attempt on "${attempt.lesson.title}" was reset — you can start it again.`,
          },
        });
      }
    } catch {}

    return updated;
  }

  /** Teacher/Admin: grade a single pending PageResponse (Essay). Recomputes the
   * attempt's total score, and finalizes it (COMPLETED + pass/fail) once no
   * pending responses remain. */
  async gradePageResponse(
    responseId: string,
    pointsAwarded: number,
    userId: string,
    role: string,
  ) {
    const resp = await this.prisma.pageResponse.findUnique({
      where: { id: responseId },
      include: {
        page: { select: { content: true } },
        attempt: {
          include: {
            lesson: {
              select: { courseId: true, passingScore: true, gradingMode: true },
            },
          },
        },
      },
    });
    if (!resp) throw new NotFoundException('Response not found');
    await this.assertCanManageCourse(resp.attempt.lesson.courseId, userId, role);

    const content = resp.page.content as unknown as QuestionPagePayload;
    const maxPoints = Math.max(0, Number(content.points) || 1);
    const clamped = Math.max(0, Math.min(maxPoints, Number(pointsAwarded) || 0));

    await this.prisma.pageResponse.update({
      where: { id: responseId },
      data: { pointsAwarded: clamped },
    });

    const allResponses = await this.prisma.pageResponse.findMany({
      where: { attemptId: resp.attemptId },
    });
    const anyPending = allResponses.some((r) => r.pointsAwarded == null);
    const total = allResponses.reduce((sum, r) => sum + (r.pointsAwarded ?? 0), 0);

    let passed = resp.attempt.passed;
    let status = resp.attempt.status;
    if (!anyPending) {
      const passing = resp.attempt.lesson.passingScore;
      passed =
        resp.attempt.lesson.gradingMode === 'UNGRADED'
          ? null
          : passing != null
            ? total >= passing
            : resp.attempt.maxScore === 0
              ? true
              : total >= resp.attempt.maxScore / 2;
      status = 'COMPLETED';
    }

    const updatedAttempt = await this.prisma.lessonAttempt.update({
      where: { id: resp.attemptId },
      data: { score: total, passed, status },
    });

    if (!anyPending) {
      await this.recomputeEnrollmentProgress(
        resp.attempt.lesson.courseId,
        resp.attempt.studentId,
      );
    }

    return updatedAttempt;
  }

  /** Recompute progressPct = completed lessons / published lessons * 100. */
  private async recomputeEnrollmentProgress(
    courseId: string,
    studentId: string,
  ) {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId } },
    });
    if (!enrollment) return;

    const publishedLessons = await this.prisma.courseLesson.findMany({
      where: { courseId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (publishedLessons.length === 0) return;
    const lessonIds = publishedLessons.map((l) => l.id);

    const completed = await this.prisma.lessonAttempt.findMany({
      where: {
        studentId,
        status: 'COMPLETED',
        lessonId: { in: lessonIds },
      },
      select: { lessonId: true },
      distinct: ['lessonId'],
    });

    const pct = Math.round(
      (completed.length / publishedLessons.length) * 1000,
    ) / 10;

    await this.prisma.courseEnrollment.update({
      where: { courseId_studentId: { courseId, studentId } },
      data: {
        progressPct: pct,
        status: pct >= 100 ? 'COMPLETED' : 'ACTIVE',
        completedAt: pct >= 100 ? new Date() : null,
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Course attendance (sessions + per-student records)
  // ──────────────────────────────────────────────────────────────────────

  /** Visible to teacher/admin (manage view) and enrolled student (read-only). */
  private async assertCourseVisible(courseId: string, userId: string, role: string) {
    if (this.isAdmin(role) || role === 'TEACHER') {
      return this.assertCanManageCourse(courseId, userId, role);
    }
    // Student: must be enrolled (or in the course's class)
    const student = await this.getStudentByUserId(userId);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        classId: true,
        status: true,
        enrollments: { where: { studentId: student.id }, select: { id: true } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    const sameClass = course.classId === student.classId;
    const enrolled = course.enrollments.length > 0;
    if (!enrolled && !sameClass) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
    return { student, course };
  }

  async listSessions(courseId: string, userId: string, role: string) {
    await this.assertCourseVisible(courseId, userId, role);
    return this.prisma.courseSession.findMany({
      where: { courseId },
      orderBy: { scheduledAt: 'asc' },
      include: {
        lesson: { select: { id: true, title: true } },
        _count: { select: { attendances: true } },
      },
    });
  }

  async createSession(
    courseId: string,
    body: {
      title: string;
      scheduledAt: string | Date;
      durationMinutes?: number;
      location?: string;
      lessonId?: string | null;
      checkInCode?: string | null;
    },
    userId: string,
    role: string,
  ) {
    await this.assertCanManageCourse(courseId, userId, role);
    if (!body?.title || !body.scheduledAt) {
      throw new BadRequestException('title and scheduledAt are required');
    }
    if (body.lessonId) {
      const lesson = await this.prisma.courseLesson.findUnique({
        where: { id: body.lessonId },
        select: { courseId: true },
      });
      if (!lesson || lesson.courseId !== courseId) {
        throw new BadRequestException('lessonId does not belong to this course');
      }
    }
    return this.prisma.courseSession.create({
      data: {
        courseId,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        durationMinutes: body.durationMinutes ?? 60,
        location: body.location ?? null,
        lessonId: body.lessonId ?? null,
        checkInCode: body.checkInCode?.trim() || null,
      },
    });
  }

  async updateSession(
    sessionId: string,
    body: any,
    userId: string,
    role: string,
  ) {
    const s = await this.prisma.courseSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!s) throw new NotFoundException('Session not found');
    await this.assertCanManageCourse(s.courseId, userId, role);
    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt);
    if (body.durationMinutes !== undefined) data.durationMinutes = body.durationMinutes;
    if (body.location !== undefined) data.location = body.location;
    if (body.lessonId !== undefined) data.lessonId = body.lessonId || null;
    if (body.checkInCode !== undefined)
      data.checkInCode = body.checkInCode?.trim() || null;
    return this.prisma.courseSession.update({ where: { id: sessionId }, data });
  }

  async deleteSession(sessionId: string, userId: string, role: string) {
    const s = await this.prisma.courseSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!s) throw new NotFoundException('Session not found');
    await this.assertCanManageCourse(s.courseId, userId, role);
    return this.prisma.courseSession.delete({ where: { id: sessionId } });
  }

  /** Teacher view: enrolled students + their attendance row (if any). */
  async getSessionRoster(sessionId: string, userId: string, role: string) {
    const session = await this.prisma.courseSession.findUnique({
      where: { id: sessionId },
      include: { lesson: { select: { id: true, title: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.assertCanManageCourse(session.courseId, userId, role);
    const enrollments = await this.prisma.courseEnrollment.findMany({
      where: { courseId: session.courseId },
      include: {
        student: {
          select: {
            id: true,
            studentNumber: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    const records = await this.prisma.courseAttendance.findMany({
      where: { sessionId },
    });
    const recordByStudent = new Map(records.map((r) => [r.studentId, r]));
    const roster = enrollments.map((e) => ({
      studentId: e.studentId,
      studentNumber: e.student.studentNumber,
      name: e.student.user.name,
      email: e.student.user.email,
      attendance: recordByStudent.get(e.studentId) ?? null,
    }));
    return { session, roster };
  }

  /** Teacher mark attendance (create or update). */
  async markAttendance(
    sessionId: string,
    body: { studentId: string; status: string; notes?: string },
    userId: string,
    role: string,
  ) {
    const session = await this.prisma.courseSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.assertCanManageCourse(session.courseId, userId, role);
    if (!body?.studentId || !body?.status) {
      throw new BadRequestException('studentId and status are required');
    }
    const status = String(body.status).toUpperCase();
    if (!['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    return this.prisma.courseAttendance.upsert({
      where: { sessionId_studentId: { sessionId, studentId: body.studentId } },
      create: {
        sessionId,
        studentId: body.studentId,
        status,
        source: 'MANUAL',
        notes: body.notes ?? null,
        markedById: userId,
        checkInTime: status === 'PRESENT' || status === 'LATE' ? new Date() : null,
      },
      update: {
        status,
        source: 'MANUAL',
        notes: body.notes ?? null,
        markedById: userId,
      },
    });
  }

  /** Student self check-in by code. */
  async studentCheckIn(sessionId: string, code: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    const session = await this.prisma.courseSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        courseId: true,
        checkInCode: true,
        scheduledAt: true,
        durationMinutes: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.checkInCode) {
      throw new BadRequestException('Check-in code not enabled for this session');
    }
    if (
      !code ||
      String(code).trim().toUpperCase() !== session.checkInCode.toUpperCase()
    ) {
      throw new BadRequestException('Invalid check-in code');
    }
    // Ensure student is enrolled
    const enrolled = await this.prisma.courseEnrollment.findUnique({
      where: {
        courseId_studentId: { courseId: session.courseId, studentId: student.id },
      },
    });
    if (!enrolled) throw new ForbiddenException('You are not enrolled in this course');

    const now = new Date();
    // Mark LATE if past start; otherwise PRESENT
    const startedAt = session.scheduledAt;
    const isLate = now.getTime() > startedAt.getTime() + 5 * 60_000; // 5 min grace
    const status = isLate ? 'LATE' : 'PRESENT';
    return this.prisma.courseAttendance.upsert({
      where: { sessionId_studentId: { sessionId, studentId: student.id } },
      create: {
        sessionId,
        studentId: student.id,
        status,
        source: 'CODE',
        checkInTime: now,
      },
      update: {
        // Don't downgrade an already-PRESENT manual mark
        status,
        source: 'CODE',
        checkInTime: now,
      },
    });
  }

  /** Student: own attendance across all sessions of a course. */
  async getMyCourseAttendance(courseId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    // make sure they can see it
    await this.assertCourseVisible(courseId, userId, 'STUDENT');
    const sessions = await this.prisma.courseSession.findMany({
      where: { courseId },
      orderBy: { scheduledAt: 'asc' },
      include: {
        lesson: { select: { id: true, title: true } },
        attendances: { where: { studentId: student.id } },
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      scheduledAt: s.scheduledAt,
      durationMinutes: s.durationMinutes,
      location: s.location,
      lesson: s.lesson,
      hasCheckInCode: !!s.checkInCode,
      attendance: s.attendances[0] ?? null,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lesson access tracking (views + video watch progress)
  // ──────────────────────────────────────────────────────────────────────

  /** Called when a student opens a lesson. Upserts the LessonView row. */
  async recordLessonOpen(lessonId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    await this.assertLessonVisibleToStudent(lessonId, student);
    const now = new Date();
    return this.prisma.lessonView.upsert({
      where: { lessonId_studentId: { lessonId, studentId: student.id } },
      create: {
        lessonId,
        studentId: student.id,
        firstOpenedAt: now,
        lastOpenedAt: now,
        openCount: 1,
      },
      update: {
        lastOpenedAt: now,
        openCount: { increment: 1 },
      },
    });
  }

  /** Heartbeat from the video player. Stores max watched seconds + duration. */
  async updateLessonVideoProgress(
    lessonId: string,
    body: { watchedSeconds?: number; videoDurationSec?: number },
    userId: string,
  ) {
    const student = await this.getStudentByUserId(userId);
    await this.assertLessonVisibleToStudent(lessonId, student);
    const watchedSeconds = Math.max(0, Math.floor(Number(body.watchedSeconds) || 0));
    const videoDurationSec =
      body.videoDurationSec != null
        ? Math.max(0, Math.floor(Number(body.videoDurationSec)))
        : null;
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      select: { videoWatchPct: true },
    });
    const view = await this.prisma.lessonView.upsert({
      where: { lessonId_studentId: { lessonId, studentId: student.id } },
      create: {
        lessonId,
        studentId: student.id,
        watchedSeconds,
        videoDurationSec,
      },
      update: {},
    });
    const newWatched = Math.max(view.watchedSeconds, watchedSeconds);
    const newDur = videoDurationSec ?? view.videoDurationSec ?? null;
    const needPct = lesson?.videoWatchPct ?? 90;
    const completed =
      newDur && newDur > 0
        ? Math.round((newWatched / newDur) * 100) >= needPct
        : false;
    return this.prisma.lessonView.update({
      where: { id: view.id },
      data: {
        watchedSeconds: newWatched,
        videoDurationSec: newDur,
        videoCompleted: completed,
        completedAt: completed && !view.videoCompleted ? new Date() : view.completedAt,
      },
    });
  }

  /** Student view of their own lesson view record. */
  async getMyLessonView(lessonId: string, userId: string) {
    const student = await this.getStudentByUserId(userId);
    await this.assertLessonVisibleToStudent(lessonId, student);
    return this.prisma.lessonView.findUnique({
      where: { lessonId_studentId: { lessonId, studentId: student.id } },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Bulk: create one CourseSession per published lesson
  // ──────────────────────────────────────────────────────────────────────

  async generateSessionsFromLessons(
    courseId: string,
    userId: string,
    role: string,
  ) {
    const course = await this.assertCanManageCourse(courseId, userId, role);
    const lessons = await this.prisma.courseLesson.findMany({
      where: { courseId, status: 'PUBLISHED' },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, publishedAt: true, order: true },
    });
    if (lessons.length === 0) {
      throw new BadRequestException('No published lessons to generate sessions for');
    }
    const existing = await this.prisma.courseSession.findMany({
      where: { courseId, lessonId: { in: lessons.map((l) => l.id) } },
      select: { lessonId: true },
    });
    const taken = new Set(existing.map((e) => e.lessonId));
    const baseDate = course.startDate ?? new Date();
    const toCreate = lessons.filter((l) => !taken.has(l.id));
    let created = 0;
    for (const l of toCreate) {
      const scheduledAt =
        l.publishedAt ??
        new Date(baseDate.getTime() + l.order * 7 * 24 * 60 * 60 * 1000);
      await this.prisma.courseSession.create({
        data: {
          courseId,
          lessonId: l.id,
          title: l.title,
          scheduledAt,
          durationMinutes: 60,
        },
      });
      created++;
    }
    return { created, skipped: lessons.length - toCreate.length };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Engagement / lesson-attendance report (teacher view)
  // ──────────────────────────────────────────────────────────────────────

  async getEngagementReport(courseId: string, userId: string, role: string) {
    await this.assertCanManageCourse(courseId, userId, role);
    const [lessons, enrollments, views, attempts, sessions, attendance] =
      await Promise.all([
        this.prisma.courseLesson.findMany({
          where: { courseId, status: 'PUBLISHED' },
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            requireVideoWatch: true,
            videoWatchPct: true,
          },
        }),
        this.prisma.courseEnrollment.findMany({
          where: { courseId },
          include: {
            student: {
              select: {
                id: true,
                studentNumber: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        }),
        this.prisma.lessonView.findMany({
          where: { lesson: { courseId } },
        }),
        this.prisma.lessonAttempt.findMany({
          where: { lesson: { courseId } },
          select: {
            id: true,
            lessonId: true,
            studentId: true,
            status: true,
            score: true,
            maxScore: true,
            passed: true,
          },
        }),
        this.prisma.courseSession.findMany({
          where: { courseId },
          select: { id: true },
        }),
        this.prisma.courseAttendance.findMany({
          where: { session: { courseId } },
          select: { sessionId: true, studentId: true, status: true },
        }),
      ]);

    const sessionCount = sessions.length;
    type Key = string;
    const k = (lessonId: string, studentId: string): Key =>
      `${lessonId}|${studentId}`;
    const viewByKey = new Map<Key, (typeof views)[number]>();
    for (const v of views) viewByKey.set(k(v.lessonId, v.studentId), v);
    const attemptByKey = new Map<Key, (typeof attempts)[number]>();
    for (const a of attempts) {
      const key = k(a.lessonId, a.studentId);
      const prev = attemptByKey.get(key);
      if (!prev || (a.status === 'COMPLETED' && prev.status !== 'COMPLETED')) {
        attemptByKey.set(key, a);
      }
    }

    const rows = enrollments.map((e) => {
      const lessonRows = lessons.map((l) => {
        const v = viewByKey.get(k(l.id, e.studentId));
        const a = attemptByKey.get(k(l.id, e.studentId));
        const pct =
          v && v.videoDurationSec && v.videoDurationSec > 0
            ? Math.round((v.watchedSeconds / v.videoDurationSec) * 100)
            : 0;
        return {
          lessonId: l.id,
          opened: !!v,
          openCount: v?.openCount ?? 0,
          lastOpenedAt: v?.lastOpenedAt ?? null,
          watchedSeconds: v?.watchedSeconds ?? 0,
          videoDurationSec: v?.videoDurationSec ?? null,
          videoPct: pct,
          videoCompleted: v?.videoCompleted ?? false,
          attemptId: a?.id ?? null,
          attemptStatus: a?.status ?? null,
          attemptScore: a?.score ?? null,
          attemptMaxScore: a?.maxScore ?? null,
          attemptPassed: a?.passed ?? null,
        };
      });
      const opened = lessonRows.filter((r) => r.opened).length;
      const completed = lessonRows.filter(
        (r) => r.attemptStatus === 'COMPLETED',
      ).length;
      const present = attendance.filter(
        (r) => r.studentId === e.studentId && r.status !== 'ABSENT',
      ).length;
      return {
        studentId: e.studentId,
        studentNumber: e.student.studentNumber,
        name: e.student.user.name,
        email: e.student.user.email,
        progressPct: e.progressPct,
        lessonsOpened: opened,
        lessonsCompleted: completed,
        sessionsAttended: present,
        attendancePct:
          sessionCount > 0 ? Math.round((present / sessionCount) * 100) : 0,
        lessons: lessonRows,
      };
    });

    return {
      course: { id: courseId, sessionCount, lessonCount: lessons.length },
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        requireVideoWatch: l.requireVideoWatch,
        videoWatchPct: l.videoWatchPct,
      })),
      students: rows,
    };
  }
}
