'use client';

import Link from 'next/link';
import AuthGuard from '../../../components/AuthGuard';
import PlatformBillingPanel from '../../../components/PlatformBillingPanel';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';

/**
 * The standalone platform bill. The same panel also renders live inside Licensing; this page stays
 * because it is open to ADMIN as well as SUPER_ADMIN, and because lib/api.ts sends every 402 here
 * while a school is suspended -- it is the one screen guaranteed to load in that state.
 */
export default function PlatformBillingPage() {
  // The shared page-shell layout, like every other admin page. This page used to be the one
  // exception: a plain block layout with an md:ml-72 offset, under which the Sidebar's sticky
  // h-screen <aside> stays in normal flow and pushes everything a full screen down -- so a
  // suspended school, sent here to recover, opened on nothing but the sidebar.
  return (
    <AuthGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header print:hidden">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-800">Platform billing</h1><p className="mt-1 text-sm text-slate-500">Wattanam service subscription—not student fee accounting.</p></div><Link className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold" href="/marketplace">Open marketplace account</Link></div>
          </div>
          <div className="page-body">
            <div className="mx-auto max-w-5xl"><PlatformBillingPanel variant="page" /></div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
