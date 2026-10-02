"use client"

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'

interface Bus { id: string; name: string; plateNumber: string; capacity: number; status: string; route: { id: string; name: string } | null }
interface Route { id: string; name: string; description: string | null; stops: Stop[] }
interface Stop { id: string; name: string; latitude: number; longitude: number; order: number }

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  MAINTENANCE: 'bg-amber-100 text-amber-700',
}

export default function BusAdminPage() {
  const [tab, setTab] = useState<'buses' | 'routes'>('buses')
  const [showBusForm, setShowBusForm] = useState(false)
  const [showRouteForm, setShowRouteForm] = useState(false)
  const qc = useQueryClient()

  const { data: buses = [], isLoading: busLoading, isError: busError, refetch: refetchBuses } = useQuery({
    queryKey: ['buses'],
    queryFn: async () => { const r = await apiFetch('/api/bus'); if (!r.ok) throw new Error(); return r.json() as Promise<Bus[]> },
  })
  const { data: routes = [], isLoading: routeLoading, refetch: refetchRoutes } = useQuery({
    queryKey: ['bus-routes'],
    queryFn: async () => { const r = await apiFetch('/api/bus/routes/all'); if (!r.ok) throw new Error(); return r.json() as Promise<Route[]> },
  })

  const deleteBus = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bus/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buses'] }),
  })
  const deleteRoute = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bus/routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bus-routes'] }),
  })

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 p-6 max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-slate-800">🚌 School Bus Tracking</h1>
            <div className="flex gap-2">
              <a href="/admin/bus/map" className="border border-sky-600 text-sky-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-50">
                Live Map
              </a>
              {tab === 'buses'
                ? <button onClick={() => setShowBusForm(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-700">+ Add Bus</button>
                : <button onClick={() => setShowRouteForm(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-700">+ Add Route</button>
              }
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200 mb-6">
            {(['buses', 'routes'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-sky-600 text-sky-600' : 'text-slate-500 hover:text-slate-700'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Buses Tab */}
          {tab === 'buses' && (
            busLoading ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white h-16 rounded-xl animate-pulse" />)}</div>
            : busError ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                <p className="text-red-600 mb-2">Failed to load buses</p>
                <button onClick={() => refetchBuses()} className="text-sm text-red-500 underline">Retry</button>
              </div>
            ) : buses.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                <p className="text-5xl mb-4">🚌</p>
                <p className="text-slate-400">No buses configured</p>
                <button onClick={() => setShowBusForm(true)} className="mt-4 text-sky-600 text-sm underline">Add first bus</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {buses.map(bus => (
                  <div key={bus.id} className="bg-white rounded-xl shadow-sm p-4 border border-slate-100">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-bold text-slate-800">{bus.name}</p>
                        <p className="text-sm text-slate-500">{bus.plateNumber}</p>
                        <p className="text-xs text-slate-400 mt-1">Capacity: {bus.capacity} seats</p>
                        {bus.route && <p className="text-xs text-sky-600 mt-1">Route: {bus.route.name}</p>}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[bus.status] ?? ''}`}>
                        {bus.status}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <a href={`/admin/bus/live/${bus.id}`} className="text-xs text-sky-600 hover:underline">Live</a>
                      <button onClick={() => { if (confirm('Delete bus?')) deleteBus.mutate(bus.id) }}
                        className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Routes Tab */}
          {tab === 'routes' && (
            routeLoading ? <div className="space-y-2">{[1,2].map(i => <div key={i} className="bg-white h-20 rounded-xl animate-pulse" />)}</div>
            : routes.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center shadow-sm">
                <p className="text-slate-400">No routes configured</p>
                <button onClick={() => setShowRouteForm(true)} className="mt-4 text-sky-600 text-sm underline">Add first route</button>
              </div>
            ) : (
              <div className="space-y-4">
                {routes.map(route => (
                  <div key={route.id} className="bg-white rounded-xl shadow-sm p-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-bold text-slate-800">{route.name}</p>
                        {route.description && <p className="text-sm text-slate-500">{route.description}</p>}
                      </div>
                      <button onClick={() => { if (confirm('Delete route?')) deleteRoute.mutate(route.id) }}
                        className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {route.stops.map((stop, i) => (
                        <span key={stop.id} className="text-xs bg-slate-100 px-2 py-1 rounded-full text-slate-600">
                          {i + 1}. {stop.name}
                        </span>
                      ))}
                      {route.stops.length === 0 && <span className="text-xs text-slate-400">No stops</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </main>

        {showBusForm && (
          <BusFormModal routes={routes} onClose={() => setShowBusForm(false)}
            onSuccess={() => { setShowBusForm(false); qc.invalidateQueries({ queryKey: ['buses'] }) }} />
        )}
        {showRouteForm && (
          <RouteFormModal onClose={() => setShowRouteForm(false)}
            onSuccess={() => { setShowRouteForm(false); qc.invalidateQueries({ queryKey: ['bus-routes'] }) }} />
        )}
      </div>
    </AuthGuard>
  )
}

function BusFormModal({ routes, onClose, onSuccess }: { routes: Route[]; onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm()
  const onSubmit = async (data: any) => {
    const res = await apiFetch('/api/bus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (res.ok) onSuccess()
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-bold mb-4">Add Bus</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <input {...register('name', { required: true })} placeholder="Bus name" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input {...register('plateNumber', { required: true })} placeholder="Plate number" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input type="number" {...register('capacity')} placeholder="Capacity" defaultValue={40} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <select {...register('routeId')} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">No route</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg font-medium disabled:opacity-60">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RouteFormModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm()
  const onSubmit = async (data: any) => {
    const res = await apiFetch('/api/bus/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (res.ok) onSuccess()
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-bold mb-4">Add Route</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <input {...register('name', { required: true })} placeholder="Route name" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input {...register('description')} placeholder="Description (optional)" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg font-medium disabled:opacity-60">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
