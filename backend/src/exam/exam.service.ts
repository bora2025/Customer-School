import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DirectoryService } from '../directory/directory.service';
import { H5P_TYPES, isH5PType, sanitizeH5PInput, sanitizeH5PForStudent, gradeH5PQuestion, shuffle } from '../h5p/h5p-questions';

const ALLOWED_EXAM_QUESTION_TYPES = ['MCQ', 'TF', ...H5P_TYPES];
const LABEL_STYLES = ['ALPHA', 'NUMERIC', 'ROMAN', 'NONE'];

// Strips a wrapping quote/trailing comma that tends to survive a copy-paste of a
// section name written out as part of a list elsewhere (e.g. `"Listening",`) —
// the frontend already does this on input, but sanitizing here too means a stray
// quote can never silently stop two questions meant to share a section from
// matching, regardless of what sent the request.
function cleanSectionLabel(raw: string): string {
  return raw.replace(/^[\s"'“”‘’]+|[\s"'“”‘’,]+$/g, '');
}

// react-hook-form's register() submits whatever the browser's <input> gives it —
// a plain string, unless the field opts into valueAsNumber — so a number field a
// teacher never touches survives as a number (straight from defaultValues), but
// one they actually type into arrives as a string. exam.create/update used to
// spread the request body straight into Prisma, so a string reaching an Int/Float
// column (e.g. maxAttempts: "5") crashed as an unhandled PrismaClientValidationError
// (raw 500, no useful message) instead of failing cleanly. `toNumber`'s 0-is-valid
// check matters specifically for maxAttempts, where 0 means "unlimited attempts" —
// a naive `Number(v) || fallback` would silently turn that into the fallback.
function toNumber(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeExamInput(body: any) {
  const title = String(body?.title || '').trim();
  if (!title) throw new BadRequestException('Exam title is required');
  const description = body?.description != null ? String(body.description).trim() || null : null;
  const classId = body?.classId ? String(body.classId) : null;
  const duration = Math.max(1, Math.round(toNumber(body?.duration, 60)));
  const totalMarks = Math.max(0, toNumber(body?.totalMarks, 100));
  const passMark = Math.max(0, toNumber(body?.passMark, 50));
  const maxAttempts = Math.max(0, Math.round(toNumber(body?.maxAttempts, 1)));
  return { title, description, classId, duration, totalMarks, passMark, maxAttempts };
}

function sanitizeExamQuestionInput(body: any) {
  const type = String(body.type || '').toUpperCase();
  if (!ALLOWED_EXAM_QUESTION_TYPES.includes(type)) {
    throw new BadRequestException(`Question type must be one of ${ALLOWED_EXAM_QUESTION_TYPES.join(', ')}`);
  }
  const text = String(body.text || '').trim();
  if (!text) throw new BadRequestException('Question text is required');
  // A TEXT passage is never gradable — forcing 0 here (regardless of what's sent)
  // is what keeps it out of totalMarks/autoTotal without needing every marks-summing
  // call site to separately filter the type out.
  const marks = type === 'TEXT' ? 0 : Math.max(0, Number(body.marks) || 1);
  const section = cleanSectionLabel(String(body.section || '').trim()) || null;
  const raw = body.data ?? {};
  let data: any;
  if (isH5PType(type)) {
    data = sanitizeH5PInput(type, raw);
  } else if (type === 'MCQ') {
    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const cleanedChoices = choices
      .filter((c: any) => c && (c.text ?? '').toString().trim())
      .map((c: any, i: number) => ({
        id: String(c.id || `c${i}`),
        text: String(c.text).trim(),
        isCorrect: !!c.isCorrect,
      }));
    if (cleanedChoices.length < 2) throw new BadRequestException('Multi-choice needs at least 2 choices');
    if (!cleanedChoices.some((c) => c.isCorrect)) throw new BadRequestException('Multi-choice needs at least 1 correct choice');
    const labelStyle = LABEL_STYLES.includes(raw.labelStyle) ? raw.labelStyle : 'ALPHA';
    data = { choices: cleanedChoices, multiple: !!raw.multiple, labelStyle };
  } else {
    data = { correct: !!raw.correct };
  }
  return { type, text, marks, section, data };
}

function sanitizeExamQuestionForStudent(q: { id: string; type: string; text: string; marks: number; order: number; section: string | null; data: any }) {
  const d = q.data || {};
  let safe: any;
  if (isH5PType(q.type)) {
    safe = sanitizeH5PForStudent(q.type, d);
  } else if (q.type === 'MCQ') {
    // Shuffled fresh on every fetch (not stored), same convention as the H5P
    // types' word banks/paragraph order — grading matches by choice id, so
    // display order never affects correctness.
    // Older questions saved before label styles existed have no labelStyle in
    // their stored data — default to ALPHA here too so they don't silently
    // render without labels until a teacher happens to re-save them.
    const labelStyle = LABEL_STYLES.includes(d.labelStyle) ? d.labelStyle : 'ALPHA';
    safe = { choices: shuffle((d.choices || []).map((c: any) => ({ id: c.id, text: c.text }))), multiple: !!d.multiple, labelStyle };
  } else {
    safe = {};
  }
  return { id: q.id, type: q.type, text: q.text, marks: q.marks, order: q.order, section: q.section, data: safe };
}

function gradeExamQuestion(q: { type: string; marks: number; data: any }, response: any): { awarded: number | null; autoGraded: boolean } {
  if (response == null) {
    if (q.type === 'ESSAY') return { awarded: null, autoGraded: false };
    return { awarded: 0, autoGraded: true };
  }
  const d = q.data || {};
  if (isH5PType(q.type)) {
    return gradeH5PQuestion(q.type, d, response, q.marks);
  }
  switch (q.type) {
    case 'MCQ': {
      const correctIds = new Set((d.choices || []).filter((c: any) => c.isCorrect).map((c: any) => c.id));
      const chosen = new Set(Array.isArray(response) ? response.map(String) : [String(response)]);
      const equal = chosen.size === correctIds.size && [...chosen].every((id) => correctIds.has(id));
      return { awarded: equal ? q.marks : 0, autoGraded: true };
    }
    case 'TF':
      return { awarded: !!response === !!d.correct ? q.marks : 0, autoGraded: true };
    default:
      return { awarded: null, autoGraded: false };
  }
}

@Injectable()
export class ExamService {
  constructor(private prisma: PrismaService, private readonly directory: DirectoryService) {}

  // ── Admin / Teacher: manage exams ──

  async getAll(classId?: string, status?: string) {
    return this.prisma.exam.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        class: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        questions: { orderBy: { order: 'asc' } },
        _count: { select: { attempts: true } },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  // Student-safe view: same as getOne but strips correct-answer keys from questions.
  async getOneForStudent(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true } },
        questions: { orderBy: { order: 'asc' } },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return { ...exam, questions: exam.questions.map(sanitizeExamQuestionForStudent) };
  }

  async create(data: any, createdById: string) {
    const { questions } = data;
    const examData = sanitizeExamInput(data);
    const sanitizedQuestions = Array.isArray(questions) ? questions.map(sanitizeExamQuestionInput) : [];
    return this.prisma.exam.create({
      data: {
        ...examData,
        createdById,
        questions: sanitizedQuestions.length
          ? { create: sanitizedQuestions.map((q: any, i: number) => ({ ...q, order: i })) }
          : undefined,
      },
      include: { questions: true },
    });
  }

  async update(id: string, data: any) {
    const { questions } = data;
    const examData = sanitizeExamInput(data);
    await this.prisma.exam.update({
      where: { id },
      data: examData,
    });
    if (questions) {
      const sanitizedQuestions = questions.map(sanitizeExamQuestionInput);
      await this.prisma.examQuestion.deleteMany({ where: { examId: id } });
      await this.prisma.examQuestion.createMany({
        data: sanitizedQuestions.map((q: any, i: number) => ({ ...q, examId: id, order: i })),
      });
    }
    return this.getOne(id);
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.exam.update({ where: { id }, data: { status } });
  }

  async delete(id: string) {
    return this.prisma.exam.delete({ where: { id } });
  }

  // ── Student: take exam ──

  async getStudentExams(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId: studentId },
      select: { id: true },
    });
    if (!student) return [];

    const classIds = await this.directory.classesForUser(studentId, 'STUDENT');
    const classScope = classIds.length ? { classId: { in: classIds } } : null;

    const exams = await this.prisma.exam.findMany({
      where: {
        OR: classScope ? [classScope, { classId: null }] : [{ classId: null }],
        status: { in: ['PUBLISHED', 'ACTIVE', 'COMPLETED'] },
      },
      include: {
        _count: { select: { questions: true } },
        attempts: { where: { studentId: student.id } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return exams;
  }

  async startAttempt(examId: string, userId: string) {
    const student = await this.prisma.student.findUnique({ where: { userId } });
    if (!student) throw new BadRequestException('Student profile not found');

    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');

    const existing = await this.prisma.examAttempt.findUnique({
      where: { examId_studentId: { examId, studentId: student.id } },
    });
    if (existing) {
      // An in-progress attempt is always safe to hand back for resuming.
      if (existing.status === 'IN_PROGRESS') return existing;

      // SUBMITTED (a mixed exam awaiting manual grading) can't be reopened —
      // that would silently wipe the teacher's pending-grading item. Only a
      // fully GRADED attempt is eligible for a retake.
      if (existing.status === 'SUBMITTED') {
        throw new BadRequestException('This attempt is awaiting manual grading and cannot be retaken yet');
      }
      // Already graded — only reopen it if the exam's retake policy
      // (maxAttempts, 0 = unlimited) still has room; otherwise a student could
      // re-answer and silently overwrite an already-graded score forever.
      const maxAttempts = exam.maxAttempts ?? 1;
      if (maxAttempts > 0 && existing.attemptNumber >= maxAttempts) {
        throw new BadRequestException(`Maximum attempts (${maxAttempts}) reached`);
      }
      if (exam.status !== 'ACTIVE') throw new BadRequestException('This exam is not currently active');
      return this.prisma.examAttempt.update({
        where: { id: existing.id },
        data: {
          status: 'IN_PROGRESS',
          answers: Prisma.JsonNull,
          score: null,
          grade: null,
          manualMarks: Prisma.JsonNull,
          feedback: null,
          startedAt: new Date(),
          submittedAt: null,
          gradedAt: null,
        },
      });
    }

    if (exam.status !== 'ACTIVE') throw new BadRequestException('This exam is not currently active');

    return this.prisma.examAttempt.create({
      data: { examId, studentId: student.id, status: 'IN_PROGRESS' },
    });
  }

  async saveAnswers(attemptId: string, answers: Record<string, any>) {
    return this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: { answers },
    });
  }

  async submitAttempt(attemptId: string, finalAnswers?: Record<string, any>) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { include: { questions: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This attempt has already been submitted');
    }

    // Prefer whatever the student's browser sent with the submit request — the
    // last 30s autosave tick can miss changes made in the final stretch.
    const answers = finalAnswers ?? (attempt.answers as Record<string, any>) ?? {};
    let total = 0;
    let hasManual = false;
    for (const q of attempt.exam.questions) {
      const { awarded, autoGraded } = gradeExamQuestion(q, answers[q.id]);
      if (!autoGraded) { hasManual = true; continue; }
      total += awarded ?? 0;
    }

    // If every question auto-grades, fully grade now. Otherwise leave for teacher.
    if (!hasManual) {
      const passed = total >= attempt.exam.passMark;
      return this.prisma.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'GRADED',
          submittedAt: new Date(),
          gradedAt: new Date(),
          score: total,
          grade: passed ? 'PASS' : 'FAIL',
          answers,
          attemptNumber: attempt.attemptNumber + 1,
        },
      });
    }

    // Mixed exam (once manually-graded types exist) — wait for manual grading.
    // Store the auto-gradable partial score for visibility.
    return this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'SUBMITTED',
        answers,
        submittedAt: new Date(),
        score: total,
        grade: null,
        attemptNumber: attempt.attemptNumber + 1,
      },
    });
  }

  // Teacher manually grades any non-auto-gradable questions for a submitted attempt.
  async gradeAttempt(
    attemptId: string,
    perQuestionMarks: Record<string, number>,
    feedback?: string,
  ) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { include: { questions: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const answers = (attempt.answers as Record<string, any>) ?? {};
    let total = 0;
    const sanitizedManual: Record<string, number> = {};
    for (const q of attempt.exam.questions) {
      const { awarded, autoGraded } = gradeExamQuestion(q, answers[q.id]);
      if (autoGraded) {
        total += awarded ?? 0;
        continue;
      }
      const raw = perQuestionMarks?.[q.id];
      const m = typeof raw === 'number' && !isNaN(raw) ? Math.max(0, Math.min(q.marks, raw)) : 0;
      sanitizedManual[q.id] = m;
      total += m;
    }

    const passed = total >= attempt.exam.passMark;
    return this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'GRADED',
        gradedAt: new Date(),
        score: total,
        grade: passed ? 'PASS' : 'FAIL',
        manualMarks: sanitizedManual,
        feedback: feedback ?? null,
      },
    });
  }

  async getAttemptResult(attemptId: string) {
    return this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: { include: { questions: true } } },
    });
  }

  async getExamAttempts(examId: string) {
    return this.prisma.examAttempt.findMany({
      where: { examId },
      include: {
        student: { include: { user: { select: { name: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // Deletes the attempt (examId_studentId is unique, so any status — including
  // GRADED — would otherwise block startAttempt forever) so the student can
  // start a fresh one.
  async resetAttempt(attemptId: string) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { select: { title: true } },
        student: { select: { userId: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    await this.prisma.examAttempt.delete({ where: { id: attemptId } });

    try {
      await this.prisma.notification.create({
        data: {
          userId: attempt.student.userId,
          type: 'exam_reset',
          message: `Your attempt on "${attempt.exam.title}" was reset — you can take it again.`,
        },
      });
    } catch {}

    return { success: true };
  }

  // Aggregated exam results for the student-facing scores page.
  async getStudentResults(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) return [];
    const attempts = await this.prisma.examAttempt.findMany({
      where: { studentId: student.id },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            passMark: true,
            class: { select: { id: true, name: true, subject: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
    return attempts.map(a => ({
      id: a.id,
      examId: a.examId,
      examTitle: a.exam.title,
      className: a.exam.class?.name ?? null,
      subject: a.exam.class?.subject ?? null,
      totalMarks: a.exam.totalMarks,
      passMark: a.exam.passMark,
      score: a.score,
      grade: a.grade,
      status: a.status,
      submittedAt: a.submittedAt,
      gradedAt: a.gradedAt,
    }));
  }
}
