/**
 * Shared types & helpers for lesson page content + question grading.
 *
 * Each LessonPage stores a JSON `content` payload whose shape depends on
 * `pageType`. We keep validation/grading here so both the teacher editor
 * (write-side) and the student player (read-side) agree on the format.
 */

import { BadRequestException } from '@nestjs/common';
import { H5P_TYPES, type H5PType, isH5PType, sanitizeH5PInput, gradeH5PQuestion } from '../h5p/h5p-questions';

// ─── Page-type shapes ─────────────────────────────────────────────────
export type QuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'SHORT_ANSWER'
  | 'NUMERIC'
  | H5PType;

export interface ContentPagePayload {
  body: string; // markdown / plain text / html (renderer's choice)
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | 'embed' | null;
}

export interface QuestionChoice {
  id: string;
  text: string;
}

export interface QuestionPagePayload {
  questionType: QuestionType;
  prompt: string;
  explanation?: string | null;
  points?: number;
  // type-specific:
  choices?: QuestionChoice[]; // MCQ_SINGLE, MCQ_MULTI
  correctChoiceId?: string | null; // MCQ_SINGLE
  correctChoiceIds?: string[]; // MCQ_MULTI
  correctAnswer?: boolean; // TRUE_FALSE
  acceptedAnswers?: string[]; // SHORT_ANSWER (any match wins)
  caseSensitive?: boolean; // SHORT_ANSWER
  correctValue?: number; // NUMERIC
  tolerance?: number; // NUMERIC (absolute)
  data?: any; // H5P types (ESSAY, SORT_PARAGRAPHS, DRAG_WORDS, DRAG_DROP, SPEAK_WORDS, SPEAK_WORDS_SET, DICTATION) — see backend/src/h5p/h5p-questions.ts
}

export interface BranchPagePayload {
  prompt: string;
  choices: Array<{
    id: string;
    text: string;
    nextPageId?: string | null;
  }>;
}

// ─── Submitted-answer shapes ──────────────────────────────────────────
// Generic — student player sends whichever fields apply to the page type.
export interface SubmittedAnswer {
  choiceId?: string; // MCQ_SINGLE, BRANCH
  choiceIds?: string[]; // MCQ_MULTI
  boolean?: boolean; // TRUE_FALSE
  text?: string; // SHORT_ANSWER
  number?: number; // NUMERIC
  h5pResponse?: any; // H5P types — shape depends on questionType, see backend/src/h5p/h5p-questions.ts
}

// ─── Grading result ───────────────────────────────────────────────────
export interface GradingResult {
  correct: boolean | null; // null = not auto-gradable (e.g. branch / content, or Essay pending manual grade)
  pointsAwarded: number | null; // null = pending manual grade (only ESSAY today)
  maxPoints: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(s: unknown, caseSensitive: boolean): string {
  const t = String(s ?? '').trim();
  return caseSensitive ? t : t.toLowerCase();
}

/**
 * Validate (and lightly normalize) the JSON content for a given page type.
 * Throws BadRequestException on structural issues. Returns the normalized
 * payload so callers can persist a clean object.
 */
export function validatePageContent(
  pageType: string,
  content: any,
): ContentPagePayload | QuestionPagePayload | BranchPagePayload {
  const c = content ?? {};
  switch (pageType) {
    case 'CONTENT': {
      return {
        body: typeof c.body === 'string' ? c.body : '',
        mediaUrl: c.mediaUrl ? String(c.mediaUrl) : null,
        mediaType: ['image', 'video', 'embed'].includes(c.mediaType)
          ? c.mediaType
          : null,
      };
    }
    case 'QUESTION': {
      const qt = String(c.questionType || '').toUpperCase() as QuestionType;
      const allowed: QuestionType[] = [
        'MCQ_SINGLE',
        'MCQ_MULTI',
        'TRUE_FALSE',
        'SHORT_ANSWER',
        'NUMERIC',
        ...H5P_TYPES,
      ];
      if (!allowed.includes(qt)) {
        throw new BadRequestException(
          `questionType must be one of ${allowed.join(', ')}`,
        );
      }
      const base: QuestionPagePayload = {
        questionType: qt,
        prompt: typeof c.prompt === 'string' ? c.prompt : '',
        explanation: c.explanation ? String(c.explanation) : null,
        points: Math.max(0, asNumber(c.points, 1)),
      };
      if (isH5PType(qt)) {
        base.data = sanitizeH5PInput(qt, c.data ?? {});
        return base;
      }
      if (qt === 'MCQ_SINGLE' || qt === 'MCQ_MULTI') {
        const choices: QuestionChoice[] = Array.isArray(c.choices)
          ? c.choices.map((ch: any, i: number) => ({
              id: String(ch?.id ?? `c${i + 1}`),
              text: String(ch?.text ?? ''),
            }))
          : [];
        if (choices.length < 2) {
          throw new BadRequestException(
            'MCQ questions need at least 2 choices',
          );
        }
        base.choices = choices;
        if (qt === 'MCQ_SINGLE') {
          base.correctChoiceId = c.correctChoiceId
            ? String(c.correctChoiceId)
            : null;
        } else {
          base.correctChoiceIds = Array.isArray(c.correctChoiceIds)
            ? c.correctChoiceIds.map((x: any) => String(x))
            : [];
        }
      } else if (qt === 'TRUE_FALSE') {
        base.correctAnswer = !!c.correctAnswer;
      } else if (qt === 'SHORT_ANSWER') {
        base.acceptedAnswers = Array.isArray(c.acceptedAnswers)
          ? c.acceptedAnswers.map((s: any) => String(s))
          : [];
        base.caseSensitive = !!c.caseSensitive;
      } else if (qt === 'NUMERIC') {
        base.correctValue = asNumber(c.correctValue, 0);
        base.tolerance = Math.max(0, asNumber(c.tolerance, 0));
      }
      return base;
    }
    case 'BRANCH': {
      const choices = Array.isArray(c.choices)
        ? c.choices.map((ch: any, i: number) => ({
            id: String(ch?.id ?? `b${i + 1}`),
            text: String(ch?.text ?? ''),
            nextPageId: ch?.nextPageId ? String(ch.nextPageId) : null,
          }))
        : [];
      if (choices.length < 2) {
        throw new BadRequestException(
          'Branch pages need at least 2 choices',
        );
      }
      return {
        prompt: typeof c.prompt === 'string' ? c.prompt : '',
        choices,
      };
    }
    default:
      throw new BadRequestException(`Unknown pageType: ${pageType}`);
  }
}

/**
 * Auto-grade a submitted answer against a QUESTION page.
 * Returns { correct, pointsAwarded, maxPoints }.
 */
export function gradeQuestion(
  payload: QuestionPagePayload,
  answer: SubmittedAnswer,
): GradingResult {
  const maxPoints = Math.max(0, asNumber(payload.points, 1));
  const result = (correct: boolean): GradingResult => ({
    correct,
    pointsAwarded: correct ? maxPoints : 0,
    maxPoints,
  });

  if (isH5PType(payload.questionType)) {
    const { awarded, autoGraded } = gradeH5PQuestion(
      payload.questionType,
      payload.data,
      answer.h5pResponse,
      maxPoints,
    );
    if (!autoGraded) return { correct: null, pointsAwarded: null, maxPoints };
    return { correct: awarded >= maxPoints, pointsAwarded: awarded ?? 0, maxPoints };
  }

  switch (payload.questionType) {
    case 'MCQ_SINGLE': {
      const picked = answer.choiceId ? String(answer.choiceId) : null;
      return result(!!picked && picked === payload.correctChoiceId);
    }
    case 'MCQ_MULTI': {
      const expected = new Set(payload.correctChoiceIds ?? []);
      const given = new Set(
        Array.isArray(answer.choiceIds)
          ? answer.choiceIds.map((s) => String(s))
          : [],
      );
      if (expected.size !== given.size) return result(false);
      for (const id of expected) if (!given.has(id)) return result(false);
      return result(true);
    }
    case 'TRUE_FALSE':
      return result(typeof answer.boolean === 'boolean' &&
        answer.boolean === !!payload.correctAnswer);
    case 'SHORT_ANSWER': {
      const cs = !!payload.caseSensitive;
      const given = normalizeText(answer.text, cs);
      if (!given) return result(false);
      const accepted = (payload.acceptedAnswers ?? []).map((s) =>
        normalizeText(s, cs),
      );
      return result(accepted.includes(given));
    }
    case 'NUMERIC': {
      if (typeof answer.number !== 'number' || !Number.isFinite(answer.number)) {
        return result(false);
      }
      const target = asNumber(payload.correctValue, 0);
      const tol = Math.max(0, asNumber(payload.tolerance, 0));
      return result(Math.abs(answer.number - target) <= tol);
    }
    default:
      return { correct: null, pointsAwarded: 0, maxPoints };
  }
}

/**
 * Compute the max possible score for a lesson by summing question points.
 */
export function computeLessonMaxScore(
  pages: Array<{ pageType: string; content: any }>,
): number {
  let total = 0;
  for (const p of pages) {
    if (p.pageType !== 'QUESTION') continue;
    const pts = asNumber((p.content as any)?.points, 1);
    if (Number.isFinite(pts) && pts > 0) total += pts;
  }
  return total;
}

/**
 * Resolve the next page id for an answered page.
 *  - BRANCH page: from the matched choice's nextPageId.
 *  - Otherwise: page.nextPageId if set, else next page in `order`.
 *  - Returns null when there is no further page (lesson end).
 */
export function resolveNextPageId(
  currentPage: {
    id: string;
    pageType: string;
    nextPageId: string | null;
    content: any;
    order: number;
  },
  allPages: Array<{ id: string; order: number }>,
  answer: SubmittedAnswer,
): string | null {
  if (currentPage.pageType === 'BRANCH') {
    const choices = Array.isArray((currentPage.content as any)?.choices)
      ? (currentPage.content as any).choices
      : [];
    const picked = choices.find(
      (c: any) => String(c?.id) === String(answer.choiceId ?? ''),
    );
    if (picked?.nextPageId) return String(picked.nextPageId);
  }
  if (currentPage.nextPageId) return currentPage.nextPageId;
  const sorted = [...allPages].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((p) => p.id === currentPage.id);
  if (idx >= 0 && idx + 1 < sorted.length) return sorted[idx + 1].id;
  return null;
}
