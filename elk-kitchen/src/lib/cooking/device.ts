// The phone's microphone, voice, screen and speaker, for cooking hands-free.
//
// Listening only happens after a tap on the microphone, and stops on the next
// tap, on "stop listening", when the page is hidden, or (one-command mode)
// after one thing has been said. There's no wake word and no always-on mic.
import { useCallback, useEffect, useRef, useState } from "react";

type Alternative = { transcript: string; confidence: number };
type RecognitionResult = { isFinal: boolean; 0: Alternative; length: number };
type RecognitionEvent = { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type MicState = "off" | "starting" | "listening" | "paused-for-reply";

const ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in the browser's settings, or type instead.",
  "service-not-allowed": "This browser won't let the site use speech recognition. Type instead.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection on this browser. Type instead, or try again.",
};

export function useListening(opts: { onHeard: (text: string) => void; keepListening: boolean; lang?: string }) {
  const Ctor = typeof window === "undefined" ? null : recognitionCtor();
  const [state, setState] = useState<MicState>("off");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false); // the person wants the mic on
  const held = useRef(false); // paused while Kitchen is talking
  const onHeard = useRef(opts.onHeard);
  onHeard.current = opts.onHeard;
  const keep = useRef(opts.keepListening);
  keep.current = opts.keepListening;

  const begin = useCallback(() => {
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = opts.lang ?? (navigator.language || "en-CA");
    r.continuous = keep.current;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => setState("listening");
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript.trim();
        if (res.isFinal) { if (t) onHeard.current(t); } else live += `${t} `;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(ERRORS[e.error] ?? `Speech recognition stopped (${e.error}).`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") wanted.current = false;
    };
    r.onend = () => {
      rec.current = null;
      setInterim("");
      // Keep-listening mode restarts after the engine's own pauses.
      if (wanted.current && keep.current && !held.current) { begin(); return; }
      if (!held.current) { wanted.current = false; setState("off"); }
    };
    rec.current = r;
    setState("starting");
    try { r.start(); } catch { rec.current = null; setState("off"); }
  }, [Ctor, opts.lang]);

  const start = useCallback(() => { setError(null); wanted.current = true; held.current = false; begin(); }, [begin]);
  // Stops at once: abort drops anything half-heard rather than acting on it.
  const stop = useCallback(() => {
    wanted.current = false; held.current = false;
    rec.current?.abort();
    rec.current = null;
    setInterim("");
    setState("off");
  }, []);

  // While Kitchen speaks, stop listening so it doesn't hear itself.
  const hold = useCallback(() => {
    if (!wanted.current) return;
    held.current = true;
    rec.current?.abort();
    rec.current = null;
    setState("paused-for-reply");
  }, []);
  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    if (wanted.current && keep.current) begin(); else { wanted.current = false; setState("off"); }
  }, [begin]);

  // Never listen in the background.
  useEffect(() => {
    const onHide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); rec.current?.abort(); };
  }, [stop]);

  return { supported: !!Ctor, state, interim, error, start, stop, hold, release, clearError: () => setError(null) };
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, done: () => void): void {
  if (!canSpeak() || !text.trim()) { done(); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/°/g, " degrees ").replace(/“|”/g, ""));
  u.rate = 1;
  let finished = false;
  const end = () => { if (!finished) { finished = true; done(); } };
  u.onend = end;
  u.onerror = end;
  // Some engines never fire onend; don't leave the mic paused for ever.
  setTimeout(end, Math.min(20_000, 1500 + text.length * 90));
  synth.speak(u);
}
export const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

// Keep the screen on while cooking, where the browser allows it.
export function useWakeLock(on = true) {
  useEffect(() => {
    if (!on) return;
    type Sentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
    let s: Sentinel | null = null;
    const get = () => { wl?.request("screen").then((x) => { s = x; }).catch(() => {}); };
    get();
    const again = () => { if (!document.hidden) get(); };
    document.addEventListener("visibilitychange", again);
    return () => { document.removeEventListener("visibilitychange", again); s?.release().catch(() => {}); };
  }, [on]);
}

let audio: AudioContext | null = null;
// Audio needs a tap before it can play; call this from a tap.
export function primeAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC && !audio) audio = new AC();
    audio?.resume().catch(() => {});
  } catch { /* no sound; timers still show */ }
}
export function ring() {
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  if (!audio) return;
  for (let n = 0; n < 3; n++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime + n * 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.start(t); o.stop(t + 0.3);
  }
}

// A short voice note (audio only, not transcribed). Stops itself at `maxS`.
export function useVoiceNote(maxS = 120) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async (onDone: (blob: Blob) => void) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        rec.current = null;
        if (chunks.length) onDone(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "The microphone is blocked for this site." : "Couldn't start recording.");
    }
  }, []);
  const stop = useCallback(() => { rec.current?.state === "recording" && rec.current.stop(); }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => { if (s + 1 >= maxS) stop(); return s + 1; }), 1000);
    return () => clearInterval(t);
  }, [recording, maxS, stop]);
  useEffect(() => () => { rec.current?.state === "recording" && rec.current.stop(); }, []);

  return { supported, recording, seconds, error, start, stop };
}
