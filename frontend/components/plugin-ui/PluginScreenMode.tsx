"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Screen mode for plugin pages (?screen=1): the page alone, edge to edge, for a customer display or a kitchen
 * display on its own monitor or tablet. A faint toolbar in the corner switches full screen and closes it.
 * With ?fs=1 (opened by "Show on a screen") the first tap anywhere goes full screen (browsers need a tap).
 */
export default function PluginScreenMode({ children }: { children: ReactNode }) {
  const [full, setFull] = useState(false);
  const [tapToFill, setTapToFill] = useState(false);
  useEffect(() => {
    const update = () => setFull(Boolean(document.fullscreenElement));
    update();
    document.addEventListener("fullscreenchange", update);
    setTapToFill(new URLSearchParams(window.location.search).get("fs") === "1" && !document.fullscreenElement);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const goFull = () => { setTapToFill(false); document.documentElement.requestFullscreen?.().catch(() => undefined); };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    window.close();
    // a tab the screen was not opened in cannot close itself: back to the normal page
    setTimeout(() => {
      const params = new URLSearchParams(window.location.search); params.delete("screen"); params.delete("fs");
      window.location.href = window.location.pathname + (params.toString() ? `?${params}` : "");
    }, 200);
  };
  return (
    <div className="fixed inset-0 overflow-auto bg-white" data-plugin-screen>
      {/* edge to edge: no card frame, and a "fill" screen takes the whole window */}
      <style>{"[data-plugin-screen] .card{border:0;border-radius:0;box-shadow:none;margin:0} [data-plugin-screen] iframe[data-height=fill]{height:100vh!important}"}</style>
      {children}
      <div className="fixed left-1/2 top-1 z-[90] flex -translate-x-1/2 gap-1 opacity-20 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={full ? () => void document.exitFullscreen().catch(() => undefined) : goFull} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">{full ? "Exit full screen" : "⛶ Full screen"}</button>
        <button type="button" onClick={close} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white" aria-label="Close the screen">✕</button>
      </div>
      {tapToFill && (
        <button type="button" onClick={goFull} className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 text-2xl font-bold text-white" data-plugin-screen-tap>
          ⛶ Tap to show full screen
        </button>
      )}
    </div>
  );
}

type ScreenInfo = { label?: string; isPrimary?: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number; width: number; height: number };

/**
 * "Show on a screen": opens this page in screen mode in its own window. In Chrome and Edge the person chooses the
 * monitor (Window Management API) and the window opens there; elsewhere it opens and can be dragged across.
 */
export function PluginScreenLauncher({ name }: { name: string }) {
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null);
  const [note, setNote] = useState("");
  const url = () => {
    const params = new URLSearchParams(window.location.search); params.set("screen", "1"); params.set("fs", "1");
    return `${window.location.pathname}?${params}`;
  };
  const windowName = `wattanam-screen-${name}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const openOn = (screen?: ScreenInfo) => {
    const features = screen ? `popup,left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}` : "popup,width=1280,height=800";
    const opened = window.open(url(), windowName, features);
    setScreens(null);
    setNote(opened ? (screen ? "Opened on that screen: tap it once to show it full screen." : "Opened in a new window: drag it to the other monitor, then tap it to show it full screen.") : "The browser blocked the new window: allow pop-ups for this site, or open this page with ?screen=1.");
  };
  const choose = async () => {
    setNote("");
    const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: ScreenInfo[] }> };
    if (typeof w.getScreenDetails !== "function") { openOn(); return; }
    try {
      const details = await w.getScreenDetails();
      if (details.screens.length <= 1) { openOn(details.screens[0]); return; }
      setScreens(details.screens);
    } catch { openOn(); }
  };
  return (
    <div className="flex flex-col items-end gap-2" data-plugin-screen-launcher>
      <button type="button" onClick={() => void choose()} className="btn btn-secondary">🖥️ Show on a screen</button>
      {screens && (
        <div className="flex flex-wrap justify-end gap-2" role="group" aria-label="Choose the screen">
          {screens.map((screen, index) => (
            <button key={index} type="button" onClick={() => openOn(screen)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:border-indigo-500">
              {screen.label || `Screen ${index + 1}`}{screen.isPrimary ? " (this one)" : ""} · {screen.width}×{screen.height}
            </button>
          ))}
          <button type="button" onClick={() => setScreens(null)} className="rounded-lg px-2 py-1.5 text-sm text-slate-500">Cancel</button>
        </div>
      )}
      {note && <p className="max-w-sm text-right text-xs text-slate-500">{note}</p>}
    </div>
  );
}
