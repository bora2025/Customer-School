"use client"

import Link from 'next/link'

/** Shared "Finance Dashboard" quick-nav link card — an icon-chip card that
 * links elsewhere, with a hover-lift and animated chevron. */
export default function QuickNavCard({
  href, title, sub, icon, color, iconColor,
}: {
  href: string
  title: string
  sub: string
  icon: React.ReactNode
  color: string
  iconColor: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-none ${color}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
      <svg className="w-5 h-5 text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
      </svg>
    </Link>
  )
}
