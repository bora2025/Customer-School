"use client"

import { useRef, useState } from 'react'
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { uid } from '../../lib/h5pQuestionLogic'
import MathText from '../MathText'

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

interface Zone { id: string; x: number; y: number; width: number; height: number }
interface Item { id: string; label: string; correctZoneId: string }

/** Authoring editor for Drag and Drop. `data: { backgroundImage: base64, zones: [{id,x,y,width,height}] (% of image), items: [{id,label,correctZoneId}] }`.
 * Teacher uploads an image, click-drags rectangles over it to define drop zones, then adds
 * item labels and assigns each to its correct zone. Reuses the base64 FileReader upload
 * pattern already used for Class thumbnails (frontend/app/admin/classes/page.tsx). */
export function DragDropEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const backgroundImage: string = data?.backgroundImage ?? ''
  const zones: Zone[] = data?.zones ?? []
  const items: Item[] = data?.items ?? []
  const [imageError, setImageError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<{ startX: number; startY: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setImageError(null)
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Image must be smaller than 3MB')
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => onChange({ ...data, backgroundImage: reader.result as string })
    reader.readAsDataURL(file)
  }

  function pctFromEvent(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    const { x, y } = pctFromEvent(e)
    draftRef.current = { startX: x, startY: y }
    setDraft({ x, y, width: 0, height: 0 })
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!draftRef.current) return
    const { x, y } = pctFromEvent(e)
    const { startX, startY } = draftRef.current
    setDraft({
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY),
    })
  }
  function handleMouseUp() {
    if (draft && draft.width > 2 && draft.height > 2) {
      const zone: Zone = { id: uid('z'), x: draft.x, y: draft.y, width: draft.width, height: draft.height }
      onChange({ ...data, zones: [...zones, zone] })
    }
    draftRef.current = null
    setDraft(null)
  }

  function removeZone(id: string) {
    onChange({
      ...data,
      zones: zones.filter(z => z.id !== id),
      items: items.map(it => it.correctZoneId === id ? { ...it, correctZoneId: '' } : it),
    })
  }

  function addItem() { onChange({ ...data, items: [...items, { id: uid('i'), label: '', correctZoneId: zones[0]?.id || '' }] }) }
  function updateItem(i: number, patch: Partial<Item>) { onChange({ ...data, items: items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }) }
  function removeItem(i: number) { onChange({ ...data, items: items.filter((_, idx) => idx !== i) }) }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-500 mb-1">Background image</label>
        <input type="file" accept="image/*" onChange={handleImageChange} className="text-xs" />
        {imageError && <p className="text-xs text-red-500 mt-1">{imageError}</p>}
      </div>

      {backgroundImage && (
        <>
          <p className="text-xs text-slate-500">Click and drag over the image to draw a drop zone.</p>
          <div
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { draftRef.current = null; setDraft(null) }}
            className="relative select-none cursor-crosshair border rounded-lg overflow-hidden bg-slate-100"
            style={{ touchAction: 'none' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={backgroundImage} alt="Drag and drop background" className="w-full h-auto block pointer-events-none" draggable={false} />
            {zones.map((z, i) => (
              <div
                key={z.id}
                className="absolute border-2 border-sky-500 bg-sky-500/10 flex items-start justify-end"
                style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%` }}
              >
                <button type="button" onClick={(e) => { e.stopPropagation(); removeZone(z.id) }} className="bg-white text-red-500 text-[10px] w-4 h-4 rounded-bl leading-none">✕</button>
                <span className="absolute -top-4 left-0 text-[10px] text-sky-700 font-semibold">Zone {i + 1}</span>
              </div>
            ))}
            {draft && (
              <div
                className="absolute border-2 border-dashed border-sky-400 bg-sky-400/10"
                style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.width}%`, height: `${draft.height}%` }}
              />
            )}
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">Items — each must be assigned to a zone.</p>
        {items.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2">
            <input value={it.label} onChange={e => updateItem(i, { label: e.target.value })} placeholder={`Item ${i + 1} label`} className="flex-1 border rounded-lg px-3 py-1.5 text-sm" />
            <select value={it.correctZoneId} onChange={e => updateItem(i, { correctZoneId: e.target.value })} className="border rounded-lg px-2 py-1.5 text-sm">
              <option value="">— zone —</option>
              {zones.map((z, zi) => <option key={z.id} value={z.id}>Zone {zi + 1}</option>)}
            </select>
            <button type="button" onClick={() => removeItem(i)} className="text-xs text-red-500">✕</button>
          </div>
        ))}
        <button type="button" onClick={addItem} disabled={zones.length === 0} className="text-xs text-sky-600 hover:underline disabled:opacity-40">+ Add item</button>
      </div>
    </div>
  )
}

/** Student-facing input for Drag and Drop. `data: { backgroundImage, zones, items: [{id,label}] }`
 * (student-safe, no correctZoneId), `value: Record<itemId, zoneId>`. */
export function DragDropInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const backgroundImage: string = data?.backgroundImage ?? ''
  const zones: Zone[] = data?.zones ?? []
  const items: { id: string; label: string }[] = data?.items ?? []
  const placed: Record<string, string> = value && typeof value === 'object' ? value : {}

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const itemId = String(active.id)
    const overId = String(over.id)
    if (!overId.startsWith('zone::')) return
    const zoneId = overId.slice('zone::'.length)
    // Only one item per zone — bump out whatever was there before.
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(placed)) if (v !== zoneId) next[k] = v
    next[itemId] = zoneId
    onChange(next)
  }

  function clearItem(itemId: string) {
    const next = { ...placed }
    delete next[itemId]
    onChange(next)
  }

  const unplacedItems = items.filter(it => !placed[it.id])

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
        <div className="relative select-none border rounded-lg overflow-hidden bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backgroundImage} alt="Drag and drop" className="w-full h-auto block pointer-events-none" draggable={false} />
          {zones.map(z => {
            const placedItemId = Object.entries(placed).find(([, zid]) => zid === z.id)?.[0]
            const placedItem = items.find(it => it.id === placedItemId)
            return (
              <DroppableZone key={z.id} zone={z} item={placedItem} onClear={placedItem ? () => clearItem(placedItem.id) : undefined} />
            )
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3 mb-2">Drag each item onto the matching spot on the image.</p>
        <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          {unplacedItems.length === 0 && <span className="text-xs text-slate-400">All items placed</span>}
          {unplacedItems.map(it => <DraggableItem key={it.id} id={it.id} label={it.label} />)}
        </div>
      </div>
    </DndContext>
  )
}

function DroppableZone({ zone, item, onClear }: { zone: Zone; item?: { id: string; label: string }; onClear?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone::${zone.id}` })
  return (
    <div
      ref={setNodeRef}
      onClick={onClear}
      className={`absolute flex items-center justify-center text-center px-1 border-2 rounded ${isOver ? 'border-sky-500 bg-sky-50' : item ? 'border-emerald-400 bg-emerald-50 cursor-pointer' : 'border-dashed border-slate-400 bg-white/40'}`}
      style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}
      title={item ? 'Click to remove' : 'Drop here'}
    >
      {item && <MathText as="span" className="text-xs font-medium text-emerald-700 truncate" text={item.label} />}
    </div>
  )
}

function DraggableItem({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`px-3 py-1.5 rounded-lg border-2 border-sky-300 bg-sky-50 text-sky-700 text-sm font-medium cursor-grab active:cursor-grabbing touch-none select-none ${isDragging ? 'opacity-50 z-50 relative' : ''}`}
    >
      <MathText as="span" text={label} />
    </button>
  )
}
