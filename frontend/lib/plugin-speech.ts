// The `speech` device of plugin screens: the SCHOOL PAGE listens (browser speech recognition),
// speaks (text-to-speech) and plays audio for a sandboxed plugin screen. The screen's frame has no
// microphone and its CSP blocks media (media-src 'none'), so it never gets an audio stream: it gets the
// recognised TEXT of what was said, and "done" when speaking or playing ends. Used by exam questions
// ("Speak the words", dictation) — see lib/plugin-ui-bridge.ts for the validated messages.

export const SPEECH_MAX_TEXT = 5000;
export const SPEECH_MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const SPEECH_MAX_LISTEN_SECONDS = 60;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const AUDIO = /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|x-m4a|m4a);base64,[A-Za-z0-9+/]+=*$/;

export type SpeechListen = { lang?: string; seconds: number };
export type SpeechSpeak = { text: string; lang?: string; rate: number };

export function speechLanguage(value: unknown): string | undefined {
  return typeof value === 'string' && LANGUAGE.test(value) ? value : undefined;
}
export function parseSpeechListen(message: Record<string, unknown>): SpeechListen {
  const seconds = Math.min(SPEECH_MAX_LISTEN_SECONDS, Math.max(2, Math.round(Number(message.seconds) || 15)));
  const lang = speechLanguage(message.lang);
  return { seconds, ...(lang ? { lang } : {}) };
}
export function parseSpeechSpeak(message: Record<string, unknown>): SpeechSpeak | null {
  const text = typeof message.text === 'string' ? message.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, SPEECH_MAX_TEXT) : '';
  if (!text) return null;
  const rate = Math.min(2, Math.max(0.5, Number(message.rate) || 1));
  const lang = speechLanguage(message.lang);
  return { text, rate, ...(lang ? { lang } : {}) };
}
/** A base64 audio data URL of a known audio type, at most SPEECH_MAX_AUDIO_BYTES; anything else is null. */
export function parseSpeechAudio(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > Math.ceil(SPEECH_MAX_AUDIO_BYTES * 4 / 3) + 64) return null;
  return AUDIO.test(value) ? value : null;
}

type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
export function speechAvailable() {
  return {
    listen: Boolean(recognitionClass()),
    speak: typeof window !== 'undefined' && 'speechSynthesis' in window,
    play: typeof Audio !== 'undefined',
  };
}

export type SpeechOutcome = { status: number; body: Record<string, unknown> };

/** One speech session per screen: listening, speaking or playing (a new one stops the previous one). */
export function createSpeechHost(onInterim: (text: string) => void) {
  let recognition: Recognition | null = null;
  let audio: HTMLAudioElement | null = null;
  let finish: ((outcome: SpeechOutcome) => void) | null = null;
  const settle = (outcome: SpeechOutcome) => { const done = finish; finish = null; done?.(outcome); };
  // Each request answers once, and only while it is still the current one (a stopped session's late events are ignored).
  const own = (resolve: (outcome: SpeechOutcome) => void) => {
    const mine = (outcome: SpeechOutcome) => resolve(outcome);
    finish = mine;
    return (outcome: SpeechOutcome) => { if (finish === mine) settle(outcome); };
  };

  const stop = () => {
    if (recognition) { try { recognition.stop(); } catch { /* already stopped */ } }
    if (audio) { audio.pause(); audio = null; }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    settle({ status: 200, body: { stopped: true, transcript: '', alternatives: [] } });
  };

  const listen = (input: SpeechListen) => new Promise<SpeechOutcome>((resolve) => {
    const Recognition = recognitionClass();
    if (!Recognition) { resolve({ status: 501, body: { message: 'This browser cannot recognise speech: use Chrome or Edge, or type the answer.' } }); return; }
    stop();
    const session = new Recognition();
    recognition = session;
    session.lang = input.lang || document.documentElement.lang || 'en-US';
    session.interimResults = true;
    session.maxAlternatives = 3;
    session.continuous = false;
    let best = '';
    let alternatives: string[] = [];
    const timer = window.setTimeout(() => { try { session.stop(); } catch { /* ended */ } }, input.seconds * 1000);
    const answer = own((outcome) => { window.clearTimeout(timer); if (recognition === session) recognition = null; onInterim(''); resolve(outcome); });
    session.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          best = `${best} ${result[0].transcript}`.trim();
          alternatives = Array.from(result as ArrayLike<{ transcript: string }>).map((item) => item.transcript.trim()).filter(Boolean).slice(0, 3);
        } else interim += result[0].transcript;
      }
      onInterim(`${best} ${interim}`.trim());
    };
    session.onerror = (event: any) => {
      const code = String(event?.error || '');
      if (code === 'not-allowed' || code === 'service-not-allowed') answer({ status: 403, body: { message: 'Microphone permission was not granted.' } });
      else if (code === 'no-speech' || code === 'aborted') answer({ status: 200, body: { transcript: '', alternatives: [] } });
      else answer({ status: 502, body: { message: code === 'network' ? 'Speech recognition needs an internet connection in this browser.' : 'Speech recognition stopped.' } });
    };
    session.onend = () => answer({ status: 200, body: { transcript: best.slice(0, SPEECH_MAX_TEXT), alternatives } });
    try { session.start(); } catch { answer({ status: 409, body: { message: 'The microphone is busy.' } }); }
  });

  const speak = (input: SpeechSpeak) => new Promise<SpeechOutcome>((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { resolve({ status: 501, body: { message: 'This browser cannot read text aloud.' } }); return; }
    stop();
    const utterance = new SpeechSynthesisUtterance(input.text);
    utterance.rate = input.rate;
    if (input.lang) utterance.lang = input.lang;
    const answer = own(resolve);
    utterance.onend = () => answer({ status: 200, body: { spoken: true } });
    utterance.onerror = (event) => answer(event.error === 'interrupted' || event.error === 'canceled' ? { status: 200, body: { stopped: true } } : { status: 502, body: { message: 'Text-to-speech failed.' } });
    window.speechSynthesis.speak(utterance);
  });

  const play = (source: string) => new Promise<SpeechOutcome>((resolve) => {
    stop();
    const player = new Audio(source);
    audio = player;
    const answer = own(resolve);
    player.onended = () => { audio = null; answer({ status: 200, body: { played: true } }); };
    player.onerror = () => { audio = null; answer({ status: 415, body: { message: 'This audio cannot be played in this browser.' } }); };
    player.play().catch(() => { audio = null; answer({ status: 409, body: { message: 'Tap the play button to play the audio.' } }); });
  });

  return { listen, speak, play, stop, listening: () => Boolean(recognition) };
}
