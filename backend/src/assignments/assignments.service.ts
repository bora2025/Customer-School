import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { H5P_TYPES, isH5PType, sanitizeH5PInput, sanitizeH5PForStudent, gradeH5PQuestion } from '../h5p/h5p-questions';

const ALLOWED_TYPES = ['HOMEWORK', 'QUIZ', 'PROJECT', 'LAB', 'ESSAY'];
const ALLOWED_STATUS = ['DRAFT', 'PUBLISHED', 'CLOSED'];
const ALLOWED_QUESTION_TYPES = ['MCQ', 'TF', 'MATCHING', 'NUMERICAL', ...H5P_TYPES];

function sanitizeQuestionInput(body: any) {
  const type = String(body.type || '').toUpperCase();
  if (!ALLOWED_QUESTION_TYPES.includes(type)) {
    throw new BadRequestException(`Question type must be one of ${ALLOWED_QUESTION_TYPES.join(', ')}`);
  }
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new BadRequestException('Question prompt is required');
  const points = Math.max(0, Number(body.points) || 1);
  const raw = body.data ?? {};
  let data: any;
  if (isH5PType(type)) {
    data = sanitizeH5PInput(type, raw);
  } else {
    switch (type) {
      case 'MCQ': {
        const choices = Array.isArray(raw.choices) ? raw.choices : [];
        const cleanedChoices = choices
          .filter((c: any) => c && (c.text ?? '').toString().trim())
          .map((c: any, i: number) => ({
            id: String(c.id || `c${i}`),
            text: String(c.text).trim(),
            isCorrect: !!c.isCorrect,
          }));
        if (cleanedChoices.length < 2) throw new BadRequestException('MCQ needs at least 2 choices');
        if (!cleanedChoices.some(c => c.isCorrect)) throw new BadRequestException('MCQ needs at least 1 correct choice');
        data = { choices: cleanedChoices, multiple: !!raw.multiple };
        break;
      }
      case 'MATCHING': {
        const left = Array.isArray(raw.left) ? raw.left : [];
        const right = Array.isArray(raw.right) ? raw.right : [];
        const cleanedLeft = left.filter((x: any) => (x?.text ?? '').toString().trim()).map((x: any, i: number) => ({ id: String(x.id || `l${i}`), text: String(x.text).trim() }));
        const cleanedRight = right.filter((x: any) => (x?.text ?? '').toString().trim()).map((x: any, i: number) => ({ id: String(x.id || `r${i}`), text: String(x.text).trim() }));
        if (cleanedLeft.length < 2 || cleanedRight.length < 2) throw new BadRequestException('Matching needs at least 2 items on each side');
        const pairs = Array.isArray(raw.pairs) ? raw.pairs : [];
        const cleanedPairs = pairs
          .filter((p: any) => p && cleanedLeft.some(l => l.id === p.leftId) && cleanedRight.some(r => r.id === p.rightId))
          .map((p: any) => ({ leftId: String(p.leftId), rightId: String(p.rightId) }));
        if (!cleanedPairs.length) throw new BadRequestException('Matching needs at least one correct pair');
        data = { left: cleanedLeft, right: cleanedRight, pairs: cleanedPairs };
        break;
      }
      case 'NUMERICAL': {
        const correct = Number(raw.correct);
        if (isNaN(correct)) throw new BadRequestException('Numerical question needs a numeric correct answer');
        const tolerance = Math.max(0, Number(raw.tolerance) || 0);
        data = { correct, tolerance };
        break;
      }
      default:
        data = { correct: !!raw.correct };
        break;
    }
  }
  return { type, prompt, points, data };
}

function sanitizeQuestionForStudent(q: { id: string; type: string; prompt: string; points: number; order: number; data: any }) {
  const d = q.data || {};
  let safe: any;
  if (isH5PType(q.type)) {
    safe = sanitizeH5PForStudent(q.type, d);
  } else {
    switch (q.type) {
      case 'MCQ':
        safe = {
          choices: (d.choices || []).map((c: any) => ({ id: c.id, text: c.text })),
          multiple: !!d.multiple,
        };
        break;
      case 'MATCHING':
        safe = { left: d.left || [], right: d.right || [] };
        break;
      case 'NUMERICAL':
      case 'TF':
      default:
        safe = {};
        break;
    }
  }
  return { id: q.id, type: q.type, prompt: q.prompt, points: q.points, order: q.order, data: safe };
}

function gradeQuestion(q: { type: string; points: number; data: any }, response: any): { pointsAwarded: number | null; autoGraded: boolean } {
  if (response == null) {
    if (q.type === 'ESSAY') return { pointsAwarded: null, autoGraded: false };
    return { pointsAwarded: 0, autoGraded: true };
  }
  const d = q.data || {};
  if (isH5PType(q.type)) {
    const { awarded, autoGraded } = gradeH5PQuestion(q.type, d, response, q.points);
    return { pointsAwarded: awarded, autoGraded };
  }
  switch (q.type) {
    case 'MCQ': {
      const correctIds = new Set((d.choices || []).filter((c: any) => c.isCorrect).map((c: any) => c.id));
      const chosen = new Set(Array.isArray(response) ? response.map(String) : [String(response)]);
      const equal = chosen.size === correctIds.size && [...chosen].every(id => correctIds.has(id));
      return { pointsAwarded: equal ? q.points : 0, autoGraded: true };
    }
    case 'TF':
      return { pointsAwarded: !!response === !!d.correct ? q.points : 0, autoGraded: true };
    case 'MATCHING': {
      const correctMap = new Map<string, string>((d.pairs || []).map((p: any) => [p.leftId, p.rightId]));
      const given = Array.isArray(response) ? response : [];
      let correct = 0;
      for (const p of given) {
        if (p && correctMap.get(String(p.leftId)) === String(p.rightId)) correct++;
      }
      const totalPairs = correctMap.size || 1;
      return { pointsAwarded: (q.points * correct) / totalPairs, autoGraded: true };
    }
    case 'NUMERICAL': {
      const num = Number(response);
      if (isNaN(num)) return { pointsAwarded: 0, autoGraded: true };
      const ok = Math.abs(num - Number(d.correct)) <= Number(d.tolerance || 0);
      return { pointsAwarded: ok ? q.points : 0, autoGraded: true };
    }
    default:
      return { pointsAwarded: null, autoGraded: false };
  }
}

type AssignmentInput = {
  title?: string;
  description?: string | null;
  instructions?: string | null;
  classId?: string;
  type?: string;
  weight?: number;
  availableFrom?: string | null;
  dueDate?: string | null;
  totalMarks?: number;
  allowLate?: boolean;
  latePenaltyPct?: number;
  maxAttempts?: number;
  status?: string;
  attachmentUrl?: string | null;
  randomizeQuestions?: boolean;
  randomizeChoices?: boolean;
  timeLimitMinutes?: number | null;
};

function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function sanitizeWriteData(input: AssignmentInput) {
  const data: any = {};
  if (input.title !== undefined) data.title = String(input.title).trim();
  if (input.description !== undefined) data.description = input.description ? String(input.description).trim() : null;
  if (input.instructions !== undefined) data.instructions = input.instructions ? String(input.instructions).trim() : null;
  if (input.classId !== undefined) data.classId = input.classId;
  if (input.attachmentUrl !== undefined) data.attachmentUrl = input.attachmentUrl ? String(input.attachmentUrl).trim() : null;

  if (input.type !== undefined) {
    const t = String(input.type).toUpperCase();
    if (!ALLOWED_TYPES.includes(t)) throw new BadRequestException(`type must be one of ${ALLOWED_TYPES.join(', ')}`);
    data.type = t;
  }
  if (input.status !== undefined) {
    const s = String(input.status).toUpperCase();
    if (!ALLOWED_STATUS.includes(s)) throw new BadRequestException(`status must be one of ${ALLOWED_STATUS.join(', ')}`);
    data.status = s;
  }
  if (input.weight !== undefined) data.weight = Number(input.weight) || 1;
  if (input.totalMarks !== undefined) data.totalMarks = Number(input.totalMarks) || 0;
  if (input.latePenaltyPct !== undefined) data.latePenaltyPct = Math.max(0, Math.min(100, Number(input.latePenaltyPct) || 0));
  if (input.maxAttempts !== undefined) {
    const n = Number(input.maxAttempts);
    data.maxAttempts = isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }
  if (input.allowLate !== undefined) data.allowLate = !!input.allowLate;
  if ((input as any).randomizeQuestions !== undefined) data.randomizeQuestions = !!(input as any).randomizeQuestions;
  if ((input as any).randomizeChoices !== undefined) data.randomizeChoices = !!(input as any).randomizeChoices;
  if ((input as any).timeLimitMinutes !== undefined) {
    const v = (input as any).timeLimitMinutes;
    if (v === null || v === '' || v === 0) data.timeLimitMinutes = null;
    else {
      const n = Math.max(1, Math.min(600, Number(v) || 0));
      data.timeLimitMinutes = n;
    }
  }

  const dueDate = toDate(input.dueDate);
  if (dueDate !== undefined) data.dueDate = dueDate;
  const availableFrom = toDate(input.availableFrom);
  if (availableFrom !== undefined) data.availableFrom = availableFrom;

  return data;
}

@Injectable()
export class AssignmentsService {
  constructor(private prisma: PrismaService) {}

  // ── Teacher / Admin ──

  async getAll(classId?: string, status?: string) {
    return this.prisma.assignment.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByTeacher(teacherUserId: string) {
    const classes = await this.prisma.class.findMany({
      where: { teacherId: teacherUserId },
      select: { id: true },
    });
    const classIds = classes.map(c => c.id);
    return this.prisma.assignment.findMany({
      where: { classId: { in: classIds } },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getOne(id: string) {
    const a = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        submissions: {
          include: { student: { include: { user: { select: { name: true, photo: true } } } } },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  async create(body: AssignmentInput, createdById: string) {
    if (!body.title?.trim()) throw new BadRequestException('Title is required');
    if (!body.classId) throw new BadRequestException('classId is required');
    const data = sanitizeWriteData(body);
    if (data.status === 'PUBLISHED') data.publishedAt = new Date();
    const created = await this.prisma.assignment.create({
      data: { ...data, createdById },
      include: { class: { select: { id: true, name: true, subject: true } } },
    });
    if (created.status === 'PUBLISHED') {
      await this.notifyStudentsPublished(created.id);
    }
    return created;
  }

  async update(id: string, body: AssignmentInput) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Assignment not found');
    const data = sanitizeWriteData(body);
    const transitionedToPublished = existing.status !== 'PUBLISHED' && data.status === 'PUBLISHED';
    if (transitionedToPublished) data.publishedAt = new Date();
    const updated = await this.prisma.assignment.update({ where: { id }, data });
    if (transitionedToPublished) {
      await this.notifyStudentsPublished(updated.id);
    }
    return updated;
  }

  async delete(id: string) {
    return this.prisma.assignment.delete({ where: { id } });
  }

  private async notifyStudentsPublished(assignmentId: string) {
    try {
      const a = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { title: true, classId: true, class: { select: { name: true } } },
      });
      if (!a) return;
      const students = await this.prisma.student.findMany({
        where: { classId: a.classId },
        select: { userId: true },
      });
      if (!students.length) return;
      await this.prisma.notification.createMany({
        data: students.map(s => ({
          userId: s.userId,
          type: 'assignment_published',
          message: `New assignment: "${a.title}" in ${a.class?.name ?? 'your class'}`,
        })),
      });
    } catch {}
  }

  // ── Student ──

  async getStudentAssignments(userId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true, classId: true },
    });
    if (!student || !student.classId) return [];

    const now = new Date();
    const rows = await this.prisma.assignment.findMany({
      where: {
        classId: student.classId,
        status: { in: ['PUBLISHED', 'CLOSED'] },
        OR: [{ availableFrom: null }, { availableFrom: { lte: now } }],
      },
      include: {
        class: { select: { id: true, name: true, subject: true } },
        createdBy: { select: { id: true, name: true } },
        submissions: { where: { studentId: student.id }, take: 1 },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    return rows.map(({ submissions, ...rest }) => ({
      ...rest,
      submission: submissions[0] ?? null,
    }));
  }

  async submitAssignment(assignmentId: string, userId: string, data: { content?: string; attachmentUrl?: string }) {
    const student = await this.prisma.student.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');

    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status === 'DRAFT') throw new ForbiddenException('This assignment has not been published yet');
    if (assignment.status === 'CLOSED') throw new ForbiddenException('This assignment is closed for submissions');
    if (assignment.availableFrom && new Date() < assignment.availableFrom) {
      throw new ForbiddenException('This assignment is not yet available');
    }

    const now = new Date();
    const isLate = !!(assignment.dueDate && now > assignment.dueDate);
    if (isLate && !assignment.allowLate) {
      throw new ForbiddenException('Late submissions are not allowed for this assignment');
    }

    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
    });
    const maxAttempts = assignment.maxAttempts ?? 1;
    const currentAttempt = existing?.attemptNumber ?? 0;
    if (existing && maxAttempts > 0 && currentAttempt >= maxAttempts) {
      throw new ForbiddenException(`Maximum attempts (${maxAttempts}) reached`);
    }

    const content = data.content?.toString().trim() || null;
    const attachmentUrl = data.attachmentUrl?.toString().trim() || null;
    if (!content && !attachmentUrl) {
      throw new BadRequestException('Provide either content or an attachment URL');
    }

    return this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
      create: {
        assignmentId,
        studentId: student.id,
        content,
        attachmentUrl,
        status: isLate ? 'LATE' : 'SUBMITTED',
        attemptNumber: 1,
      },
      update: {
        content,
        attachmentUrl,
        status: isLate ? 'LATE' : 'SUBMITTED',
        attemptNumber: currentAttempt + 1,
        submittedAt: now,
        marks: null,
        feedback: null,
        gradedAt: null,
        latePenaltyApplied: null,
      },
    });
  }

  // ── Quiz Questions (Teacher) ──

  async listQuestions(assignmentId: string) {
    return this.prisma.quizQuestion.findMany({
      where: { assignmentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createQuestion(assignmentId: string, body: any) {
    const a = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Assignment not found');
    const cleaned = sanitizeQuestionInput(body);
    const count = await this.prisma.quizQuestion.count({ where: { assignmentId } });
    const created = await this.prisma.quizQuestion.create({
      data: {
        assignmentId,
        order: body.order != null ? Number(body.order) : count,
        type: cleaned.type,
        prompt: cleaned.prompt,
        points: cleaned.points,
        data: cleaned.data,
      },
    });
    await this.syncAssignmentTotalMarks(assignmentId);
    return created;
  }

  async updateQuestion(questionId: string, body: any) {
    const existing = await this.prisma.quizQuestion.findUnique({ where: { id: questionId } });
    if (!existing) throw new NotFoundException('Question not found');
    const cleaned = sanitizeQuestionInput({ ...existing, ...body, data: body.data ?? existing.data });
    const updated = await this.prisma.quizQuestion.update({
      where: { id: questionId },
      data: {
        type: cleaned.type,
        prompt: cleaned.prompt,
        points: cleaned.points,
        data: cleaned.data,
        ...(body.order != null ? { order: Number(body.order) } : {}),
      },
    });
    await this.syncAssignmentTotalMarks(existing.assignmentId);
    return updated;
  }

  async deleteQuestion(questionId: string) {
    const existing = await this.prisma.quizQuestion.findUnique({ where: { id: questionId } });
    if (!existing) throw new NotFoundException('Question not found');
    const deleted = await this.prisma.quizQuestion.delete({ where: { id: questionId } });
    await this.syncAssignmentTotalMarks(existing.assignmentId);
    return deleted;
  }

  private async syncAssignmentTotalMarks(assignmentId: string) {
    const agg = await this.prisma.quizQuestion.aggregate({
      where: { assignmentId },
      _sum: { points: true },
    });
    const total = agg._sum.points ?? 0;
    if (total > 0) {
      await this.prisma.assignment.update({ where: { id: assignmentId }, data: { totalMarks: total } });
    }
  }

  // ── Quiz (Student) ──

  async getStudentQuiz(assignmentId: string, userId: string) {
    const student = await this.prisma.student.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.classId !== student.classId) throw new ForbiddenException('Not your class');
    if (assignment.status === 'DRAFT') throw new ForbiddenException('Quiz not published yet');
    let questions = await this.prisma.quizQuestion.findMany({
      where: { assignmentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const submission = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
      include: { answers: true },
    });
    // Randomization (deterministic per student & assignment so refresh keeps order)
    const seedBase = `${assignmentId}:${student.id}:${submission?.attemptNumber ?? 0}`;
    if ((assignment as any).randomizeQuestions) {
      questions = seededShuffle(questions, `Q:${seedBase}`);
    }
    const attemptsUsed = submission?.attemptNumber ?? 0;
    const maxAttempts = assignment.maxAttempts ?? 1;
    const exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts;
    const revealAnswers = !!submission && (exhausted || assignment.status === 'CLOSED');
    const sanitized = questions.map(q => {
      const s = sanitizeQuestionForStudent(q);
      if ((assignment as any).randomizeChoices && s.type === 'MCQ' && Array.isArray(s.data?.choices)) {
        s.data = { ...s.data, choices: seededShuffle(s.data.choices, `C:${seedBase}:${s.id}`) };
      }
      if (revealAnswers) {
        const d: any = q.data || {};
        let correct: any = null;
        switch (q.type) {
          case 'MCQ':
            correct = { correctIds: (d.choices || []).filter((c: any) => c.isCorrect).map((c: any) => c.id) };
            break;
          case 'TF':
            correct = { correct: !!d.correct };
            break;
          case 'NUMERICAL':
            correct = { correct: d.correct, tolerance: d.tolerance ?? 0 };
            break;
          case 'MATCHING':
            correct = { pairs: d.pairs || [] };
            break;
          case 'SORT_PARAGRAPHS':
            correct = { paragraphs: d.paragraphs || [] };
            break;
          case 'DRAG_WORDS':
            correct = { text: d.text || '' };
            break;
          case 'DRAG_DROP':
            correct = { items: d.items || [] };
            break;
          case 'SPEAK_WORDS':
            correct = { acceptedAnswers: d.acceptedAnswers || [] };
            break;
          case 'SPEAK_WORDS_SET':
            correct = { items: d.items || [] };
            break;
          case 'DICTATION':
            correct = { script: d.script || '' };
            break;
          default:
            correct = null;
        }
        (s as any).correctData = correct;
      }
      return s;
    });
    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        instructions: assignment.instructions,
        dueDate: assignment.dueDate,
        totalMarks: assignment.totalMarks,
        maxAttempts: assignment.maxAttempts,
        allowLate: assignment.allowLate,
        timeLimitMinutes: (assignment as any).timeLimitMinutes ?? null,
      },
      questions: sanitized,
      revealAnswers,
      submission: submission ? {
        id: submission.id,
        status: submission.status,
        marks: submission.marks,
        attemptNumber: submission.attemptNumber,
        submittedAt: submission.submittedAt,
        quizStartedAt: (submission as any).quizStartedAt ?? null,
        answers: submission.answers.map(a => ({ questionId: a.questionId, response: a.response, pointsAwarded: a.pointsAwarded, feedback: a.feedback })),
      } : null,
    };
  }

  async startQuiz(assignmentId: string, userId: string) {
    const student = await this.prisma.student.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.classId !== student.classId) throw new ForbiddenException('Not your class');
    if (assignment.status !== 'PUBLISHED') throw new ForbiddenException('Quiz not available');
    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
    });
    const maxAttempts = assignment.maxAttempts ?? 1;
    if (existing && maxAttempts > 0 && (existing.attemptNumber ?? 0) >= maxAttempts && !(existing as any).quizStartedAt) {
      throw new ForbiddenException(`Maximum attempts (${maxAttempts}) reached`);
    }
    const now = new Date();
    if (existing) {
      if (!(existing as any).quizStartedAt) {
        await this.prisma.assignmentSubmission.update({
          where: { id: existing.id },
          data: { quizStartedAt: now } as any,
        });
        return { startedAt: now, timeLimitMinutes: (assignment as any).timeLimitMinutes ?? null };
      }
      return { startedAt: (existing as any).quizStartedAt, timeLimitMinutes: (assignment as any).timeLimitMinutes ?? null };
    }
    const created = await this.prisma.assignmentSubmission.create({
      data: {
        assignmentId,
        studentId: student.id,
        status: 'SUBMITTED',
        attemptNumber: 0,
        quizStartedAt: now,
      } as any,
    });
    return { startedAt: (created as any).quizStartedAt ?? now, timeLimitMinutes: (assignment as any).timeLimitMinutes ?? null };
  }

  async submitQuiz(assignmentId: string, userId: string, body: { answers: Array<{ questionId: string; response: any }> }) {
    const student = await this.prisma.student.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.classId !== student.classId) throw new ForbiddenException('Not your class');
    if (assignment.status === 'DRAFT') throw new ForbiddenException('Quiz not published yet');
    if (assignment.status === 'CLOSED') throw new ForbiddenException('Quiz is closed');
    if (assignment.availableFrom && new Date() < assignment.availableFrom) {
      throw new ForbiddenException('Quiz is not yet available');
    }
    const now = new Date();
    const isLate = !!(assignment.dueDate && now > assignment.dueDate);
    if (isLate && !assignment.allowLate) throw new ForbiddenException('Late submissions are not allowed');

    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
    });
    const maxAttempts = assignment.maxAttempts ?? 1;
    const currentAttempt = existing?.attemptNumber ?? 0;
    if (existing && maxAttempts > 0 && currentAttempt >= maxAttempts) {
      throw new ForbiddenException(`Maximum attempts (${maxAttempts}) reached`);
    }
    const timeLimit = (assignment as any).timeLimitMinutes as number | null | undefined;
    if (timeLimit && existing && (existing as any).quizStartedAt) {
      const elapsedSec = (now.getTime() - new Date((existing as any).quizStartedAt).getTime()) / 1000;
      if (elapsedSec > timeLimit * 60 + 10) {
        throw new ForbiddenException('Time limit exceeded for this quiz attempt');
      }
    }

    const questions = await this.prisma.quizQuestion.findMany({ where: { assignmentId } });
    if (!questions.length) throw new BadRequestException('This quiz has no questions yet');
    const byId = new Map(questions.map(q => [q.id, q]));
    const answersByQ = new Map<string, any>();
    for (const a of body.answers || []) {
      if (a && a.questionId && byId.has(a.questionId)) answersByQ.set(a.questionId, a.response);
    }

    let autoTotal = 0;
    let hasEssay = false;
    const answersToCreate: Array<{ questionId: string; response: any; pointsAwarded: number | null; autoGraded: boolean }> = [];
    for (const q of questions) {
      const resp = answersByQ.has(q.id) ? answersByQ.get(q.id) : null;
      const { pointsAwarded, autoGraded } = gradeQuestion(q, resp);
      if (!autoGraded) hasEssay = true;
      if (pointsAwarded != null) autoTotal += pointsAwarded;
      answersToCreate.push({ questionId: q.id, response: resp ?? null, pointsAwarded, autoGraded });
    }

    // Apply late penalty to auto marks (essay portion will be added by teacher later).
    const penaltyPct = isLate ? assignment.latePenaltyPct || 0 : 0;
    const adjustedAuto = Math.max(0, autoTotal - (autoTotal * penaltyPct) / 100);

    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.assignmentSubmission.upsert({
        where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
        create: {
          assignmentId,
          studentId: student.id,
          content: null,
          attachmentUrl: null,
          status: hasEssay ? (isLate ? 'LATE' : 'SUBMITTED') : 'GRADED',
          attemptNumber: 1,
          marks: hasEssay ? null : adjustedAuto,
          latePenaltyApplied: penaltyPct || null,
          gradedAt: hasEssay ? null : new Date(),
        },
        update: {
          status: hasEssay ? (isLate ? 'LATE' : 'SUBMITTED') : 'GRADED',
          attemptNumber: currentAttempt + 1,
          submittedAt: now,
          marks: hasEssay ? null : adjustedAuto,
          feedback: null,
          gradedAt: hasEssay ? null : new Date(),
          latePenaltyApplied: penaltyPct || null,
          quizStartedAt: null,
        } as any,
      });
      await tx.quizAnswer.deleteMany({ where: { submissionId: sub.id } });
      if (answersToCreate.length) {
        await tx.quizAnswer.createMany({
          data: answersToCreate.map(a => ({ ...a, submissionId: sub.id })),
        });
      }
      return sub;
    });

    return {
      submissionId: submission.id,
      autoScore: autoTotal,
      adjustedAutoScore: adjustedAuto,
      hasManualGrading: hasEssay,
      latePenaltyApplied: penaltyPct || null,
    };
  }

  async gradeQuizAnswer(answerId: string, body: { pointsAwarded: number | null; feedback?: string | null }) {
    const ans = await this.prisma.quizAnswer.findUnique({
      where: { id: answerId },
      include: { question: true, submission: { include: { assignment: { select: { id: true, totalMarks: true, latePenaltyPct: true, title: true } }, student: { select: { userId: true } } } } },
    });
    if (!ans) throw new NotFoundException('Answer not found');
    let pts: number | null = null;
    if (body.pointsAwarded != null) {
      pts = Math.max(0, Math.min(Number(body.pointsAwarded) || 0, ans.question.points));
    }
    await this.prisma.quizAnswer.update({
      where: { id: answerId },
      data: { pointsAwarded: pts, feedback: body.feedback ?? null },
    });
    // Recompute submission marks from all answers
    const allAnswers = await this.prisma.quizAnswer.findMany({ where: { submissionId: ans.submissionId } });
    const anyPending = allAnswers.some(a => a.pointsAwarded == null);
    const rawTotal = allAnswers.reduce((sum, a) => sum + (a.pointsAwarded ?? 0), 0);
    const isLate = ans.submission.status === 'LATE';
    const penaltyPct = isLate ? ans.submission.assignment.latePenaltyPct || 0 : 0;
    const cap = ans.submission.assignment.totalMarks ?? rawTotal;
    const capped = Math.min(rawTotal, cap);
    const finalMarks = Math.max(0, capped - (capped * penaltyPct) / 100);

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: ans.submissionId },
      data: {
        marks: finalMarks,
        status: anyPending ? ans.submission.status : 'GRADED',
        gradedAt: anyPending ? null : new Date(),
        latePenaltyApplied: penaltyPct || null,
      },
    });

    if (!anyPending) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: ans.submission.student.userId,
            type: 'assignment_graded',
            message: `Your submission for "${ans.submission.assignment.title}" was graded: ${finalMarks}/${ans.submission.assignment.totalMarks}`,
          },
        });
      } catch {}
    }
    return { answer: { id: answerId, pointsAwarded: pts, feedback: body.feedback ?? null }, submission: updated };
  }

  async getSubmissionDetail(submissionId: string) {
    const sub = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: { include: { questions: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } },
        answers: true,
        student: { include: { user: { select: { name: true } } } },
      },
    });
    if (!sub) throw new NotFoundException('Submission not found');
    return {
      submission: {
        id: sub.id,
        status: sub.status,
        marks: sub.marks,
        latePenaltyApplied: sub.latePenaltyApplied,
        attemptNumber: sub.attemptNumber,
        studentName: sub.student?.user?.name,
      },
      assignmentTotalMarks: sub.assignment.totalMarks,
      questions: sub.assignment.questions,
      answers: sub.answers,
    };
  }

  async exportQuestions(assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const questions = await this.prisma.quizQuestion.findMany({
      where: { assignmentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      assignmentTitle: assignment.title,
      exportedAt: new Date().toISOString(),
      questions: questions.map(q => ({
        type: q.type,
        prompt: q.prompt,
        points: q.points,
        order: q.order,
        data: q.data,
      })),
    };
  }

  async importQuestions(assignmentId: string, body: { questions: any[]; replaceExisting?: boolean }) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (!Array.isArray(body?.questions) || body.questions.length === 0) {
      throw new BadRequestException('questions array is required');
    }
    if (body.replaceExisting) {
      await this.prisma.quizQuestion.deleteMany({ where: { assignmentId } });
    }
    const existingCount = body.replaceExisting
      ? 0
      : await this.prisma.quizQuestion.count({ where: { assignmentId } });
    let created = 0;
    for (let i = 0; i < body.questions.length; i++) {
      const raw = body.questions[i];
      const cleaned = sanitizeQuestionInput(raw);
      await this.prisma.quizQuestion.create({
        data: {
          assignmentId,
          order: raw?.order != null ? Number(raw.order) : existingCount + i + 1,
          type: cleaned.type,
          prompt: cleaned.prompt,
          points: cleaned.points,
          data: cleaned.data,
        },
      });
      created++;
    }
    await this.syncAssignmentTotalMarks(assignmentId);
    return { created, replaced: !!body.replaceExisting };
  }

  async gradeSubmission(submissionId: string, data: { marks: number; feedback?: string }) {
    const sub = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: { select: { id: true, title: true, latePenaltyPct: true, totalMarks: true } },
        student: { select: { userId: true } },
      },
    });
    if (!sub) throw new NotFoundException('Submission not found');

    const rawMarks = Math.max(0, Number(data.marks) || 0);
    const cappedRaw = Math.min(rawMarks, sub.assignment.totalMarks ?? rawMarks);
    const isLate = sub.status === 'LATE';
    const penaltyPct = isLate ? sub.assignment.latePenaltyPct || 0 : 0;
    const finalMarks = Math.max(0, cappedRaw - (cappedRaw * penaltyPct) / 100);

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        marks: finalMarks,
        feedback: data.feedback ?? null,
        status: 'GRADED',
        gradedAt: new Date(),
        latePenaltyApplied: penaltyPct || null,
      },
    });

    try {
      await this.prisma.notification.create({
        data: {
          userId: sub.student.userId,
          type: 'assignment_graded',
          message: `Your submission for "${sub.assignment.title}" was graded: ${finalMarks}/${sub.assignment.totalMarks}`,
        },
      });
    } catch {}

    return updated;
  }

  // Deletes the submission (cascades its QuizAnswer rows) so the student can
  // submit/start fresh — assignmentId_studentId is unique, so an old row would
  // otherwise keep blocking them via maxAttempts even after a teacher's intent
  // to grant one more try.
  async resetSubmission(submissionId: string) {
    const sub = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: { select: { title: true } },
        student: { select: { userId: true } },
      },
    });
    if (!sub) throw new NotFoundException('Submission not found');

    await this.prisma.assignmentSubmission.delete({ where: { id: submissionId } });

    try {
      await this.prisma.notification.create({
        data: {
          userId: sub.student.userId,
          type: 'assignment_reset',
          message: `Your submission for "${sub.assignment.title}" was reset — you can attempt it again.`,
        },
      });
    } catch {}

    return { success: true };
  }
}
