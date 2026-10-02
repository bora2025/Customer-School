// Exam-specific question types, authoring defaults, and client-side mirrors of
// backend/src/exam/exam.service.ts's sanitize/grade logic. Used by the question
// authoring editor, the preview modal, and the teacher gradebook so none of them
// need a round-trip just to shuffle/score a question. MCQ/TF are exam-local; the
// other 5 types delegate to lib/h5pQuestionLogic.ts, which is shared with the
// Assignments and Courses modules.

import {
  H5P_TYPES, type H5PType, isH5PType, H5P_TYPE_LABEL, h5pDefaultData,
  parseDragWordsText, shuffle, sanitizeH5PForPreview, gradeH5PQuestion, uid,
} from './h5pQuestionLogic'

export type QType = 'MCQ' | 'TF' | H5PType

export interface ExamQuestionDraft {
  text: string
  type: QType
  marks: number
  data: any
  section?: string | null
}

export const TYPE_LABEL: Record<QType, string> = {
  MCQ: 'Multi-Choice',
  TF: 'True / False',
  ...H5P_TYPE_LABEL,
}

export { uid, parseDragWordsText, shuffle, isH5PType, H5P_TYPES }

export const LABEL_STYLES = ['ALPHA', 'NUMERIC', 'ROMAN', 'NONE'] as const
export type LabelStyle = (typeof LABEL_STYLES)[number]
export const LABEL_STYLE_NAME: Record<LabelStyle, string> = {
  ALPHA: 'A, B, C',
  NUMERIC: '1, 2, 3',
  ROMAN: 'I, II, III',
  NONE: 'None',
}
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

// The label follows the choice's DISPLAYED position (post-shuffle), not whatever
// order it was authored in — otherwise "A" could silently stop lining up with
// whichever choice a student actually sees first.
export function optionLabel(style: LabelStyle | undefined, index: number): string {
  switch (style) {
    case 'ALPHA': return String.fromCharCode(65 + index)
    case 'NUMERIC': return String(index + 1)
    case 'ROMAN': return ROMAN_NUMERALS[index] || String(index + 1)
    default: return ''
  }
}

export function defaultData(type: QType): any {
  if (isH5PType(type)) return h5pDefaultData(type)
  if (type === 'MCQ') return { choices: [{ id: uid('c'), text: '', isCorrect: false }, { id: uid('c'), text: '', isCorrect: false }], multiple: false, labelStyle: 'ALPHA' as LabelStyle }
  return { correct: true }
}

export function defaultQuestion(): ExamQuestionDraft {
  return { text: '', type: 'MCQ', marks: 1, data: defaultData('MCQ'), section: '' }
}

export interface QuestionPage<T> {
  section: string | null
  questions: T[]
  startIndex: number // index of this page's first question within the original flat array — lets the UI keep numbering "Q1, Q2…" continuous across pages
}

// Groups consecutive questions sharing the same (trimmed, case-sensitive) section
// label into one page — e.g. 10 "Listening" questions then 10 "Reading" ones
// becomes 2 pages. Un-sectioned questions (null/empty) are grouped the same way,
// so an exam nobody assigned sections to collapses to a single page and the
// pagination UI stays hidden entirely (checked via `pages.length <= 1` at the
// call site) — a plain question list behaves exactly as it did before this
// feature existed.
export function groupQuestionsBySection<T extends { section?: string | null }>(questions: T[]): QuestionPage<T>[] {
  const pages: QuestionPage<T>[] = []
  questions.forEach((q, i) => {
    const section = (q.section || '').trim() || null
    const last = pages[pages.length - 1]
    if (last && last.section === section) last.questions.push(q)
    else pages.push({ section, questions: [q], startIndex: i })
  })
  return pages
}

// Strips correct-answer data the same way exam.service.ts's
// sanitizeExamQuestionForStudent does, so a preview never leaks answers through
// the interactive input's own props (grading is done separately via gradeQuestion).
export function sanitizeForPreview(type: QType, data: any): any {
  if (isH5PType(type)) return sanitizeH5PForPreview(type, data)
  const d = data || {}
  if (type === 'MCQ') {
    // Older questions saved before label styles existed have no labelStyle in
    // their stored data — default to ALPHA here too so preview matches what
    // the student-facing endpoint returns.
    const labelStyle: LabelStyle = LABEL_STYLES.includes(d.labelStyle) ? d.labelStyle : 'ALPHA'
    return {
      choices: shuffle((d.choices || []).map((c: any) => ({ id: c.id, text: c.text }))),
      multiple: !!d.multiple,
      labelStyle,
    }
  }
  return {}
}

// Mirrors backend/src/exam/exam.service.ts's gradeExamQuestion.
export function gradeQuestion(q: { type: QType | string; marks: number; data: any }, response: any): { awarded: number | null; autoGraded: boolean } {
  if (response == null && q.type !== 'ESSAY') return { awarded: 0, autoGraded: true }
  if (isH5PType(q.type)) return gradeH5PQuestion(q.type, q.data, response, q.marks)
  const d = q.data || {}
  switch (q.type) {
    case 'MCQ': {
      const correctIds = new Set((d.choices || []).filter((c: any) => c.isCorrect).map((c: any) => c.id))
      const chosen = new Set(Array.isArray(response) ? response.map(String) : [String(response)])
      const equal = chosen.size === correctIds.size && [...chosen].every((id) => correctIds.has(id))
      return { awarded: equal ? q.marks : 0, autoGraded: true }
    }
    case 'TF':
      return { awarded: !!response === !!d.correct ? q.marks : 0, autoGraded: true }
    default:
      return { awarded: null, autoGraded: false }
  }
}
