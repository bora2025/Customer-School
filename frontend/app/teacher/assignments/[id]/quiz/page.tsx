"use client"

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import AuthGuard from '../../../../../components/AuthGuard'
import Sidebar from '../../../../../components/Sidebar'
import EmptyState from '../../../../../components/EmptyState'
import { teacherNav } from '../../../../../lib/teacher-nav'
import { apiFetch } from '../../../../../lib/api'
import { type H5PType, isH5PType, H5P_TYPE_LABEL, h5pDefaultData, uid, parseDragWordsText } from '../../../../../lib/h5pQuestionLogic'
import { EssayEditor } from '../../../../../components/questions/EssayField'
import { SortParagraphsEditor } from '../../../../../components/questions/SortParagraphsField'
import { DragWordsEditor } from '../../../../../components/questions/DragWordsField'
import { FillBlanksEditor } from '../../../../../components/questions/FillBlanksField'
import { DragDropEditor } from '../../../../../components/questions/DragDropField'
import { SpeakWordsEditor } from '../../../../../components/questions/SpeakWordsField'
import { SpeakWordsSetEditor } from '../../../../../components/questions/SpeakWordsSetField'
import { DictationEditor } from '../../../../../components/questions/DictationField'
import MathText from '../../../../../components/MathText'
import RichText from '../../../../../components/RichText'
import RichTextEditor from '../../../../../components/RichTextEditor'

type QType = 'MCQ' | 'TF' | 'MATCHING' | 'NUMERICAL' | H5PType

interface Choice { id: string; text: string; isCorrect: boolean }
interface MatchItem { id: string; text: string }
interface MatchPair { leftId: string; rightId: string }
interface Question {
  id: string
  order: number
  type: QType
  prompt: string
  points: number
  data: any
}

const TYPE_LABEL: Record<QType, string> = {
  MCQ: 'Multiple Choice',
  TF: 'True / False',
  MATCHING: 'Matching',
  NUMERICAL: 'Numerical',
  ...H5P_TYPE_LABEL,
}

function defaultData(type: QType): any {
  if (isH5PType(type)) return h5pDefaultData(type)
  switch (type) {
    case 'MCQ': return { choices: [{ id: uid('c'), text: '', isCorrect: false }, { id: uid('c'), text: '', isCorrect: false }], multiple: false }
    case 'MATCHING': return {
      left: [{ id: uid('l'), text: '' }, { id: uid('l'), text: '' }],
      right: [{ id: uid('r'), text: '' }, { id: uid('r'), text: '' }],
      pairs: [],
    }
    case 'NUMERICAL': return { correct: 0, tolerance: 0 }
    default: return { correct: true }
  }
}

export default function TeacherQuizEditorPage() {
  const params = useParams()
  const assignmentId = params?.id as string
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Question | null>(null)
  const [draftType, setDraftType] = useState<QType>('MCQ')
  const [draft, setDraft] = useState<{ prompt: string; points: number; data: any } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: assignment } = useQuery({
    queryKey: ['assignment-detail', assignmentId],
    queryFn: async () => { const r = await apiFetch(`/api/assignments/${assignmentId}`); if (!r.ok) throw new Error(); return r.json() },
    enabled: !!assignmentId,
  })
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['quiz-questions', assignmentId],
    queryFn: async () => { const r = await apiFetch(`/api/assignments/${assignmentId}/questions`); if (!r.ok) throw new Error(); return r.json() as Promise<Question[]> },
    enabled: !!assignmentId,
  })

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const url = payload.id ? `/api/assignments/questions/${payload.id}` : `/api/assignments/${assignmentId}/questions`
      const method = payload.id ? 'PUT' : 'POST'
      const { id, ...body } = payload
      const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.message || 'Save failed') }
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quiz-questions', assignmentId] }); qc.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] }); closeForm() },
    onError: (e: any) => setFormError(e?.message || 'Save failed'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/assignments/questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quiz-questions', assignmentId] }); qc.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] }) },
  })

  function openNew() {
    setEditing(null)
    setDraftType('MCQ')
    setDraft({ prompt: '', points: 1, data: defaultData('MCQ') })
    setFormError(null)
  }
  function openEdit(q: Question) {
    setEditing(q)
    setDraftType(q.type)
    setDraft({ prompt: q.prompt, points: q.points, data: q.data })
    setFormError(null)
  }
  function closeForm() { setDraft(null); setEditing(null); setFormError(null) }

  function changeType(t: QType) {
    setDraftType(t)
    setDraft(d => d ? { ...d, data: defaultData(t) } : d)
  }

  async function onSave() {
    if (!draft) return
    setFormError(null)
    try {
      await saveMutation.mutateAsync({
        id: editing?.id,
        type: draftType,
        prompt: draft.prompt,
        points: draft.points,
        data: draft.data,
      })
    } catch { /* surfaced */ }
  }

  const totalPoints = useMemo(() => questions.reduce((s, q) => s + (q.points || 0), 0), [questions])

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="sky" />
        <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <Link href={`/teacher/assignments/${assignmentId}`} className="text-sm text-gray-500 hover:text-gray-800 mb-4 block">← Back to assignment</Link>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 Quiz Questions</h1>
              {assignment && <p className="text-xs text-gray-500 mt-1">{assignment.title} · {questions.length} question(s) · {totalPoints} total points</p>}
            </div>
            <button onClick={openNew} className="bg-sky-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-sky-700 shadow-sm">+ Add Question</button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={async () => {
                const r = await apiFetch(`/api/assignments/${assignmentId}/questions/export`)
                if (!r.ok) { alert('Export failed'); return }
                const json = await r.json()
                const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `quiz-${(json.assignmentTitle || 'questions').replace(/[^a-z0-9]+/gi, '_')}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="text-xs border border-gray-200 px-3 py-1.5 rounded-xl hover:bg-gray-100 bg-white"
              disabled={!questions.length}
            >⬇️ Export JSON</button>
            <label className="text-xs border border-gray-200 px-3 py-1.5 rounded-xl hover:bg-gray-100 bg-white cursor-pointer">
              ⬆️ Import JSON
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    const text = await file.text()
                    const parsed = JSON.parse(text)
                    const arr = Array.isArray(parsed) ? parsed : parsed?.questions
                    if (!Array.isArray(arr)) { alert('Invalid file: missing questions array'); return }
                    const replace = questions.length > 0 && confirm(`This file has ${arr.length} question(s). Replace existing ${questions.length} question(s)? (Cancel = append)`)
                    const r = await apiFetch(`/api/assignments/${assignmentId}/questions/import`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ questions: arr, replaceExisting: replace }),
                    })
                    if (!r.ok) { const er = await r.json().catch(() => ({})); alert(er?.message || 'Import failed'); return }
                    const result = await r.json()
                    alert(`Imported ${result.created} question(s)`)
                    qc.invalidateQueries({ queryKey: ['quiz-questions', assignmentId] })
                    qc.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] })
                  } catch (err: any) {
                    alert(err?.message || 'Import failed')
                  } finally {
                    e.target.value = ''
                  }
                }}
              />
            </label>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : questions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <EmptyState icon="📝" message='No questions yet. Click "Add Question" to start.' />
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={q.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">Q{i + 1}</span>
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold bg-violet-100 text-violet-700">{TYPE_LABEL[q.type] ?? q.type}</span>
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700">{q.points} pt</span>
                      </div>
                      <RichText as="p" className="text-sm text-slate-800 whitespace-pre-wrap" html={q.prompt} />
                      {q.type === 'MCQ' && Array.isArray(q.data?.choices) && (
                        <ul className="mt-2 space-y-1">
                          {q.data.choices.map((c: Choice) => (
                            <li key={c.id} className={`text-xs ${c.isCorrect ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>{c.isCorrect ? '✔' : '○'} <MathText as="span" text={c.text} /></li>
                          ))}
                        </ul>
                      )}
                      {q.type === 'TF' && <p className="mt-2 text-xs text-emerald-700 font-semibold">Correct: {q.data?.correct ? 'True' : 'False'}</p>}
                      {q.type === 'NUMERICAL' && <p className="mt-2 text-xs text-emerald-700 font-semibold">Correct: {q.data?.correct} (±{q.data?.tolerance || 0})</p>}
                      {q.type === 'MATCHING' && (
                        <p className="mt-2 text-xs text-slate-500">{(q.data?.left || []).length} × {(q.data?.right || []).length} items, {(q.data?.pairs || []).length} correct pair(s)</p>
                      )}
                      {q.type === 'SORT_PARAGRAPHS' && (
                        <p className="mt-2 text-xs text-slate-500">{(q.data?.paragraphs || []).length} paragraph(s) to order</p>
                      )}
                      {q.type === 'DRAG_WORDS' && (
                        <p className="mt-2 text-xs text-slate-500">{parseDragWordsText(q.data?.text || '').filter(s => s.type === 'blank').length} blank(s)</p>
                      )}
                      {q.type === 'DRAG_DROP' && (
                        <p className="mt-2 text-xs text-slate-500">{(q.data?.items || []).length} item(s), {(q.data?.zones || []).length} zone(s)</p>
                      )}
                      {q.type === 'SPEAK_WORDS' && (
                        <p className="mt-2 text-xs text-slate-500">Prompt: <MathText as="span" text={q.data?.prompt} /></p>
                      )}
                      {q.type === 'SPEAK_WORDS_SET' && (
                        <p className="mt-2 text-xs text-slate-500">{(q.data?.items || []).length} prompt(s)</p>
                      )}
                      {q.type === 'DICTATION' && (
                        <p className="mt-2 text-xs text-slate-500">{q.data?.audioUrl ? 'Audio URL set' : 'Text-to-speech'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => openEdit(q)} className="text-xs bg-sky-50 text-sky-700 px-3 py-1.5 rounded-lg font-medium hover:bg-sky-100">Edit</button>
                      <button onClick={() => { if (confirm('Delete this question?')) deleteMutation.mutate(q.id) }} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </main>

        {draft && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl my-8">
              <h2 className="text-lg font-bold mb-4">{editing ? 'Edit Question' : 'New Question'}</h2>
              {formError && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{formError}</div>}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <label className="col-span-2 text-xs text-slate-500">Type
                    <select value={draftType} onChange={e => changeType(e.target.value as QType)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                      {(Object.keys(TYPE_LABEL) as QType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">Points
                    <input type="number" step="any" min={0} value={draft.points} onChange={e => setDraft({ ...draft, points: Number(e.target.value) || 0 })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                </div>
                <RichTextEditor value={draft.prompt} onChange={prompt => setDraft({ ...draft, prompt })} placeholder="Question prompt" />

                {/* Type-specific editor */}
                {draftType === 'MCQ' && (
                  <McqEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'TF' && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">Correct answer:</span>
                    <label className="flex items-center gap-1"><input type="radio" checked={draft.data.correct === true} onChange={() => setDraft({ ...draft, data: { correct: true } })} /> True</label>
                    <label className="flex items-center gap-1"><input type="radio" checked={draft.data.correct === false} onChange={() => setDraft({ ...draft, data: { correct: false } })} /> False</label>
                  </div>
                )}
                {draftType === 'NUMERICAL' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-slate-500">Correct value
                      <input type="number" step="any" value={draft.data.correct ?? 0} onChange={e => setDraft({ ...draft, data: { ...draft.data, correct: Number(e.target.value) } })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                    </label>
                    <label className="text-xs text-slate-500">± Tolerance
                      <input type="number" step="any" min={0} value={draft.data.tolerance ?? 0} onChange={e => setDraft({ ...draft, data: { ...draft.data, tolerance: Number(e.target.value) } })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                    </label>
                  </div>
                )}
                {draftType === 'MATCHING' && (
                  <MatchingEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'ESSAY' && (
                  <EssayEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'SORT_PARAGRAPHS' && (
                  <SortParagraphsEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'DRAG_WORDS' && (
                  <DragWordsEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'FILL_BLANKS' && (
                  <FillBlanksEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'DRAG_DROP' && (
                  <DragDropEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'SPEAK_WORDS' && (
                  <SpeakWordsEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'SPEAK_WORDS_SET' && (
                  <SpeakWordsSetEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}
                {draftType === 'DICTATION' && (
                  <DictationEditor data={draft.data} onChange={d => setDraft({ ...draft, data: d })} />
                )}

                <div className="flex gap-2 justify-end pt-2">
                  <button onClick={closeForm} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
                  <button onClick={onSave} disabled={saveMutation.isPending} className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg font-medium disabled:opacity-60">
                    {saveMutation.isPending ? 'Saving…' : (editing ? 'Save changes' : 'Add question')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}

function McqEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const choices: Choice[] = data.choices ?? []
  const multiple = !!data.multiple
  function setChoice(i: number, patch: Partial<Choice>) {
    const next = choices.map((c, idx) => idx === i ? { ...c, ...patch } : c)
    onChange({ ...data, choices: next })
  }
  function addChoice() { onChange({ ...data, choices: [...choices, { id: uid('c'), text: '', isCorrect: false }] }) }
  function removeChoice(i: number) { onChange({ ...data, choices: choices.filter((_, idx) => idx !== i) }) }
  function toggleCorrect(i: number) {
    if (multiple) {
      setChoice(i, { isCorrect: !choices[i].isCorrect })
    } else {
      onChange({ ...data, choices: choices.map((c, idx) => ({ ...c, isCorrect: idx === i })) })
    }
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={multiple} onChange={e => onChange({ ...data, multiple: e.target.checked })} /> Allow multiple correct answers
      </label>
      {choices.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          <input type={multiple ? 'checkbox' : 'radio'} checked={c.isCorrect} onChange={() => toggleCorrect(i)} title="Mark as correct" />
          <input value={c.text} onChange={e => setChoice(i, { text: e.target.value })} placeholder={`Choice ${i + 1}`} className="flex-1 border rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => removeChoice(i)} disabled={choices.length <= 2} className="text-xs text-red-500 disabled:opacity-30">✕</button>
        </div>
      ))}
      <button onClick={addChoice} className="text-xs text-sky-600 hover:underline">+ Add choice</button>
    </div>
  )
}

function MatchingEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const left: MatchItem[] = data.left ?? []
  const right: MatchItem[] = data.right ?? []
  const pairs: MatchPair[] = data.pairs ?? []

  function updateLeft(i: number, text: string) {
    onChange({ ...data, left: left.map((x, idx) => idx === i ? { ...x, text } : x) })
  }
  function updateRight(i: number, text: string) {
    onChange({ ...data, right: right.map((x, idx) => idx === i ? { ...x, text } : x) })
  }
  function addLeft() { onChange({ ...data, left: [...left, { id: uid('l'), text: '' }] }) }
  function removeLeft(i: number) {
    const removed = left[i]
    onChange({ ...data, left: left.filter((_, idx) => idx !== i), pairs: pairs.filter(p => p.leftId !== removed.id) })
  }
  function addRight() { onChange({ ...data, right: [...right, { id: uid('r'), text: '' }] }) }
  function removeRight(i: number) {
    const removed = right[i]
    onChange({ ...data, right: right.filter((_, idx) => idx !== i), pairs: pairs.filter(p => p.rightId !== removed.id) })
  }
  function setPair(leftId: string, rightId: string) {
    const next = pairs.filter(p => p.leftId !== leftId)
    if (rightId) next.push({ leftId, rightId })
    onChange({ ...data, pairs: next })
  }
  function pairFor(leftId: string) { return pairs.find(p => p.leftId === leftId)?.rightId ?? '' }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Left items</p>
          {left.map((x, i) => (
            <div key={x.id} className="flex items-center gap-2 mb-1">
              <input value={x.text} onChange={e => updateLeft(i, e.target.value)} placeholder={`Left ${i + 1}`} className="flex-1 border rounded-lg px-2 py-1 text-sm" />
              <button onClick={() => removeLeft(i)} disabled={left.length <= 2} className="text-xs text-red-500 disabled:opacity-30">✕</button>
            </div>
          ))}
          <button onClick={addLeft} className="text-xs text-sky-600 hover:underline">+ Add left</button>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Right items</p>
          {right.map((x, i) => (
            <div key={x.id} className="flex items-center gap-2 mb-1">
              <input value={x.text} onChange={e => updateRight(i, e.target.value)} placeholder={`Right ${i + 1}`} className="flex-1 border rounded-lg px-2 py-1 text-sm" />
              <button onClick={() => removeRight(i)} disabled={right.length <= 2} className="text-xs text-red-500 disabled:opacity-30">✕</button>
            </div>
          ))}
          <button onClick={addRight} className="text-xs text-sky-600 hover:underline">+ Add right</button>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">Correct pairs (map each left to its right)</p>
        <div className="space-y-1">
          {left.map(l => (
            <div key={l.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-1/2 truncate">{l.text || '(empty)'}</span>
              <select value={pairFor(l.id)} onChange={e => setPair(l.id, e.target.value)} className="flex-1 border rounded-lg px-2 py-1 text-sm">
                <option value="">— none —</option>
                {right.map(r => <option key={r.id} value={r.id}>{r.text || '(empty)'}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
