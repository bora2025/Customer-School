'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { pluginLabel } from '../../../lib/plugin-search';
import { ROLE_INFO } from '../../../lib/workspace-nav';

interface PermissionExtension { pluginId: string; id: string; label: string; description?: string; roles?: string[] }
interface Grant { pluginId: string; permissionId: string; role: string }

// The roles a plugin permission can be given to (SUPER_ADMIN always has everything).
const ROLES = ['WATTAMAN', 'RECEPTIONIST', 'ADMIN', 'TEACHER', 'CLASS_ADMIN', 'STUDENT', 'PARENT', 'SCHOOL_ADMIN', 'WATTAMAN_REPORTER', 'ACCOUNTER'];
const OTHER_ROLE_INFO: Record<string, { label: string; kh: string; description: string }> = {
  CLASS_ADMIN: { label: 'Class admin', kh: 'អ្នកគ្រប់គ្រងថ្នាក់', description: 'Manages the classes assigned to them.' },
  STUDENT: { label: 'Student', kh: 'សិស្ស', description: 'Their own records.' },
  PARENT: { label: 'Parent', kh: 'មាតាបិតា', description: 'Their children\'s records.' },
  SCHOOL_ADMIN: { label: 'School admin', kh: 'អ្នកគ្រប់គ្រងសាលា', description: 'Like Admin, for a school in a group.' },
  WATTAMAN_REPORTER: { label: 'Attendance reporter', kh: 'អ្នករាយការណ៍វត្តមាន', description: 'Views and prints attendance reports.' },
  ACCOUNTER: { label: 'Accountant', kh: 'គណនេយ្យករ', description: 'Finance features.' },
};
const info = (role: string) => ROLE_INFO[role] || OTHER_ROLE_INFO[role] || { label: role, kh: '', description: '' };

/** Roles & access: which plugin permissions each role holds. Super administrators only. */
export default function RolesPage() {
  return (
    <AuthGuard requiredRole="SUPER_ADMIN">
      <RolesAndAccess />
    </AuthGuard>
  );
}

function RolesAndAccess() {
  const [permissions, setPermissions] = useState<PermissionExtension[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [role, setRole] = useState('RECEPTIONIST');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showAllRoles, setShowAllRoles] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch('/api/plugin-api/extensions');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'Could not load the plugin permissions');
      const list: PermissionExtension[] = Array.isArray(body?.permissions) ? body.permissions : [];
      setPermissions(list);
      const plugins = [...new Set(list.map((p) => p.pluginId))];
      const all = await Promise.all(plugins.map(async (pluginId) => {
        const res = await apiFetch(`/api/plugins/${encodeURIComponent(pluginId)}/permission-grants`);
        return res.ok ? ((await res.json()) as Grant[]) : [];
      }));
      setGrants(all.flat());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load roles'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const has = (permission: PermissionExtension, r = role) => grants.some((g) => g.pluginId === permission.pluginId && g.permissionId === permission.id && g.role === r);
  const byPlugin = useMemo(() => {
    const map = new Map<string, PermissionExtension[]>();
    permissions.forEach((p) => { if (!map.has(p.pluginId)) map.set(p.pluginId, []); map.get(p.pluginId)!.push(p); });
    return [...map.entries()];
  }, [permissions]);
  const suggested = permissions.filter((p) => p.roles?.includes(role));
  const missing = suggested.filter((p) => !has(p));
  const countFor = (r: string) => permissions.filter((p) => has(p, r)).length;

  async function setGrant(permission: PermissionExtension, on: boolean) {
    const key = `${permission.pluginId}:${permission.id}`;
    setBusy(key); setError(''); setMessage('');
    try {
      const response = on
        ? await apiFetch(`/api/plugins/${encodeURIComponent(permission.pluginId)}/permission-grants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionId: permission.id, role }) })
        : await apiFetch(`/api/plugins/${encodeURIComponent(permission.pluginId)}/permission-grants/${encodeURIComponent(permission.id)}/${encodeURIComponent(role)}`, { method: 'DELETE' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.message || 'Could not change the permission'); }
      setGrants((current) => on
        ? [...current, { pluginId: permission.pluginId, permissionId: permission.id, role }]
        : current.filter((g) => !(g.pluginId === permission.pluginId && g.permissionId === permission.id && g.role === role)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change the permission'); }
    finally { setBusy(''); }
  }
  async function applySuggested() {
    setBusy('suggested'); setError(''); setMessage('');
    try {
      for (const permission of missing) {
        const response = await apiFetch(`/api/plugins/${encodeURIComponent(permission.pluginId)}/permission-grants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionId: permission.id, role }) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.message || `Could not grant ${permission.label}`); }
        setGrants((current) => [...current, { pluginId: permission.pluginId, permissionId: permission.id, role }]);
      }
      setMessage(`${info(role).label} now has the ${missing.length} suggested permission${missing.length === 1 ? '' : 's'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the suggestions'); }
    finally { setBusy(''); }
  }

  const visibleRoles = showAllRoles ? ROLES : ROLES.slice(0, 6);
  const current = info(role);
  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanam Core" navItems={adminNav} accentColor="indigo" />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <header className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">Roles &amp; access</h1>
          <p className="mt-1 text-sm text-slate-500">Choose what each role can open and do in your plugins. Super admins always have everything.</p>
        </header>
        <div className="page-body space-y-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Roles">
            {visibleRoles.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => { setRole(r); setMessage(''); }}
                className={`rounded-2xl px-4 py-2 text-left transition ${role === r ? 'bg-indigo-600 text-white shadow' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-indigo-300'}`}>
                <span className="block text-sm font-bold">{info(r).label}</span>
                <span className={`block text-xs ${role === r ? 'text-indigo-100' : 'text-slate-400'}`}>{info(r).kh ? `${info(r).kh} · ` : ''}{loading ? '…' : `${countFor(r)} on`}</span>
              </button>
            ))}
            <button type="button" onClick={() => setShowAllRoles((v) => !v)} className="rounded-2xl px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">{showAllRoles ? 'Fewer roles' : 'More roles'}</button>
          </div>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h2 className="text-lg font-bold text-slate-800">{current.label}{current.kh ? <span className="ml-2 text-base font-semibold text-slate-400">{current.kh}</span> : null}</h2>
                {current.description && <p className="mt-1 text-sm text-slate-500">{current.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {suggested.length > 0 && (
                  <button type="button" className="btn btn-primary" disabled={!missing.length || busy !== ''} onClick={applySuggested}>
                    {missing.length ? `Apply ${missing.length} suggested` : '✓ Suggested applied'}
                  </button>
                )}
                {['WATTAMAN', 'RECEPTIONIST'].includes(role) && <Link href="/admin/users" className="btn btn-secondary">Create a {current.label} account</Link>}
              </div>
            </div>
            {message && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{message}</p>}
            {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</p>}
          </section>

          {loading ? <div className="card h-48 animate-pulse bg-slate-50" /> : byPlugin.length === 0 ? (
            <div className="card p-6 text-sm text-slate-500">No active plugin declares permissions yet. Install and activate plugins on Marketplace &amp; Plugins.</div>
          ) : byPlugin.map(([pluginId, list]) => (
            <section key={pluginId} className="card overflow-hidden" aria-label={pluginLabel(pluginId)}>
              <h2 className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-700">{pluginLabel(pluginId)} <span className="font-normal text-slate-400">· {list.filter((p) => has(p)).length} of {list.length} on</span></h2>
              <ul className="divide-y divide-slate-100">
                {list.map((permission) => {
                  const on = has(permission), key = `${permission.pluginId}:${permission.id}`, isSuggested = permission.roles?.includes(role);
                  return (
                    <li key={key} className="flex items-center gap-4 px-5 py-3" data-permission={permission.id}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">{permission.label}{isSuggested && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600">Suggested</span>}</p>
                        {permission.description && <p className="mt-0.5 text-xs text-slate-500">{permission.description}</p>}
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">{permission.id}</p>
                      </div>
                      <button type="button" role="switch" aria-checked={on} aria-label={`${permission.label} for ${current.label}`} disabled={busy !== ''} onClick={() => setGrant(permission, !on)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-slate-300'} ${busy === key ? 'opacity-60' : ''}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
