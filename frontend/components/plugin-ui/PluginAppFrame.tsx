"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import {
  createRateLimiter,
  parsePluginUiMessage,
  pluginDeviceId,
  pluginStorage,
  pluginUiAssetUrl,
  pluginUiPageQuery,
  PLUGIN_UI_MAX_SCAN_TEXT,
  PLUGIN_UI_PROTOCOL,
  type PluginUiActivity,
  type PluginUiDevice,
  type PluginUiTone,
} from "../../lib/plugin-ui-bridge";
import PluginFaceStation, { type FaceResult } from "./PluginFaceStation";

/**
 * A plugin-owned screen (`app` component). The plugin's signed ui/ document runs in a sandboxed
 * iframe WITHOUT allow-same-origin: an opaque origin with no access to school cookies, storage or
 * DOM, and (by its CSP) no network. Everything goes through this bridge, which only forwards calls
 * to the plugin's own API as the signed-in user. See lib/plugin-ui-bridge.ts and docs/plugin-ui-apps.md.
 *
 * Devices (`devices` = the page's declared `options.devices`): the screen never gets the camera or
 * the Geolocation API. This component runs the scanner on the school page and passes on only the
 * decoded text; a location fix is returned once per request. The face station (PluginFaceStation)
 * hands over face vectors only; Web NFC hands over card serial numbers; storage keeps small JSON values
 * on this device under a per-plugin key.
 *
 * Partners (`apis` = the page's declared `options.apis`): the screen may also call these plugins' APIs
 * and open their pages. Every request says which plugin's screen made it (X-Wattanam-Plugin-Screen);
 * a partner's route answers only if it lists this plugin as a caller.
 */
export default function PluginAppFrame({
  pluginId,
  pluginVersion,
  title,
  entry,
  params,
  height = "auto",
  minHeight = 320,
  devices = [],
  apis = [],
  permissions,
}: {
  pluginId: string;
  pluginVersion?: string;
  /** The user's granted permissions of this plugin; the screen reads them as context.permissions. */
  permissions?: string[];
  title?: string;
  entry: string;
  params: Record<string, string>;
  height?: "auto" | "fill";
  minHeight?: number;
  devices?: PluginUiDevice[];
  /** Partner plugins whose APIs and pages this screen may use. */
  apis?: string[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  // The screen reads the page's query once, at start-up; a different query restarts the screen.
  const search = useSearchParams()?.toString() || "";
  const [frameHeight, setFrameHeight] = useState(minHeight);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  // Station layout (full screen, like the staff attendance station). Its texts come from the
  // plugin as plain strings; the camera itself never leaves this page.
  const [station, setStation] = useState<{ title: string } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: PluginUiTone; message: string } | null>(null);
  const [activity, setActivity] = useState<{ title: string; items: PluginUiActivity[] }>({ title: "Scanned Today", items: [] });
  const [cameraReady, setCameraReady] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [stationLocation, setStationLocation] = useState("");
  // Latest fix from the station's location watch; location requests are answered from it while
  // it is fresh (a second, parallel lookup can fail on some browsers while a watch is running).
  const lastFix = useRef<{ latitude: number; longitude: number; accuracy: number; at: number } | null>(null);
  const allow = useMemo(() => createRateLimiter(), []);
  const src = pluginVersion ? pluginUiAssetUrl(pluginId, pluginVersion, entry) : null;
  const deviceKey = devices.join(",");
  const apiKey = apis.join(",");
  const permissionKey = permissions ? permissions.join(",") : null;
  const mayScan = devices.includes("scanner");
  const mayLocate = devices.includes("location");
  const mayIdentify = devices.includes("device-id");
  const mayFace = devices.includes("face");
  const mayNfc = devices.includes("nfc");
  const mayStore = devices.includes("storage");
  // The face station: open while the screen asked for it (its texts come from the plugin as plain strings).
  const [face, setFace] = useState<{ mode: "identify" | "enroll"; title: string; liveness: boolean; samples: number } | null>(null);
  // Web NFC (Chrome on Android): reading while on; the serial number of each card goes to the screen.
  const [nfcOn, setNfcOn] = useState(false);
  const nfcAbort = useRef<AbortController | null>(null);
  const stopNfc = useCallback(() => { nfcAbort.current?.abort(); nfcAbort.current = null; setNfcOn(false); }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    // The sandboxed document has an opaque origin, so "*" is the only possible target origin.
    // The message goes to this specific iframe's window object only.
    frame.current?.contentWindow?.postMessage({ protocol: PLUGIN_UI_PROTOCOL, ...message }, "*");
  }, []);

  useEffect(() => {
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const token = (name: string) => style.getPropertyValue(name).trim();
      return {
        primary: token("--color-primary"), primaryDark: token("--color-primary-dark"),
        text: token("--color-text"), textSecondary: token("--color-text-secondary"),
        border: token("--color-input-border"), background: token("--color-input-bg"),
        fontFamily: token("--font-inter"),
      };
    };
    const onMessage = async (event: MessageEvent) => {
      // Only messages from THIS frame; anything else on the page is ignored.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = parsePluginUiMessage(event.data);
      if (!message) return;
      if (message.type === "ready") {
        send({ type: "init", pluginId, pluginVersion, params, language: document.documentElement.lang || "en", theme: theme(), devices: deviceKey ? deviceKey.split(",") : [], query: pluginUiPageQuery(window.location.search), ...(permissionKey === null ? {} : { permissions: permissionKey ? permissionKey.split(",") : [] }) });
        return;
      }
      if (message.type === "resize") {
        if (height === "auto") setFrameHeight(Math.max(minHeight, message.height));
        return;
      }
      if (message.type === "navigate") {
        const search = message.query && Object.keys(message.query).length ? `?${new URLSearchParams(message.query).toString()}` : "";
        if (message.plugin && !apiKey.split(",").includes(message.plugin)) return;
        router.push(`/plugins/${encodeURIComponent(message.plugin || pluginId)}/${message.routePath}${search}`);
        return;
      }
      if (message.type === "scan-start") {
        if (!mayScan) { send({ type: "scan-error", message: "This screen has not declared the scanner." }); return; }
        setScanError("");
        setFeedback(null);
        setStation(message.layout === "station" ? { title: message.title || "Scan" } : null);
        setScanning(true);
        return;
      }
      if (message.type === "scan-stop") {
        setScanning(false);
        return;
      }
      if (message.type === "scan-feedback") {
        setFeedback(message.message ? { tone: message.tone, message: message.message } : null);
        return;
      }
      if (message.type === "scan-activity") {
        setActivity({ title: message.title || "Scanned Today", items: message.items });
        return;
      }
      if (message.type === "device-id") {
        if (!mayIdentify) { send({ type: "response", id: message.id, status: 403, body: { message: "This screen has not declared device-id." } }); return; }
        let storage: Storage | null = null;
        try { storage = window.localStorage; } catch { storage = null; }
        // a declared partner's identifier: devices registered with it stay registered (a moved screen)
        if (message.plugin && !apiKey.split(",").includes(message.plugin)) { send({ type: "response", id: message.id, status: 403, body: { message: `This screen has not declared the ${message.plugin} API.` } }); return; }
        const deviceId = pluginDeviceId(message.plugin || pluginId, storage, () => crypto.randomUUID());
        send(deviceId ? { type: "response", id: message.id, status: 200, body: { deviceId } } : { type: "response", id: message.id, status: 503, body: { message: "This browser does not keep a device identifier (private browsing?)." } });
        return;
      }
      if (message.type === "location") {
        if (!mayLocate) { send({ type: "response", id: message.id, status: 403, body: { message: "This screen has not declared location." } }); return; }
        if (!navigator.geolocation) { send({ type: "response", id: message.id, status: 503, body: { message: "Location is unavailable on this device." } }); return; }
        const fix = lastFix.current;
        if (fix && Date.now() - fix.at < 30000) { send({ type: "response", id: message.id, status: 200, body: { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } }); return; }
        navigator.geolocation.getCurrentPosition(
          (position) => send({ type: "response", id: message.id, status: 200, body: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } }),
          () => send({ type: "response", id: message.id, status: 403, body: { message: "Location permission was not granted." } }),
          { enableHighAccuracy: true, timeout: 10000 },
        );
        return;
      }
      if (message.type === "face-start") {
        if (!mayFace) { send({ type: "face-error", message: "This screen has not declared the face device." }); return; }
        setFeedback(null);
        setActivity({ title: "Today", items: [] });
        setFace({ mode: message.mode, title: message.title || (message.mode === "enroll" ? "Face enrolment" : "Face attendance"), liveness: message.liveness, samples: message.samples });
        return;
      }
      if (message.type === "face-stop") {
        setFace(null);
        send({ type: "face-closed" });
        return;
      }
      if (message.type === "nfc-start") {
        if (!mayNfc) { send({ type: "nfc-error", message: "This screen has not declared the nfc device." }); return; }
        const Reader = (window as any).NDEFReader;
        if (!Reader) { send({ type: "nfc-error", message: "This browser cannot read NFC cards: use Chrome on an Android phone, or a USB card reader." }); return; }
        nfcAbort.current?.abort();
        const controller = new AbortController();
        nfcAbort.current = controller;
        try {
          const reader = new Reader();
          reader.onreading = (event: { serialNumber?: string }) => {
            const serialNumber = String(event.serialNumber || "").slice(0, 100);
            if (serialNumber) send({ type: "nfc-result", serialNumber });
          };
          await reader.scan({ signal: controller.signal });
          setNfcOn(true);
        } catch (cause) {
          nfcAbort.current = null;
          send({ type: "nfc-error", message: cause instanceof Error && cause.message ? cause.message : "NFC permission was not granted." });
        }
        return;
      }
      if (message.type === "nfc-stop") {
        stopNfc();
        send({ type: "nfc-closed" });
        return;
      }
      if (message.type === "storage") {
        if (!mayStore) { send({ type: "response", id: message.id, status: 403, body: { message: "This screen has not declared storage." } }); return; }
        let storage: Storage | null = null;
        try { storage = window.localStorage; } catch { storage = null; }
        const answer = pluginStorage(pluginId, storage, message.op, message.key, message.value);
        send({ type: "response", id: message.id, status: answer.status, body: answer.body });
        return;
      }
      if (!allow()) {
        send({ type: "response", id: message.id, status: 429, body: { message: "Too many requests from this screen" } });
        return;
      }
      if (message.plugin && !apiKey.split(",").includes(message.plugin)) {
        send({ type: "response", id: message.id, status: 403, body: { message: `This screen has not declared the ${message.plugin} API.` } });
        return;
      }
      const query = message.query ? `?${new URLSearchParams(message.query).toString()}` : "";
      try {
        const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(message.plugin || pluginId)}/${message.path}${query}`, {
          method: message.method,
          headers: { ...(message.body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Wattanam-Plugin-Screen": pluginId },
          body: message.body !== undefined ? JSON.stringify(message.body) : undefined,
        });
        const text = await response.text();
        let body: unknown = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = { message: "The plugin returned a non-JSON response" }; }
        send({ type: "response", id: message.id, status: response.status, body });
      } catch {
        send({ type: "response", id: message.id, status: 0, body: { message: "Network error" } });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allow, apiKey, deviceKey, permissionKey, height, mayFace, mayIdentify, mayLocate, mayNfc, mayScan, mayStore, minHeight, params, pluginId, pluginVersion, router, send, stopNfc]);

  // NFC stops when the screen goes away.
  useEffect(() => () => { nfcAbort.current?.abort(); }, []);

  useEffect(() => {
    if (!scanning || !station) return;
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    let watch: number | null = null;
    if (mayLocate && navigator.geolocation) {
      setStationLocation("Requesting location…");
      watch = navigator.geolocation.watchPosition(
        (position) => {
          lastFix.current = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, at: Date.now() };
          setStationLocation(`Location active · ±${Math.round(position.coords.accuracy)} m`);
        },
        () => setStationLocation("Location permission not granted"),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
      );
    }
    return () => { window.clearInterval(timer); if (watch !== null) navigator.geolocation.clearWatch(watch); lastFix.current = null; };
  }, [scanning, station, mayLocate]);

  // The scanner runs here, on the school page. The camera stream stays in this document; the
  // screen is told only the text of each decoded code.
  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let reader: { reset(): void } | null = null;
    let last = { text: "", at: 0 };
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/library");
        if (stopped || !video.current) return;
        const instance = new BrowserMultiFormatReader();
        reader = instance;
        setCameraReady(false);
        await instance.decodeFromVideoDevice(null, video.current, (result) => {
          if (!stopped) setCameraReady(true);
          if (stopped || !result) return;
          const text = result.getText().slice(0, PLUGIN_UI_MAX_SCAN_TEXT);
          const now = Date.now();
          // The camera reports the same code many times a second while it stays in view.
          if (text === last.text && now - last.at < 1500) return;
          last = { text, at: now };
          send({ type: "scan-result", text });
        });
      } catch (cause) {
        if (stopped) return;
        const message = cause instanceof Error && cause.message ? cause.message : "Camera permission was not granted.";
        setScanError(message);
        send({ type: "scan-error", message });
      }
    })();
    return () => {
      stopped = true;
      reader?.reset();
      setCameraReady(false);
      send({ type: "scan-closed" });
    };
  }, [scanning, send]);

  if (!src) {
    return <section className="card p-5 text-sm text-slate-500">This screen needs a newer school core to show {title || "this plugin screen"}.</section>;
  }
  const toneClass = (tone: PluginUiTone) => tone === "success" ? "bg-emerald-600 text-white" : tone === "error" ? "bg-rose-700 text-white" : tone === "warning" ? "bg-amber-500 text-slate-950" : "bg-sky-700 text-white";
  const markClass = (tone: PluginUiTone) => tone === "success" ? "bg-emerald-600" : tone === "error" ? "bg-rose-700" : tone === "warning" ? "bg-amber-500 text-slate-950" : "bg-sky-700";
  const lineClass = (tone: PluginUiTone) => tone === "success" ? "text-emerald-300" : tone === "error" ? "text-rose-300" : tone === "warning" ? "text-amber-300" : "text-sky-300";
  return (
    <section className="card overflow-hidden p-0">
      {face && (
        <PluginFaceStation
          title={face.title} mode={face.mode} liveness={face.liveness} samples={face.samples}
          feedback={feedback} activity={activity}
          onResult={(result: FaceResult) => send({ type: "face-result", result })}
          onError={(message) => { setFace(null); send({ type: "face-error", message }); }}
          onClose={() => { setFace(null); send({ type: "face-closed" }); }}
        />
      )}
      {nfcOn && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-indigo-950 p-3 text-white" data-plugin-nfc>
          <p className="text-sm font-semibold">📶 NFC on <span className="font-normal text-indigo-200">· hold a card to the back of this phone</span></p>
          <button type="button" onClick={() => { stopNfc(); send({ type: "nfc-closed" }); }} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-900">Stop NFC</button>
        </div>
      )}
      {scanning && station && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white" data-plugin-scanner data-plugin-station>
          <header className="flex items-center gap-5 border-b border-slate-700 bg-slate-800 px-5 py-4">
            <button type="button" onClick={() => setScanning(false)} className="font-bold">‹ Back</button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-extrabold">📷 {station.title}</h2>
              {stationLocation && <p className="text-xs text-slate-400">{stationLocation}</p>}
            </div>
            <strong className="font-mono text-xl">{clock.toLocaleTimeString()}</strong>
          </header>
          <div className="flex min-h-0 flex-1">
            <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center">
              {scanError ? (
                <p role="alert" className="mx-6 rounded-xl bg-rose-700 px-5 py-3 font-semibold">{scanError}</p>
              ) : (
                <>
                  <video ref={video} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
                  <div className="pointer-events-none relative h-64 w-64 rounded-3xl border-4 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,.55)]" />
                  <p className={`relative mt-6 max-w-[90%] rounded-full px-6 py-3 text-center font-bold shadow-lg ${feedback ? toneClass(feedback.tone) : "bg-emerald-600/90"}`} role="status" aria-live="polite">
                    {feedback ? feedback.message : cameraReady ? "Camera ready — scan the QR code" : "Starting camera…"}
                  </p>
                </>
              )}
            </main>
            <aside className="hidden w-80 overflow-y-auto border-l border-slate-700 bg-slate-800 p-5 md:block">
              <div className="flex items-center justify-between">
                <h3 className="font-bold">{activity.title}</h3>
                <span className="rounded-full bg-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300">{activity.items.length}</span>
              </div>
              <div className="mt-5 space-y-3">
                {activity.items.map((item, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${markClass(item.tone)}`}>{item.initials || (item.tone === "success" ? "✓" : item.tone === "error" ? "✕" : "!")}</span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{item.title}</strong>
                      {item.detail && <span className={`mt-1 block text-xs font-medium ${lineClass(item.tone)}`}>{item.detail}</span>}
                    </div>
                  </div>
                ))}
                {!activity.items.length && <p className="pt-32 text-center text-sm text-slate-500">📋<br />No scans yet</p>}
              </div>
            </aside>
          </div>
        </div>
      )}
      {scanning && !station && (
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-950 p-3 text-white" data-plugin-scanner>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Camera scanner <span className="font-normal text-slate-300">· point the camera at a QR code</span></p>
            <button type="button" onClick={() => setScanning(false)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-900">Close camera</button>
          </div>
          {scanError ? (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{scanError}</p>
          ) : (
            <video ref={video} muted playsInline className="mx-auto max-h-[45vh] w-full max-w-xl rounded-lg bg-black object-cover" />
          )}
        </div>
      )}
      <iframe
        key={search}
        ref={frame}
        title={title || `${pluginId} screen`}
        src={src}
        sandbox="allow-scripts allow-forms allow-modals allow-downloads"
        referrerPolicy="no-referrer"
        className="block w-full border-0"
        style={{ height: height === "fill" ? "calc(100vh - 12rem)" : frameHeight, minHeight }}
      />
    </section>
  );
}
