"use client"

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { apiFetch } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'

const parentNav = [
  { label: 'Dashboard', href: '/parent', icon: 'dashboard' },
  { label: 'Attendance', href: '/parent/attendance', icon: 'calendar' },
  { label: 'Grades', href: '/parent/grades', icon: 'chart' },
  { label: 'Messages', href: '/parent/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'Fees', href: '/parent/fees', icon: 'money' },
  { label: 'Bus Tracker', href: '/parent/bus', icon: 'globe' },
]

interface Bus { id: string; licensePlate: string; driverName: string | null; status: string; capacity: number }
interface BusLocation { id: string; latitude: number; longitude: number; speed: number | null; timestamp: string }

// Dynamic import Leaflet map to avoid SSR issues
const LeafletMap = dynamic(() => import('./LeafletBusMap'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-slate-100 flex items-center justify-center rounded-xl">
    <p className="text-slate-400 text-sm">Loading map...</p>
  </div>
) })

const BUS_STATUS = {
  ACTIVE: { label: 'Active', color: 'bg-emerald-100 text-emerald-700' },
  INACTIVE: { label: 'Inactive', color: 'bg-slate-100 text-slate-600' },
  MAINTENANCE: { label: 'Maintenance', color: 'bg-amber-100 text-amber-700' },
}

export default function ParentBusPage() {
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null)

  const { data: buses = [] as Bus[] } = useQuery<Bus[]>({
    queryKey: ['buses-list'],
    queryFn: async () => { const r = await apiFetch('/api/bus'); if (!r.ok) throw new Error(); return r.json() },
  })

  const { data: location, isLoading: locationLoading } = useQuery<BusLocation>({
    queryKey: ['bus-location', selectedBusId],
    queryFn: async () => { const r = await apiFetch(`/api/bus/${selectedBusId}/location`); if (!r.ok) throw new Error(); return r.json() },
    enabled: !!selectedBusId,
    refetchInterval: 10000, // auto-refresh every 10s
  })

  const selectedBus = buses.find(b => b.id === selectedBusId)

  return (
    <AuthGuard requiredRole="PARENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Parent" subtitle="Portal" navItems={parentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        {/* Bus selector */}
        <aside className={`${selectedBusId ? 'hidden lg:flex' : 'flex'} w-full lg:w-60 bg-white border-r border-slate-200 flex-col`}>
          <div className="p-4 border-b border-slate-100">
            <Link href="/parent" className="text-xs text-emerald-600">← Back</Link>
            <p className="text-base font-bold text-slate-800 mt-2">🚌 School Bus Tracker</p>
            <p className="text-xs text-slate-400">Live GPS tracking</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Select Bus</p>
            {buses.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No buses registered</p>
            ) : (
              buses.map(bus => {
                const meta = BUS_STATUS[bus.status as keyof typeof BUS_STATUS] ?? BUS_STATUS.INACTIVE
                return (
                  <button key={bus.id} onClick={() => setSelectedBusId(bus.id)}
                    className={`w-full text-left p-3 rounded-xl mb-2 border-2 transition-all ${selectedBusId === bus.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-slate-800">{bus.licensePlate}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${meta.color}`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-slate-500">{bus.driverName ?? 'No driver assigned'}</p>
                    <p className="text-xs text-slate-400">Capacity: {bus.capacity}</p>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className={`${selectedBusId ? 'flex' : 'hidden lg:flex'} flex-1 flex-col`}>
          {!selectedBusId ? (
            <div className="flex-1 flex items-center justify-center bg-slate-50">
              <div className="text-center">
                <p className="text-5xl mb-4">🚌</p>
                <p className="text-slate-500 font-medium">Select a bus to track</p>
                <p className="text-slate-400 text-sm mt-1">Location updates every 10 seconds</p>
              </div>
            </div>
          ) : (
            <>
              {/* Info bar */}
              <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sticky top-0 z-10">
                <button onClick={() => setSelectedBusId(null)} className="lg:hidden w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 active:scale-95 transition-transform shrink-0" aria-label="Back">←</button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 truncate">Bus {selectedBus?.licensePlate}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {location
                      ? `Last updated: ${formatCambodiaTime(location.timestamp)}`
                      : locationLoading ? 'Fetching location...' : 'No location data'}
                  </p>
                </div>
                {location?.speed !== null && location?.speed !== undefined && (
                  <div className="text-right shrink-0">
                    <p className="text-xl sm:text-2xl font-bold text-slate-800">{Math.round(location.speed)}</p>
                    <p className="text-[10px] text-slate-400">km/h</p>
                  </div>
                )}
              </div>

              {/* Map */}
              <div className="flex-1 p-4">
                <div className="w-full h-full min-h-96 rounded-xl overflow-hidden shadow-sm border border-slate-200">
                  {location ? (
                    <LeafletMap lat={location.latitude} lng={location.longitude} label={selectedBus?.licensePlate ?? 'Bus'} />
                  ) : (
                    <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center rounded-xl">
                      {locationLoading ? (
                        <><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-slate-400 text-sm">Fetching GPS location...</p></>
                      ) : (
                        <><p className="text-4xl mb-3">📍</p>
                        <p className="text-slate-400">No location data available for this bus</p></>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
