import { apiFetch } from './api'

export interface QueuedAttendanceScan {
  id: string
  qrData: string
  scannedAt: string
  latitude?: number
  longitude?: number
  location?: string
  queuedAt: string
}

const DB_NAME = 'wattaman-offline'
const DB_VERSION = 1
const STORE = 'attendance-scans'
let flushPromise: Promise<{ synced: number; pending: number }> | null = null

export type NetworkInformationLike = {
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

export interface AttendanceNetworkQuality {
  level: 'GOOD' | 'FAIR' | 'POOR' | 'OFFLINE' | 'UNKNOWN'
  label: string
  detail: string
  effectiveType?: string
  downlink?: number
  rtt?: number
}

export function classifyAttendanceNetwork(
  online: boolean,
  connection?: NetworkInformationLike,
): AttendanceNetworkQuality {
  if (!online) {
    return { level: 'OFFLINE', label: 'Offline', detail: 'Scans save safely on this device' }
  }
  if (!connection) {
    return { level: 'UNKNOWN', label: 'Internet connected', detail: 'Speed details unavailable' }
  }
  const effectiveType = connection.effectiveType
  const downlink = connection.downlink
  const rtt = connection.rtt
  const metrics = [
    effectiveType ? effectiveType.toUpperCase() : '',
    typeof downlink === 'number' && downlink > 0 ? `${downlink.toFixed(1)} Mbps` : '',
    typeof rtt === 'number' && rtt > 0 ? `${Math.round(rtt)} ms` : '',
  ].filter(Boolean).join(' · ')
  const verySlowType = effectiveType === 'slow-2g' || effectiveType === '2g'
  const veryHighLatency = typeof rtt === 'number' && rtt >= 1500
  const veryLowBandwidth = typeof downlink === 'number' && downlink > 0 && downlink < 0.35
  if (connection.saveData) {
    return { level: 'POOR', label: 'Data saver active', detail: metrics || 'Scans save locally', effectiveType, downlink, rtt }
  }
  if (verySlowType || veryHighLatency || veryLowBandwidth) {
    return { level: 'POOR', label: 'Internet poor', detail: metrics || 'Scans save locally', effectiveType, downlink, rtt }
  }
  const fair = effectiveType === '3g'
    || (typeof rtt === 'number' && rtt >= 500)
    || (typeof downlink === 'number' && downlink > 0 && downlink < 1.5)
  return {
    level: fair ? 'FAIR' : 'GOOD',
    label: fair ? 'Internet fair' : 'Internet good',
    detail: metrics || 'Connected',
    effectiveType,
    downlink,
    rtt,
  }
}

export function getAttendanceNetworkQuality(): AttendanceNetworkQuality {
  if (typeof navigator === 'undefined') return classifyAttendanceNetwork(false)
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  return classifyAttendanceNetwork(navigator.onLine, connection)
}

export function subscribeAttendanceNetwork(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  connection?.addEventListener?.('change', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
    connection?.removeEventListener?.('change', listener)
  }
}

/**
 * OFFLINE: no browser connectivity at all.
 * CONSTRAINED: connected, but sending synchronously would block the scan line.
 * ONLINE: suitable for an immediate API attempt.
 */
export function getAttendanceNetworkMode(): 'OFFLINE' | 'CONSTRAINED' | 'ONLINE' {
  if (typeof navigator === 'undefined' || !navigator.onLine) return 'OFFLINE'
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (!connection) return 'ONLINE'
  return classifyAttendanceNetwork(true, connection).level === 'POOR' ? 'CONSTRAINED' : 'ONLINE'
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = run(transaction.objectStore(STORE))
    let result: T
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => {
      db.close()
      resolve(result)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error('Attendance storage transaction was aborted'))
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Attendance storage transaction failed'))
    }
  })
}

export async function queueAttendanceScan(
  scan: Omit<QueuedAttendanceScan, 'id' | 'queuedAt'>,
): Promise<QueuedAttendanceScan> {
  // Timestamp + QR makes repeated retries of the same captured scan idempotent in the queue.
  const item: QueuedAttendanceScan = {
    ...scan,
    id: `${scan.scannedAt}:${scan.qrData}`,
    queuedAt: new Date().toISOString(),
  }
  await withStore('readwrite', store => store.put(item))
  const persisted = await withStore<QueuedAttendanceScan | undefined>('readonly', store => store.get(item.id))
  if (!persisted || persisted.scannedAt !== item.scannedAt || persisted.qrData !== item.qrData) {
    throw new Error('Attendance scan could not be verified in offline storage')
  }
  return item
}

export async function getQueuedAttendanceCount(): Promise<number> {
  return withStore('readonly', store => store.count())
}

async function performFlush(): Promise<{ synced: number; pending: number }> {
  if (getAttendanceNetworkMode() !== 'ONLINE') {
    return { synced: 0, pending: await getQueuedAttendanceCount() }
  }
  const items = await withStore<QueuedAttendanceScan[]>('readonly', store => store.getAll())
  items.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))
  let synced = 0

  for (const item of items) {
    try {
      const response = await apiFetch('/api/attendance/wattaman/scan', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData: item.qrData,
          scannedAt: item.scannedAt,
          ...(item.latitude != null ? { latitude: item.latitude } : {}),
          ...(item.longitude != null ? { longitude: item.longitude } : {}),
          ...(item.location ? { location: item.location } : {}),
        }),
      })
      if (!response.ok) break
      await withStore('readwrite', store => store.delete(item.id))
      synced++
    } catch {
      break
    }
  }
  return { synced, pending: await getQueuedAttendanceCount() }
}

export function flushAttendanceQueue(): Promise<{ synced: number; pending: number }> {
  if (flushPromise) return flushPromise
  flushPromise = performFlush().finally(() => { flushPromise = null })
  return flushPromise
}
