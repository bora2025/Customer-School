"use client"

import { useEffect, useId, useRef } from 'react'

/** Shared confirm dialog — replaces native browser confirm() popups with a
 * modal consistent with the rest of the app's UI. */
export default function ConfirmModal({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, pending, onConfirm, onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  // Cancel is focused first, not Confirm -- so a stray Enter keypress right after
  // the dialog opens (e.g. from whatever triggered it) can't accidentally confirm
  // a destructive action.
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return }
      // Trap Tab between the two buttons -- this dialog never has more than these.
      if (e.key === 'Tab') {
        e.preventDefault()
        if (document.activeElement === cancelRef.current) confirmRef.current?.focus()
        else cancelRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 id={titleId} className="text-lg font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button ref={cancelRef} onClick={onCancel} className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={pending}
            className={`px-4 py-2 text-sm font-semibold rounded-xl text-white disabled:opacity-60 shadow-sm ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {pending ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
