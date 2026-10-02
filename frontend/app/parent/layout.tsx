import type { Metadata } from 'next'
import '../styles.css'
import Providers from '../providers'

export const metadata: Metadata = { title: 'Parent Portal' }

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
