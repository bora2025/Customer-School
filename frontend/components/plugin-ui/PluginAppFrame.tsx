"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import {
  createRateLimiter,
  parsePluginUiMessage,
  pluginUiAssetUrl,
  pluginUiPageQuery,
  PLUGIN_UI_MAX_SCAN_TEXT,
  PLUGIN_UI_PROTOCOL,
  type PluginUiDevice,
} from "../../lib/plugin-ui-bridge";

/**
 * A plugin-owned screen (`app` component). The plugin's signed ui/ document runs in a sandboxed
 * iframe WITHOUT allow-same-origin: an opaque origin with no access to school cookies, storage or
 * DOM, and (by its CSP) no network. Everything goes through this bridge, which only forwards calls
 * to the plugin's own API as the signed-in user. See lib/plugin-ui-bridge.ts and docs/plugin-ui-apps.md.
 *
 * Devices (`devices` = the page's declared `options.devices`): the screen never gets the camera or
 * the Geolocation API. This component runs the scanner on the school page and passes on only the
 * decoded text; a location fix is returned once per request.
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
}: {
  pluginId: string;
  pluginVersion?: string;
  title?: string;
  entry: string;
  params: Record<string, string>;
  height?: "auto" | "fill";
  minHeight?: number;
  devices?: PluginUiDevice[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  // The screen reads the page's query once, at start-up; a different query restarts the screen.
  const search = useSearchParams()?.toString() || "";
  const [frameHeight, setFrameHeight] = useState(minHeight);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const allow = useMemo(() => createRateLimiter(), []);
  const src = pluginVersion ? pluginUiAssetUrl(pluginId, pluginVersion, entry) : null;
  const deviceKey = devices.join(",");
  const mayScan = devices.includes("scanner");
  const mayLocate = devices.includes("location");

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
        send({ type: "init", pluginId, pluginVersion, params, language: document.documentElement.lang || "en", theme: theme(), devices: deviceKey ? deviceKey.split(",") : [], query: pluginUiPageQuery(window.location.search) });
        return;
      }
      if (message.type === "resize") {
        if (height === "auto") setFrameHeight(Math.max(minHeight, message.height));
        return;
      }
      if (message.type === "navigate") {
        const search = message.query && Object.keys(message.query).length ? `?${new URLSearchParams(message.query).toString()}` : "";
        router.push(`/plugins/${encodeURIComponent(pluginId)}/${message.routePath}${search}`);
        return;
      }
      if (message.type === "scan-start") {
        if (!mayScan) { send({ type: "scan-error", message: "This screen has not declared the scanner." }); return; }
        setScanError("");
        setScanning(true);
        return;
      }
      if (message.type === "scan-stop") {
        setScanning(false);
        return;
      }
      if (message.type === "location") {
        if (!mayLocate) { send({ type: "response", id: message.id, status: 403, body: { message: "This screen has not declared location." } }); return; }
        if (!navigator.geolocation) { send({ type: "response", id: message.id, status: 503, body: { message: "Location is unavailable on this device." } }); return; }
        navigator.geolocation.getCurrentPosition(
          (position) => send({ type: "response", id: message.id, status: 200, body: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } }),
          () => send({ type: "response", id: message.id, status: 403, body: { message: "Location permission was not granted." } }),
          { enableHighAccuracy: true, timeout: 10000 },
        );
        return;
      }
      if (!allow()) {
        send({ type: "response", id: message.id, status: 429, body: { message: "Too many requests from this screen" } });
        return;
      }
      const query = message.query ? `?${new URLSearchParams(message.query).toString()}` : "";
      try {
        const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${message.path}${query}`, {
          method: message.method,
          headers: message.body !== undefined ? { "Content-Type": "application/json" } : undefined,
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
  }, [allow, deviceKey, height, mayLocate, mayScan, minHeight, params, pluginId, pluginVersion, router, send]);

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
        await instance.decodeFromVideoDevice(null, video.current, (result) => {
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
      send({ type: "scan-closed" });
    };
  }, [scanning, send]);

  if (!src) {
    return <section className="card p-5 text-sm text-slate-500">This screen needs a newer school core to show {title || "this plugin screen"}.</section>;
  }
  return (
    <section className="card overflow-hidden p-0">
      {scanning && (
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
