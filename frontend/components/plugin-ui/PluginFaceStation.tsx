"use client";

import { useEffect, useRef, useState } from "react";
import { FACE_MODEL_VERSION, FACE_RULES, loadFaceEngine, meanDescriptor, readFace } from "../../lib/face-engine";
import type { PluginUiActivity, PluginUiTone } from "../../lib/plugin-ui-bridge";

/**
 * The school page's face station (the "face" device of plugin screens). It runs the camera and the face
 * model here, in the school page; the plugin screen receives face vectors and scores, never an image.
 *   identify: one person at a time — face the camera (3 steady frames averaged), then two liveness steps in a
 *             random order (turn the head to the side shown, and blink), then the vector goes to the plugin.
 *   enroll:   `samples` vectors taken a moment apart, then the liveness steps, then all of them at once.
 * A printed photo cannot turn or blink; a recorded video would have to do both, in the order asked.
 */
export type FaceResult = {
  mode: "identify" | "enroll";
  descriptors: number[][];
  quality: { score: number; size: number };
  liveness: { passed: boolean; challenge: string | null };
  modelVersion: string;
};

type Props = {
  title: string;
  mode: "identify" | "enroll";
  liveness: boolean;
  samples: number;
  feedback: { tone: PluginUiTone; message: string } | null;
  activity: { title: string; items: PluginUiActivity[] };
  onResult: (result: FaceResult) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export default function PluginFaceStation({ title, mode, liveness, samples, feedback, activity, onResult, onError, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [hint, setHint] = useState("Starting camera…");
  const [tone, setTone] = useState<PluginUiTone>("info");
  const [arrow, setArrow] = useState<"left" | "right" | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const callbacks = useRef({ onResult, onError });
  callbacks.current = { onResult, onError };

  // the plugin's answer (who it is, recorded or not) replaces the hint for a moment
  useEffect(() => { if (feedback) setShowFeedback(true); }, [feedback]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    let stopped = false, stream: MediaStream | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    const say = (text: string, kind: PluginUiTone = "info") => { setHint(text); setTone(kind); };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch {
        callbacks.current.onError("Camera permission was not granted.");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const element = video.current!;
      element.srcObject = stream;
      await element.play().catch(() => undefined);
      say("Loading face recognition…");
      let faceapi;
      try { faceapi = await loadFaceEngine(); }
      catch { callbacks.current.onError("Face recognition could not load on this device."); return; }

      let step: "look" | "check" | "pause" | "done" = "look";
      let frames: number[][] = [];
      let taken: number[][] = [];
      let lastSample = 0, deadline = 0, pauseUntil = 0;
      // liveness: a head turn to a random side and a blink, in a random order, each within its own time
      let steps: Array<"left" | "right" | "blink"> = [], stepAt = 0, closedSeen = false;
      let challenge: string | null = null;
      const begin = (index: number) => {
        stepAt = index; closedSeen = false; deadline = Date.now() + FACE_RULES.stepSeconds * 1000;
        const kind = steps[index];
        if (kind === "blink") { setArrow(null); say("Blink your eyes 👁 · សូមព្រិចភ្នែក"); }
        else { setArrow(kind); say(kind === "left" ? "Turn your head to the left ←" : "Turn your head to the right →"); }
      };
      let quality = { score: 0, size: 0 };
      const want = mode === "enroll" ? samples : 1;
      const send = (passed: boolean) => {
        callbacks.current.onResult({ mode, descriptors: taken, quality, liveness: { passed, challenge }, modelVersion: FACE_MODEL_VERSION });
        taken = []; challenge = null; setArrow(null);
        if (mode === "enroll") { step = "done"; say("Saved — thank you", "success"); }
        else { step = "pause"; pauseUntil = Date.now() + 3000; }
      };
      const tick = async () => {
        if (stopped) return;
        try {
          if (step === "pause" && Date.now() >= pauseUntil) { step = "look"; setShowFeedback(false); }
          if (step === "look" || step === "check") {
            const r = await readFace(faceapi, element);
            if (stopped) return;
            quality = { score: Math.round(r.score * 100) / 100, size: Math.round(r.size * 100) / 100 };
            if (step === "look") {
              if (!r.count) { frames = []; say(mode === "enroll" ? "Look at the camera" : "Look at the camera · សូមមើលកាមេរ៉ា"); }
              else if (r.count > 1) { frames = []; say("One person at a time", "warning"); }
              else if (r.score < FACE_RULES.minScore || r.size < FACE_RULES.minSize) { frames = []; say("Come a little closer", "warning"); }
              else if (Math.abs(r.yaw) > FACE_RULES.frontal) { frames = []; say("Look straight at the camera", "warning"); }
              else if (r.descriptor && Date.now() - lastSample > (mode === "enroll" ? 700 : 0)) {
                frames.push(r.descriptor);
                say(mode === "enroll" ? `Hold still… ${taken.length + 1} of ${want}` : "Hold still…");
                if (frames.length >= FACE_RULES.stableFrames) {
                  taken.push(meanDescriptor(frames)); frames = []; lastSample = Date.now();
                  if (taken.length >= want) {
                    if (liveness) {
                      const turn = Math.random() < 0.5 ? "left" : "right";
                      steps = Math.random() < 0.5 ? [turn, "blink"] : ["blink", turn];
                      challenge = steps.join("+");
                      step = "check"; begin(0);
                    } else send(false);
                  }
                }
              }
            } else if (step === "check") {
              const kind = steps[stepAt];
              // the picture is shown mirrored: turning towards the arrow on the screen moves the nose the
              // other way in the camera's own image; a blink is eyes closed, then open again
              if (r.blink > FACE_RULES.blinkClosed) closedSeen = true;
              const done = kind === "blink" ? closedSeen && r.blink < FACE_RULES.blinkOpen
                : kind === "left" ? r.yaw > FACE_RULES.turned : r.yaw < -FACE_RULES.turned;
              if (r.count === 1 && done) { if (stepAt + 1 < steps.length) begin(stepAt + 1); else send(true); }
              else if (r.count > 1 || Date.now() > deadline) {
                step = "look"; taken = []; steps = []; challenge = null; setArrow(null);
                say(r.count > 1 ? "One person at a time — start again" : "Try again: do what the screen asks", "error");
              }
            }
          }
        } catch { /* one bad frame: try the next */ }
        if (!stopped) timer = setTimeout(tick, 120);
      };
      say("Look at the camera");
      tick();
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [mode, liveness, samples]);

  const toneClass = (value: PluginUiTone) => value === "success" ? "bg-emerald-600 text-white" : value === "error" ? "bg-rose-700 text-white" : value === "warning" ? "bg-amber-500 text-slate-950" : "bg-sky-700 text-white";
  const markClass = (value: PluginUiTone) => value === "success" ? "bg-emerald-600" : value === "error" ? "bg-rose-700" : value === "warning" ? "bg-amber-500 text-slate-950" : "bg-sky-700";
  const bubble = showFeedback && feedback ? feedback : { tone, message: hint };
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white" data-plugin-face>
      <header className="flex items-center gap-5 border-b border-slate-700 bg-slate-800 px-5 py-4">
        <button type="button" onClick={onClose} className="font-bold">‹ Back</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-extrabold">🙂 {title}</h2>
          <p className="text-xs text-slate-400">The picture stays on this device; only a face code is sent.</p>
        </div>
        <strong className="font-mono text-xl">{clock.toLocaleTimeString()}</strong>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
          <video ref={video} className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} muted playsInline />
          <div className={`pointer-events-none relative h-80 w-60 rounded-[50%] border-4 shadow-[0_0_0_9999px_rgba(0,0,0,.55)] ${arrow ? "border-amber-400" : "border-emerald-400"}`} />
          {arrow && <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-8xl font-black text-amber-300" style={arrow === "left" ? { left: "8%" } : { right: "8%" }} aria-hidden>{arrow === "left" ? "←" : "→"}</div>}
          <p className={`relative mt-6 max-w-[90%] rounded-full px-6 py-3 text-center text-lg font-bold shadow-lg ${toneClass(bubble.tone)}`} role="status" aria-live="polite" data-face-hint>{bubble.message}</p>
        </main>
        <aside className="hidden w-80 overflow-y-auto border-l border-slate-700 bg-slate-800 p-5 md:block">
          <h3 className="font-bold">{activity.title}</h3>
          <div className="mt-5 space-y-3">
            {activity.items.map((item, index) => (
              <div key={index} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-extrabold ${markClass(item.tone)}`}>{item.initials || (item.tone === "success" ? "✓" : item.tone === "error" ? "✕" : "!")}</span>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{item.title}</strong>
                  {item.detail && <span className="mt-1 block text-xs text-slate-300">{item.detail}</span>}
                </div>
              </div>
            ))}
            {!activity.items.length && <p className="pt-32 text-center text-sm text-slate-500">🙂<br />Nobody yet</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
