"use client"

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { uid } from '../../lib/h5pQuestionLogic'
import MathText from '../MathText'

interface Paragraph { id: string; text: string }

// Hoisted to a stable reference — dnd-kit's useSensor memoizes internally keyed
// on this options object, so passing a fresh literal on every render defeats
// that memoization and makes DndContext redo its setup on every re-render
// (visible as the drag-and-drop UI flashing/resetting on any parent re-render,
// e.g. an exam countdown timer ticking once a second).
const POINTER_ACTIVATION_CONSTRAINT = { activationConstraint: { distance: 4 } }

function SortableRow({ id, children }: { id: string; children: (opts: { listeners: any; attributes: any }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return <div ref={setNodeRef} style={style}>{children({ listeners, attributes })}</div>
}

/** Authoring editor for Sort the Paragraphs. `data: { paragraphs: [{id,text}] }` in correct order. */
export function SortParagraphsEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const paragraphs: Paragraph[] = data?.paragraphs ?? []
  const sensors = useSensors(useSensor(PointerSensor, POINTER_ACTIVATION_CONSTRAINT))

  function updateText(i: number, text: string) {
    onChange({ ...data, paragraphs: paragraphs.map((p, idx) => idx === i ? { ...p, text } : p) })
  }
  function addParagraph() { onChange({ ...data, paragraphs: [...paragraphs, { id: uid('p'), text: '' }] }) }
  function removeParagraph(i: number) { onChange({ ...data, paragraphs: paragraphs.filter((_, idx) => idx !== i) }) }
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = paragraphs.findIndex(p => p.id === active.id)
    const newIndex = paragraphs.findIndex(p => p.id === over.id)
    onChange({ ...data, paragraphs: arrayMove(paragraphs, oldIndex, newIndex) })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Enter paragraphs in the correct order — students see them shuffled and must drag to reorder.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={paragraphs.map(p => p.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {paragraphs.map((p, i) => (
              <SortableRow key={p.id} id={p.id}>
                {({ listeners, attributes }) => (
                  <div className="flex items-start gap-2 bg-white border rounded-lg p-2">
                    <span {...listeners} {...attributes} className="text-slate-400 cursor-grab active:cursor-grabbing pt-1.5 select-none touch-none" title="Drag to reorder">⠿</span>
                    <span className="text-xs text-slate-400 pt-1.5">{i + 1}.</span>
                    <textarea value={p.text} onChange={e => updateText(i, e.target.value)} rows={1} placeholder={`Paragraph ${i + 1}`} className="flex-1 border rounded px-2 py-1 text-sm resize-none" />
                    <button type="button" onClick={() => removeParagraph(i)} disabled={paragraphs.length <= 2} className="text-xs text-red-500 disabled:opacity-30 pt-1.5">✕</button>
                  </div>
                )}
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button type="button" onClick={addParagraph} className="text-xs text-sky-600 hover:underline">+ Add paragraph</button>
    </div>
  )
}

function SortableParagraphRow({ id, index, text }: { id: string; index: number; text: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-start gap-3 p-3 rounded-lg border-2 border-slate-200 bg-white cursor-grab active:cursor-grabbing touch-none"
    >
      <span className="text-slate-400 font-mono text-sm pt-0.5">{index + 1}</span>
      <MathText as="span" className="text-sm text-slate-700 flex-1" text={text} />
      <span className="text-slate-300">⠿</span>
    </div>
  )
}

/** Student-facing input for Sort the Paragraphs. `data: { paragraphs: [{id,text}] }` (shuffled),
 * `value: string[]` of paragraph ids in the student's chosen order. */
export function SortParagraphsInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const paragraphs: Paragraph[] = data?.paragraphs ?? []
  const order: string[] = Array.isArray(value) && value.length === paragraphs.length ? value : paragraphs.map(p => p.id)
  const byId = Object.fromEntries(paragraphs.map(p => [p.id, p.text]))
  const sensors = useSensors(useSensor(PointerSensor, POINTER_ACTIVATION_CONSTRAINT))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(String(active.id))
    const newIndex = order.indexOf(String(over.id))
    onChange(arrayMove(order, oldIndex, newIndex))
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
      <p className="text-xs text-slate-500 mb-2">Drag to arrange in the correct order.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {order.map((id, i) => (
              <SortableParagraphRow key={id} id={id} index={i} text={byId[id] ?? ''} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
