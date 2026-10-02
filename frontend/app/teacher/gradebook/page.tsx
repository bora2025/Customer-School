"use client"

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch } from '../../../lib/api'

interface Assignment { id: string; title: string; totalMarks: number }
interface Submission { marks: number | null; status: string }
interface StudentRow {
  student: { id: string; user: { name: string } }
  submissions: Record<string, Submission | null>
  average: number | null
}
interface GradebookData {
  class: { id: string; name: string; subject: string }
  assignments: Assignment[]
  rows: StudentRow[]
}
interface ClassItem { id: string; name: string; subject: string }

function pctColor(pct: number) {
  if (pct >= 70) return 'text-emerald-700 bg-emerald-50'
  if (pct >= 50) return 'text-amber-700 bg-amber-50'
  return 'text-red-700 bg-red-50'
}

export default function TeacherGradebookPage() {
  const [selectedClassId, setSelectedClassId] = useState<string>('')

  const { data: classes = [] as ClassItem[] } = useQuery<ClassItem[]>({
    queryKey: ['classes-list'],
    queryFn: async () => { const r = await apiFetch('/api/classes'); if (!r.ok) throw new Error(); return r.json() },
  })

  const { data: gradebook, isLoading, isError, refetch } = useQuery<GradebookData>({
    queryKey: ['gradebook', selectedClassId],
    queryFn: async () => {
      // Step 1: fetch all assignments for the class (each has _count.submissions but not full list)
      const assignRes = await apiFetch(`/api/assignments?classId=${selectedClassId}`)
      if (!assignRes.ok) throw new Error()
      const assignList: any[] = await assignRes.json()

      // Step 2: for each assignment fetch full data (includes all submissions with student info)
      const fullAssignments: any[] = await Promise.all(
        assignList.map(a => apiFetch(`/api/assignments/${a.id}`).then(r => r.json()))
      )

      const classInfo = classes.find(c => c.id === selectedClassId) ?? { id: selectedClassId, name: '', subject: '' }

      // Step 3: collect all unique students from submissions
      const studentMap = new Map<string, { id: string; user: { name: string } }>()
      fullAssignments.forEach(a => {
        a.submissions?.forEach((sub: any) => {
          if (sub.student && !studentMap.has(sub.student.id)) {
            studentMap.set(sub.student.id, { id: sub.student.id, user: { name: sub.student.user?.name ?? 'Unknown' } })
          }
        })
      })

      const assignments: Assignment[] = fullAssignments.map(a => ({ id: a.id, title: a.title, totalMarks: a.totalMarks }))

      // Step 4: build rows
      const rows: StudentRow[] = Array.from(studentMap.values()).map(student => {
        const submissions: Record<string, Submission | null> = {}
        let total = 0; let graded = 0
        assignments.forEach(a => {
          const fa = fullAssignments.find(x => x.id === a.id)
          const sub = fa?.submissions?.find((s: any) => s.student?.id === student.id) ?? null
          submissions[a.id] = sub ? { marks: sub.marks, status: sub.status } : null
          if (sub?.marks !== null && sub?.marks !== undefined) { total += (sub.marks / a.totalMarks) * 100; graded++ }
        })
        return { student, submissions, average: graded > 0 ? Math.round(total / graded) : null }
      })

      return { class: classInfo, assignments, rows }
    },
    enabled: !!selectedClassId && classes.length > 0,
  })

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="sky" />

        <main className="flex-1 p-3 sm:p-6 overflow-x-auto">
          <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">📒 Gradebook</h1>
            <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Select class...</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name} — {c.subject}</option>)}
            </select>
          </div>

          {!selectedClassId ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-4xl mb-3">📒</p>
              <p className="text-slate-400">Select a class to view gradebook</p>
            </div>
          ) : isLoading ? (
            <div className="bg-white rounded-xl p-8 text-center shadow-sm">
              <div className="animate-spin w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-slate-400 text-sm mt-3">Loading gradebook...</p>
            </div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load gradebook</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : !gradebook || gradebook.rows.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-4xl mb-3">📭</p>
              <p className="text-slate-400">No students in this class</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[160px]">Student</th>
                    {gradebook.assignments.map(a => (
                      <th key={a.id} className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[100px]">
                        <p className="truncate max-w-[96px]" title={a.title}>{a.title}</p>
                        <p className="text-slate-400 font-normal normal-case">/{a.totalMarks}</p>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[80px]">Avg</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[80px]">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.rows.map((row, i) => {
                    const avg = row.average
                    const letterGrade = avg === null ? '—' : avg >= 90 ? 'A' : avg >= 80 ? 'B' : avg >= 70 ? 'C' : avg >= 60 ? 'D' : 'F'
                    return (
                      <tr key={row.student.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="sticky left-0 bg-inherit px-4 py-3 font-medium text-slate-800 border-r border-slate-100">
                          {row.student.user.name}
                        </td>
                        {gradebook.assignments.map(a => {
                          const sub = row.submissions[a.id]
                          if (!sub) return <td key={a.id} className="px-3 py-3 text-center text-slate-300 text-xs">—</td>
                          if (sub.marks === null) return <td key={a.id} className="px-3 py-3 text-center"><span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Pending</span></td>
                          const pct = Math.round((sub.marks / a.totalMarks) * 100)
                          return (
                            <td key={a.id} className="px-3 py-3 text-center">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pctColor(pct)}`}>
                                {sub.marks}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-center">
                          {avg !== null ? (
                            <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${pctColor(avg)}`}>{avg}%</span>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-sm font-bold px-2 py-1 rounded-lg ${avg !== null ? pctColor(avg) : 'text-slate-300 bg-white'}`}>{letterGrade}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Legend */}
              <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500">
                <span className="font-semibold">Grades:</span>
                {[['A','90+','text-emerald-700 bg-emerald-50'],['B','80+','text-emerald-700 bg-emerald-50'],['C','70+','text-amber-700 bg-amber-50'],['D','60+','text-amber-700 bg-amber-50'],['F','<60','text-red-700 bg-red-50']].map(([g, r, cls]) => (
                  <span key={g} className={`px-2 py-0.5 rounded-full font-semibold ${cls}`}>{g} ({r})</span>
                ))}
                <Link href="/teacher/assignments" className="ml-auto text-sky-600 hover:underline">Manage Assignments →</Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
