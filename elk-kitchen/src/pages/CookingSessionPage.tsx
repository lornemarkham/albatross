import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useCookingSession } from "../lib/cooking/useCookingSession";
import { activeTimers, addMedia, answer, endTimer, finish, hear, setIngredient, startTimer, stepsOf } from "../lib/cooking/session";
import { canSpeak, primeAudio, speak, stopSpeaking, useListening, useVoiceNote, useWakeLock } from "../lib/cooking/device";
import { storeMedia } from "../lib/cooking/media";
import { clock, durationText, qtyText, quantityAt } from "../lib/cooking/parse";
import { ingredientStory } from "../lib/cooking/summary";
import { CookingJournal } from "../components/CookingJournal";
import type { CookingSession, MediaRef, SessionIngredient } from "../types/cooking";
import { loadPrefs as loadCookingPrefs } from "../lib/sausage/preferences";
import { STAGES, STAGE_LABEL, STAGE_SAY, seasoningBasis, weighedMeat } from "../lib/sausage/stages";
import { amountFor, gramsText } from "../lib/sausage/plan";

const PREFS_KEY = "elk-kitchen-cooking-prefs-v1";
type Prefs = { keepListening: boolean; speakReplies: boolean };
function loadPrefs(): Prefs {
  try { return { keepListening: false, speakReplies: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return { keepListening: false, speakReplies: true }; }
}

const HINTS = [
  "Add 40 grams of salt",
  "Change that to 35 grams",
  "Start a 20-minute timer",
  "What's the next step?",
  "Read that again",
  "Internal temp is 160 Fahrenheit",
  "Make a note for next time",
  "How much pepper do I need for 3 kilograms?",
  "Tasting note: needs more garlic",
  "Stop listening",
];

// The active cooking screen: big controls, one hand, messy fingers.
export function CookingSessionPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { photos } = useKitchen();
  const { session, recipe, update, now, rang, dismissRang } = useCookingSession(sessionId);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);
  useWakeLock(!!session && !session.endedAt);
  useEffect(() => { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe ?? null;

  function respond(text: string, source: "voice" | "typed") {
    let out = { reply: "", stop: false };
    update((s) => {
      const r = hear(s, text, { recipe: recipeRef.current ?? null, source, now: new Date().toISOString(), prefs: loadCookingPrefs(localStorage) });
      out = { reply: r.reply, stop: !!r.stopListening };
      return r.session;
    });
    setHeard(text);
    setReply(out.reply);
    if (out.stop) { mic.stop(); return; }
    say(out.reply);
  }

  function say(text: string) {
    if (!prefsRef.current.speakReplies || !text) return;
    mic.hold();
    speak(text, () => mic.release());
  }

  const mic = useListening({ onHeard: (t) => respond(t, "voice"), keepListening: prefs.keepListening });
  const voice = useVoiceNote();

  // A finished timer is announced once.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const id of rang) {
      if (announced.current.has(id)) continue;
      announced.current.add(id);
      const t = session?.timers.find((x) => x.id === id);
      if (t) { setReply(`${t.label} timer is done.`); say(`${t.label} timer is done.`); }
    }
  }, [rang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return null;
  if (session === null) {
    return (
      <Shell>
        <p className="text-butter/80">This cooking session isn't on this device.</p>
        <Link to="/cook" className="mt-4 inline-block text-saffron underline">Start cooking</Link>
      </Shell>
    );
  }
  if (session.savedEntryId && session.recipeId) {
    return (
      <Shell>
        <p className="text-butter/80">This cook is saved.</p>
        <Link to={`/recipe/${encodeURIComponent(session.recipeId)}/batch/${encodeURIComponent(session.savedEntryId)}`} className="mt-4 inline-block text-saffron underline">Open its journal</Link>
      </Shell>
    );
  }

  const steps = stepsOf(recipe ?? null);
  const step = session.stepIndex >= 0 && session.stepIndex < steps.length ? session.stepIndex : -1;
  const elapsed = (now - Date.parse(session.startedAt)) / 1000;
  const listening = mic.state === "listening" || mic.state === "starting";
  const live = activeTimers(session);
  const doneTimers = session.timers.filter((t) => rang.includes(t.id));

  function tapMic() {
    primeAudio();
    stopSpeaking();
    if (mic.state !== "off") mic.stop(); else { voice.stop(); mic.start(); }
  }

  async function addFile(file: File | undefined, type: MediaRef["type"], finished = false) {
    if (!file) return;
    setMediaError(null);
    setMediaBusy(type === "photo" ? "Saving photo…" : type === "video" ? "Saving clip…" : "Saving voice note…");
    try {
      const m = await storeMedia(photos, file, type, { finished });
      update((s) => addMedia(s, m, new Date().toISOString()));
      setReply(`${type === "photo" ? "Photo" : type === "video" ? "Clip" : "Voice note"} saved.`);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : String(e));
    } finally {
      setMediaBusy(null);
    }
  }

  function goStep(i: number) {
    const n = Math.max(0, Math.min(steps.length - 1, i));
    update((s) => ({ ...s, stepIndex: n }));
    const text = `Step ${n + 1} of ${steps.length}. ${steps[n]}`;
    setReply(text);
    say(text);
  }

  function finishCooking() {
    mic.stop();
    stopSpeaking();
    update((s) => finish(s, new Date().toISOString()));
    navigate(`/cook/${encodeURIComponent(session!.id)}/review`);
  }

  return (
    <div className="min-h-screen bg-cocoa pb-56 text-butter">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-butter/10 bg-cocoa/95 px-4 py-3 backdrop-blur">
        <Link to={session.recipeId ? `/recipe/${encodeURIComponent(session.recipeId)}` : "/"} className="text-sm text-butter/70" aria-label="Leave (the cook is kept)">←</Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold">{session.recipeTitle}</p>
          <p className="text-xs text-butter/60">Cooking for {clock(elapsed)} · saved on this phone as you go</p>
        </div>
        <button type="button" onClick={finishCooking} className="rounded-xl bg-saffron px-4 py-2.5 text-sm font-bold text-cocoa">Finish</button>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        <MicStatus state={mic.state} supported={mic.supported} interim={mic.interim} recordingVoice={voice.recording} />
        {mic.error && <p role="alert" className="rounded-xl bg-tomato/20 px-3 py-2 text-sm text-butter">{mic.error}</p>}

        {(heard || reply) && (
          <section aria-live="polite" className="rounded-2xl bg-butter/10 p-4">
            {heard && <p className="text-sm text-butter/60">You said: “{heard}”</p>}
            {reply && <p className="mt-1 text-xl font-semibold leading-snug">{reply}</p>}
            {reply && canSpeak() && <button type="button" onClick={() => say(reply)} className="mt-2 text-sm text-saffron underline">🔊 Say it again</button>}
          </section>
        )}

        {session.pending.map((p) => (
          <section key={p.id} role="alertdialog" aria-label="Please confirm" className="rounded-2xl border-2 border-saffron bg-saffron/15 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-saffron">Please confirm</p>
            <p className="mt-1 text-lg font-semibold">{p.question}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { let r = ""; update((s) => { const a = answer(s, p.id, true, new Date().toISOString(), null, recipe ?? null); r = a.reply; return a.session; }); setReply(r); say(r); }}
                className="min-h-14 rounded-xl bg-saffron text-lg font-bold text-cocoa">Yes</button>
              <button type="button" onClick={() => { let r = ""; update((s) => { const a = answer(s, p.id, false, new Date().toISOString()); r = a.reply; return a.session; }); setReply(r); say(r); }}
                className="min-h-14 rounded-xl border border-butter/40 text-lg font-bold">No</button>
            </div>
          </section>
        ))}

        {doneTimers.map((t) => (
          <button key={t.id} type="button" onClick={() => dismissRang(t.id)} className="w-full animate-pulse rounded-2xl bg-tomato p-4 text-left text-xl font-bold text-white">
            ⏰ {t.label} is done — tap to dismiss
          </button>
        ))}

        {live.length > 0 && (
          <section aria-label="Timers" className="grid grid-cols-2 gap-3">
            {live.map((t) => (
              <div key={t.id} className="rounded-2xl bg-butter/10 p-3">
                <p className="truncate text-xs text-butter/60">{t.label}</p>
                <p className="font-mono text-3xl font-bold tabular-nums">{clock((Date.parse(t.endsAt) - now) / 1000)}</p>
                <button type="button" onClick={() => update((s) => endTimer(s, t.id, "cancelled", new Date().toISOString()))} className="mt-1 text-xs text-butter/60 underline">Cancel</button>
              </div>
            ))}
          </section>
        )}

        {steps.length > 0 && (
          <section aria-label="Steps" className="rounded-2xl bg-butter/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-saffron">{step >= 0 ? `Step ${step + 1} of ${steps.length}` : `${steps.length} steps`}</p>
            <p className="mt-1 font-display text-2xl leading-snug">{step >= 0 ? steps[step] : "Say “what's the next step?” or tap Next to begin."}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" disabled={step <= 0} onClick={() => goStep(step - 1)} className="min-h-12 rounded-xl border border-butter/30 font-semibold disabled:opacity-30">◀ Back</button>
              <button type="button" disabled={step < 0 || !canSpeak()} onClick={() => goStep(step)} className="min-h-12 rounded-xl border border-butter/30 font-semibold disabled:opacity-30">🔊 Read</button>
              <button type="button" disabled={step >= steps.length - 1} onClick={() => goStep(step + 1)} className="min-h-12 rounded-xl bg-butter font-semibold text-cocoa disabled:opacity-30">Next ▶</button>
            </div>
          </section>
        )}

        {session.plan && <PlanPanel session={session} onSay={(t) => respond(t, "typed")} />}

        <Ingredients session={session} recipeIngredients={recipe?.ingredients ?? ""} update={update} />

        <section aria-label="Add to the journal" className="grid grid-cols-2 gap-3">
          <FileButton icon="📷" label="Photo" accept="image/*" onFile={(f) => addFile(f, "photo")} />
          <FileButton icon="🎥" label="Short clip" accept="video/*" onFile={(f) => addFile(f, "video")} />
          {voice.supported && (
            <button type="button" onClick={() => { if (voice.recording) voice.stop(); else { mic.stop(); voice.start((b) => addFile(new File([b], "voice", { type: b.type }), "voice")); } }}
              className={`flex min-h-16 items-center justify-center gap-2 rounded-2xl text-lg font-semibold ${voice.recording ? "bg-tomato text-white" : "bg-butter/10"}`}>
              {voice.recording ? `⏹ Stop note ${clock(voice.seconds)}` : "🎙 Voice note"}
            </button>
          )}
          <FileButton icon="🍽" label="Finished photo" accept="image/*" onFile={(f) => addFile(f, "photo", true)} />
          <QuickTimer onStart={(sec, label) => { primeAudio(); update((s) => startTimer(s, sec, label, new Date().toISOString())); setReply(`Timer set for ${durationText(sec)}.`); }} />
        </section>
        {mediaBusy && <p role="status" className="text-sm text-butter/70">{mediaBusy}</p>}
        {(mediaError || voice.error) && <p role="alert" className="rounded-xl bg-tomato/20 px-3 py-2 text-sm">{mediaError ?? voice.error}</p>}

        <section className="rounded-2xl bg-cream p-4 text-bark">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">So far</h2>
            <span className="text-xs text-bark/60">{session.transcript.length} said or typed · {session.events.length} entries</span>
          </div>
          <CookingJournal session={session} compact />
        </section>

        <section className="rounded-2xl bg-butter/5 p-4 text-sm">
          <button type="button" onClick={() => setShowHints((v) => !v)} aria-expanded={showHints} className="font-semibold text-saffron">
            {showHints ? "Hide" : "What can I say?"}
          </button>
          {showHints && (
            <ul className="mt-2 space-y-1 text-butter/80">
              {HINTS.map((h) => <li key={h}>“{h}”</li>)}
              <li className="pt-1 text-butter/60">Anything else is kept as a note. Kitchen asks before applying anything it isn't sure about.</li>
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-4">
            <Toggle on={prefs.keepListening} onChange={(v) => setPrefs((p) => ({ ...p, keepListening: v }))} label="Keep listening until I tap stop" />
            {canSpeak() && <Toggle on={prefs.speakReplies} onChange={(v) => { if (!v) stopSpeaking(); setPrefs((p) => ({ ...p, speakReplies: v })); }} label="Speak replies" />}
          </div>
        </section>
      </main>

      {/* The controls stay at the bottom of the screen, within thumb reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-butter/10 bg-cocoa/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          {typing && (
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (typed.trim()) { respond(typed.trim(), "typed"); setTyped(""); } }} className="mb-3 flex gap-2">
              <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. add 40 g salt" aria-label="Type a note or command"
                className="min-h-12 flex-1 rounded-xl border border-butter/30 bg-butter/10 px-3 text-base text-butter placeholder:text-butter/40" />
              <button type="submit" className="rounded-xl bg-butter px-4 font-semibold text-cocoa">Add</button>
            </form>
          )}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setTyping((v) => !v)} aria-pressed={typing} className="flex h-14 w-20 flex-col items-center justify-center rounded-2xl bg-butter/10 text-xs">
              <span className="text-xl" aria-hidden>⌨️</span>Type
            </button>
            {mic.supported ? (
              <button type="button" onClick={tapMic} aria-pressed={listening}
                aria-label={listening ? "Stop listening" : mic.state === "paused-for-reply" ? "Kitchen is talking — tap to stop" : "Tap to talk"}
                className={`relative flex h-24 flex-1 items-center justify-center gap-3 rounded-full text-xl font-bold shadow-lg transition ${listening ? "bg-tomato text-white" : mic.state === "paused-for-reply" ? "bg-butter/30 text-butter" : "bg-saffron text-cocoa"}`}>
                {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-tomato/40" />}
                <span aria-hidden className="relative text-3xl">{listening ? "⏹" : "🎤"}</span>
                <span className="relative">{listening ? "Listening — tap to stop" : mic.state === "paused-for-reply" ? "Talking…" : "Tap to talk"}</span>
              </button>
            ) : (
              <button type="button" onClick={() => setTyping(true)} className="flex h-24 flex-1 items-center justify-center rounded-full bg-butter/20 px-4 text-center text-sm">
                Voice isn't available in this browser. Tap to type instead.
              </button>
            )}
            <FileButton icon="📷" label="Photo" accept="image/*" small onFile={(f) => addFile(f, "photo")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MicStatus({ state, supported, interim, recordingVoice }: { state: string; supported: boolean; interim: string; recordingVoice: boolean }) {
  const on = state === "listening" || state === "starting";
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${on || recordingVoice ? "bg-tomato/25" : "bg-butter/5"}`}>
      <span aria-hidden className={`h-3.5 w-3.5 shrink-0 rounded-full ${on || recordingVoice ? "animate-pulse bg-tomato" : "bg-butter/30"}`} />
      <p className="text-base">
        {recordingVoice ? <strong>Recording a voice note</strong>
          : on ? <><strong>Microphone on</strong>{interim ? <span className="text-butter/70"> — “{interim}”</span> : " — speak now"}</>
          : state === "paused-for-reply" ? "Microphone paused while Kitchen talks"
          : supported ? "Microphone off. Tap the big button to talk." : "Microphone not available here. Type instead."}
      </p>
    </div>
  );
}

function FileButton({ icon, label, accept, onFile, small }: { icon: string; label: string; accept: string; onFile: (f: File | undefined) => void; small?: boolean }) {
  return (
    <label className={small
      ? "flex h-14 w-20 cursor-pointer flex-col items-center justify-center rounded-2xl bg-butter/10 text-xs"
      : "flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-butter/10 text-lg font-semibold"}>
      <span aria-hidden className={small ? "text-xl" : ""}>{icon}</span>{label}
      <input type="file" accept={accept} capture="environment" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

function QuickTimer({ onStart }: { onStart: (seconds: number, label: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-butter/10 text-lg font-semibold">⏱ Timer</button>;
  return (
    <div className="col-span-2 grid grid-cols-4 gap-2 rounded-2xl bg-butter/10 p-2">
      {[5, 10, 20, 30, 45, 60, 90].map((m) => (
        <button key={m} type="button" onClick={() => { onStart(m * 60, ""); setOpen(false); }} className="min-h-12 rounded-xl bg-butter/15 font-semibold">{m < 60 ? `${m} min` : `${m / 60} h`}</button>
      ))}
      <button type="button" onClick={() => setOpen(false)} className="min-h-12 rounded-xl text-sm text-butter/70">Close</button>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-saffron" />
      <span>{label}</span>
    </label>
  );
}

// What's gone in, as amounts. Tap one to fix it by hand; every change is kept.
function Ingredients({ session, recipeIngredients, update }: { session: CookingSession; recipeIngredients: string; update: (f: (s: CookingSession) => CookingSession) => void }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const live = session.ingredients.filter((i) => !i.removed);
  const planned = recipeIngredients.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <section aria-label="Ingredients" className="rounded-2xl bg-butter/10 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wide text-saffron">In the bowl</h2>
        <button type="button" onClick={() => setEditing("new")} className="text-sm text-saffron underline">+ Add by hand</button>
      </div>
      {live.length === 0 && editing !== "new" && <p className="mt-2 text-butter/60">Nothing yet. Say “add 40 grams of salt”.</p>}
      <ul className="mt-2 divide-y divide-butter/10">
        {live.map((i) => (
          <li key={i.id} className="py-2">
            {editing === i.id
              ? <IngredientForm initial={i} onCancel={() => setEditing(null)} onSave={(name, qty) => { update((s) => setIngredient(s, { ingredientId: i.id, name, qty, why: "edited", now: new Date().toISOString(), lineId: null })); setEditing(null); }}
                  onRemove={() => { if (window.confirm(`Remove ${i.name} (${qtyText(i.qty)}) from this cook?`)) { update((s) => setIngredient(s, { ingredientId: i.id, name: i.name, qty: null, why: "removed", now: new Date().toISOString(), lineId: null })); setEditing(null); } }} />
              : (
                <button type="button" onClick={() => setEditing(i.id)} className="flex w-full items-baseline justify-between gap-3 text-left">
                  <span className="text-lg">{i.name}</span>
                  <span className="text-right">
                    <span className="font-mono text-xl font-bold">{qtyText(i.qty)}</span>
                    {ingredientStory(i) && <span className="block text-xs text-saffron">{ingredientStory(i)}</span>}
                  </span>
                </button>
              )}
          </li>
        ))}
        {editing === "new" && (
          <li className="py-2">
            <IngredientForm initial={null} onCancel={() => setEditing(null)} onSave={(name, qty) => { update((s) => setIngredient(s, { ingredientId: null, name, qty, why: "edited", now: new Date().toISOString(), lineId: null })); setEditing(null); }} />
          </li>
        )}
      </ul>
      {planned.length > 0 && (
        <details className="mt-3 text-sm text-butter/70">
          <summary className="cursor-pointer">The recipe calls for</summary>
          <ul className="mt-1 list-disc pl-5">{planned.map((l, n) => <li key={n}>{l}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function IngredientForm({ initial, onSave, onCancel, onRemove }: { initial: SessionIngredient | null; onSave: (name: string, qty: { value: number; unit: string } | null) => void; onCancel: () => void; onRemove?: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.qty ? `${initial.qty.value} ${initial.qty.unit}`.trim() : "");
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Give it a name."); return; }
    const q = amount.trim() ? quantityAt(amount.trim()) : null;
    if (amount.trim() && (!q || q.rest)) { setError("Amount like “35 g”, “1.5 kg” or “2 tsp”."); return; }
    onSave(name.trim(), q ? q.qty : null);
  }
  return (
    <form onSubmit={save} className="space-y-2">
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <input aria-label="Ingredient" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ingredient" className="min-h-12 rounded-xl border border-butter/30 bg-butter/10 px-3 text-butter" />
        <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="35 g" className="min-h-12 rounded-xl border border-butter/30 bg-butter/10 px-3 font-mono text-butter" />
      </div>
      {error && <p className="text-sm text-saffron">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="min-h-11 rounded-xl bg-butter px-4 font-semibold text-cocoa">Save</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl px-3 text-butter/70">Cancel</button>
        {onRemove && <button type="button" onClick={onRemove} className="ml-auto min-h-11 px-3 text-sm text-butter/60 underline">Remove</button>}
      </div>
    </form>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-cocoa px-6 text-center">{children}</div>;
}

// Sausage day: the approved plan, the meat weighed so far and the seasonings
// for that weight, plus one big button per stage for messy hands.
function PlanPanel({ session, onSay }: { session: CookingSession; onSay: (text: string) => void }) {
  const plan = session.plan!;
  const w = weighedMeat(session, plan);
  const basis = seasoningBasis(session, plan);
  const done = new Set((session.stageLog ?? []).filter((x) => x.action === "finished").map((x) => x.stage));
  return (
    <section aria-label="Today's plan" className="rounded-2xl border border-saffron/50 bg-butter/10 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-saffron">Today's plan · {plan.planTitle}</p>
      <p className="mt-1 text-sm text-butter/80">{plan.meats.map((m) => `${m.name} ${gramsText(m.plannedG)}`).join(" · ")}</p>
      <p className="mt-1 text-sm">{w.totalG ? `Weighed: ${gramsText(w.totalG)}${w.complete ? " ✓" : ` — still to weigh: ${w.missing.join(", ")}`}` : "Say each weight: “the pork weighs 3 kilos”."}</p>
      {plan.seasonings.length > 0 && (
        <ul className="mt-2 divide-y divide-butter/10">
          {plan.seasonings.map((x) => {
            const a = amountFor(x, basis.g);
            return <li key={x.raw} className="flex justify-between gap-3 py-1.5"><span>{x.name}{x.cure ? " ⚠" : ""}</span><span className="font-mono text-xl font-bold tabular-nums">{a.text || "—"}</span></li>;
          })}
        </ul>
      )}
      <p className="mt-1 text-xs text-butter/60">For {basis.words}.</p>
      <p className="mt-2 text-sm font-semibold">{plan.poultry ? "Contains chicken: cook to 74 °C (165 °F)." : "Cook to 71 °C (160 °F)."} Keep everything at 4 °C or colder.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STAGES.map((st) => (
          <button key={st} type="button" onClick={() => onSay(STAGE_SAY[st])}
            className={`min-h-14 rounded-xl border text-base font-semibold ${done.has(st) ? "border-saffron bg-saffron/25" : "border-butter/30"}`}>
            {done.has(st) ? "✓ " : ""}{STAGE_LABEL[st]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-butter/60">Tap a stage when it's done, or just say it: “I've finished grinding the pork, now the chicken.”</p>
    </section>
  );
}
