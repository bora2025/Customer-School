'use client';

import { BrowserMultiFormatReader } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { resolvePluginSourcePath } from '../../lib/plugin-ui-routing';

type QueueItem = { id: string; endpoint: string; method: string; payload: Record<string, unknown>; attempts: number; nextAttemptAt: number; createdAt: string };
const DB_NAME = 'wattanam-attendance';
const STORE = 'pending-scans';

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queuePut(item: QueueItem) { const db = await openQueue(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(item); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close(); }
async function queueDelete(id: string) { const db = await openQueue(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close(); }
async function queueAll(): Promise<QueueItem[]> { const db = await openQueue(); const rows = await new Promise<QueueItem[]>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); return rows; }

function deviceId() {
  const key = 'wattanam-attendance-device-id';
  let value = localStorage.getItem(key);
  if (!value) { value = globalThis.crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

function networkQuality() {
  if (!navigator.onLine) return 'OFFLINE';
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  return connection?.effectiveType?.includes('2g') || (connection?.downlink ?? 10) < 1 ? 'SLOW' : 'ONLINE';
}

export default function PluginSelfAttendanceScanner({ pluginId, source, params, options, onSuccess }: any) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const processingRef = useRef(false);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState('');
  const [message, setMessage] = useState('Ready to scan');
  const [tone, setTone] = useState<'idle' | 'success' | 'warning' | 'danger'>('idle');
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [torchOn, setTorchOn] = useState(false);

  function beep(success: boolean) {
    try { const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AudioContextClass) return; const audio = new AudioContextClass(); const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.frequency.value = success ? 880 : 220; gain.gain.value = 0.06; oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + (success ? 0.12 : 0.22)); oscillator.onended = () => void audio.close(); } catch { /* Audio feedback is optional. */ }
  }

  const refreshPending = useCallback(async () => setPending((await queueAll()).length), []);
  const syncQueue = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      const rows = (await queueAll()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const row of rows) {
        if (row.nextAttemptAt > Date.now()) continue;
        try {
          const response = await apiFetch(row.endpoint, { method: row.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row.payload, networkQuality: networkQuality() }) });
          const result = await response.json().catch(() => ({}));
          if (response.ok) { await queueDelete(row.id); setMessage(result.idempotentReplay ? 'Attendance already recorded' : 'Attendance synchronized'); setTone('success'); await onSuccess(); }
          else if (response.status >= 400 && response.status < 500) { await queueDelete(row.id); setMessage(result.message || 'Saved scan was rejected'); setTone('danger'); }
          else throw new Error('Temporary server error');
        } catch {
          const attempts = row.attempts + 1;
          await queuePut({ ...row, attempts, nextAttemptAt: Date.now() + Math.min(60000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 750) });
        }
      }
    } finally { setSyncing(false); await refreshPending(); }
  }, [onSuccess, refreshPending, syncing]);

  useEffect(() => { setOnline(navigator.onLine); void refreshPending().then(syncQueue); const connected = () => { setOnline(true); void syncQueue(); }; const disconnected = () => setOnline(false); window.addEventListener('online', connected); window.addEventListener('offline', disconnected); const timer = window.setInterval(() => void syncQueue(), 15000); return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); window.clearInterval(timer); readerRef.current?.reset(); }; }, [refreshPending, syncQueue]);

  const submit = useCallback(async (raw: string, mode: 'CAMERA' | 'USB') => {
    const token = raw.trim();
    if (processingRef.current || token.length < (options.minLength || 1) || token.length > (options.maxLength || 1000)) return;
    processingRef.current = true;
    const id = globalThis.crypto.randomUUID();
    const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(source.path, params)}`;
    const payload: Record<string, unknown> = { [options.field]: token, deviceId: deviceId(), mode, clientTimestamp: new Date().toISOString(), idempotencyKey: id, networkQuality: networkQuality() };
    if ('geolocation' in navigator) await new Promise<void>((resolve) => navigator.geolocation.getCurrentPosition((position) => { payload.latitude = position.coords.latitude; payload.longitude = position.coords.longitude; payload.accuracyMeters = position.coords.accuracy; resolve(); }, () => resolve(), { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }));
    const item: QueueItem = { id, endpoint, method: source.method, payload, attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString() };
    try {
      await queuePut(item);
      await refreshPending();
      if (!navigator.onLine) { setMessage('SAVED OFFLINE — it will sync automatically'); setTone('warning'); navigator.vibrate?.([100, 60, 100]); return; }
      const response = await apiFetch(endpoint, { method: source.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) await queueDelete(id);
        throw new Error(result.message || 'Attendance rejected');
      }
      await queueDelete(id); await refreshPending(); setMessage(result.idempotentReplay ? 'Attendance already recorded' : 'Attendance recorded'); setTone('success'); beep(true); navigator.vibrate?.(180); setManual(''); await onSuccess();
    } catch (cause) {
      if (!navigator.onLine || cause instanceof TypeError) { setMessage('SAVED OFFLINE — it will sync automatically'); setTone('warning'); }
      else { setMessage(cause instanceof Error ? cause.message : 'Attendance rejected'); setTone('danger'); beep(false); navigator.vibrate?.([250, 100, 250]); }
    } finally { processingRef.current = false; }
  }, [options.field, options.maxLength, options.minLength, params, pluginId, refreshPending, source.method, source.path, onSuccess]);

  async function startCamera(deviceId?: string) {
    if (!videoRef.current) return;
    try { readerRef.current?.reset(); const reader = new BrowserMultiFormatReader(); readerRef.current = reader; setCamera(true); setTorchOn(false); setMessage('Camera ready — scan the attendance QR code'); setTone('idle'); await reader.decodeFromConstraints({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }, audio: false }, videoRef.current, (result) => { if (result) void submit(result.getText(), 'CAMERA'); }); const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput'); setCameras(devices); if (deviceId) setCameraIndex(Math.max(0, devices.findIndex((device) => device.deviceId === deviceId))); }
    catch (cause) { setCamera(false); setMessage(cause instanceof Error ? cause.message : 'Camera unavailable'); setTone('danger'); }
  }
  function stopCamera() { readerRef.current?.reset(); readerRef.current = null; setCamera(false); setTorchOn(false); }
  async function switchCamera() { if (cameras.length < 2) return; const next = (cameraIndex + 1) % cameras.length; setCameraIndex(next); await startCamera(cameras[next].deviceId); }
  async function toggleTorch() { const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]; if (!track) return; try { const next = !torchOn; await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setMessage('Flashlight is not supported by this camera'); setTone('warning'); } }

  const colors = tone === 'success' ? 'bg-emerald-600' : tone === 'warning' ? 'bg-amber-500' : tone === 'danger' ? 'bg-rose-600' : 'bg-slate-700';
  return <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-xl">
    <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4"><div><h2 className="text-lg font-bold">Student Self-Attendance</h2><p className="text-xs text-slate-300">Signed QR verification · automatic GPS and device identity</p></div><span className={`rounded-full px-3 py-1 text-xs ${online ? 'bg-emerald-700' : 'bg-amber-600'}`}>{online ? 'Online' : 'Offline'} · {pending} pending</span></header>
    <div className="relative min-h-[320px] bg-black"><video ref={videoRef} className={`h-[55vh] max-h-[560px] min-h-[320px] w-full object-cover ${camera ? '' : 'hidden'}`} muted playsInline />{!camera && <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center"><div className="text-6xl">▣</div><p className="text-xl font-semibold">Scan your classroom QR</p><button className="btn btn-primary" onClick={() => void startCamera()}>Open camera</button></div>}{camera && <div className="absolute right-4 top-4 flex gap-2">{cameras.length > 1 && <button className="rounded-full bg-slate-800/90 px-4 py-3 font-bold" onClick={() => void switchCamera()} aria-label="Switch camera">↻</button>}<button className={`rounded-full px-4 py-3 font-bold ${torchOn ? 'bg-amber-500' : 'bg-slate-800/90'}`} onClick={() => void toggleTorch()} aria-label="Toggle flashlight">⚡</button><button className="rounded-full bg-rose-600 px-4 py-3 font-bold" onClick={stopCamera} aria-label="Close camera">✕</button></div>}</div>
    <div className={`${colors} px-5 py-4 text-center font-semibold`} role="status" aria-live="assertive">{message}</div>
    <form className="flex gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void submit(manual, 'USB'); }}><input className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="USB scanner or token" autoComplete="off" /><button className="btn btn-primary">Submit</button><button type="button" className="btn btn-secondary" disabled={!pending || syncing} onClick={() => void syncQueue()}>{syncing ? 'Syncing…' : 'Sync now'}</button></form>
  </section>;
}
