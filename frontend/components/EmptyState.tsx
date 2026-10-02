"use client"

/** Shared friendly empty-state block — generalized from admin/budget-report's
 * muted-icon pattern and the course grading page's emoji pattern (the two
 * best-looking empty states found in the app). Accepts either an emoji string
 * or an SVG node as `icon`. */
export default function EmptyState({
  icon, title, message, action, className = '',
}: {
  icon?: React.ReactNode
  title?: string
  message: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      {icon && <div className="mb-3 text-4xl text-gray-300 flex items-center justify-center">{icon}</div>}
      {title && <p className="text-sm font-semibold text-gray-700 mb-1">{title}</p>}
      <p className="text-sm text-gray-400">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
