import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { ingredientsForStep, stepsFromText, timerIn } from "./ideas/cookSteps";
import { sampleById } from "./ideas/sampleIdeas";
import { ingredientLine, scaleIngredient } from "./ideas/scale";
import type { Ingredient } from "./ideas/types";
import { display } from "./components";

type Timer = { id: number; step: number; label: string; endsAt: number; total: number; rang: boolean };

const SIZES = ["text-[1.7rem] sm:text-4xl", "text-[2rem] sm:text-5xl", "text-[2.4rem] sm:text-6xl"];

// Big text, one step at a time, screen kept awake. Timers keep running while
// you move between steps, and ring when they're done. Works for an example
// idea or a real family recipe (read only — finishing doesn't record anything).
export function CookMode() {
  const { kind, id = "" } = useParams<{ kind: "idea" | "saved"; id: string }>();
  const [params] = useSearchParams();
  const { store } = useKitchen();
  const savedRecipe = useLoad(() => (kind === "saved" ? store.getRecipe(id) : Promise.resolve(null)), [store, kind, id]);

  let title = "", steps: string[] = [], ingredients: string[] = [], structured: Ingredient[] = [], back = "/ideas", serves: number | null = null;
  if (kind === "idea") {
    const idea = sampleById(id);
    if (idea) {
      serves = Number(params.get("serves")) || idea.serves;
      title = idea.title;
      steps = idea.steps;
      structured = idea.ingredients.map((i) => scaleIngredient(i, serves! / idea.serves));
      ingredients = structured.map(ingredientLine);
      back = `/ideas/idea/${idea.id}?serves=${serves}`;
    }
  } else if (savedRecipe.data) {
    const r = savedRecipe.data.recipe;
    title = r.title;
    steps = stepsFromText(r.instructions);
    ingredients = r.ingredients.split("\n").map((l) => l.trim()).filter(Boolean);
    back = `/recipe/${encodeURIComponent(r.id)}`;
  }

  const [i, setI] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [size, setSize] = useState(1);
  const timers = useTimers();
  useWakeLock();

  const next = useCallback(() => setI((n) => Math.min(steps.length, n + 1)), [steps.length]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("button, a, input")) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  if (kind === "saved" && savedRecipe.data === undefined && !savedRecipe.error) return <Dark><p className="text-butter/70">Loading…</p></Dark>;
  if (!title) return <Dark><p className="text-butter/70">{savedRecipe.error ?? "Recipe not found."}</p><Link to="/ideas" className="mt-4 text-saffron underline">Back</Link></Dark>;

  const done = i >= steps.length;
  const step = steps[i];
  const minutes = step ? timerIn(step) : null;
  const forStep = step && structured.length ? ingredientsForStep(step, structured) : [];
  const running = timers.list.find((t) => t.step === i);

  return (
    <div className="flex min-h-screen flex-col bg-cocoa text-butter">
      <header className="flex items-center justify-between gap-3 px-5 pt-5">
        <Link to={back} className="rounded-full px-2 py-1.5 text-sm text-butter/70 hover:text-butter">✕ Close</Link>
        <p className={`${display} min-w-0 truncate text-center text-base text-butter/80`}>{title}{serves ? ` · serves ${serves}` : ""}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label="Smaller text" onClick={() => setSize((s) => Math.max(0, s - 1))} disabled={size === 0} className="hidden h-9 w-9 rounded-full bg-butter/10 text-sm disabled:opacity-30 sm:block">A−</button>
          <button type="button" aria-label="Larger text" onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))} disabled={size === SIZES.length - 1} className="hidden h-9 w-9 rounded-full bg-butter/10 text-lg disabled:opacity-30 sm:block">A+</button>
          <button type="button" onClick={() => setShowIngredients((s) => !s)} className="rounded-full bg-butter/10 px-3 py-1.5 text-sm hover:bg-butter/20">
            {showIngredients ? "Steps" : "Ingredients"}
          </button>
        </div>
      </header>

      {steps.length > 0 && (
        <nav className="mx-5 mt-4 flex gap-1" aria-label="Steps">
          {steps.map((_, n) => (
            <button key={n} type="button" onClick={() => { setI(n); setShowIngredients(false); }} aria-label={`Go to step ${n + 1}`} aria-current={n === i ? "step" : undefined} className="flex-1 py-2">
              <span className={`block h-1.5 rounded-full ${n <= i ? "bg-saffron" : "bg-butter/15"}`} />
            </button>
          ))}
        </nav>
      )}

      {timers.list.length > 0 && (
        <div className="mx-5 mt-2 flex flex-wrap gap-2" aria-live="polite">
          {timers.list.map((t) => {
            const left = Math.max(0, Math.round((t.endsAt - timers.now) / 1000));
            const up = left === 0;
            return (
              <div key={t.id} className={`flex items-center gap-2 rounded-full py-1.5 pl-3.5 pr-1.5 text-sm ${up ? "animate-pulse bg-saffron text-cocoa" : "bg-butter/10"}`}>
                <button type="button" onClick={() => { setI(t.step); setShowIngredients(false); }} className="font-semibold tabular-nums">
                  ⏲ Step {t.step + 1} · {up ? "Time!" : clock(left)}
                </button>
                <button type="button" onClick={() => timers.remove(t.id)} aria-label={up ? "Dismiss timer" : "Cancel timer"} className={`grid h-7 w-7 place-items-center rounded-full ${up ? "bg-cocoa/15" : "bg-butter/10"}`}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      <main className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-12">
        {showIngredients ? (
          <div className="mx-auto w-full max-w-2xl">
            <p className="mb-3 text-sm text-butter/60">Tap to tick off as you get things out. Just for now; nothing is saved.</p>
            <ul className="space-y-1 text-xl sm:text-2xl">
              {ingredients.map((l, n) => (
                <li key={n}>
                  <button type="button" onClick={() => setTicked((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })}
                    aria-pressed={ticked.has(n)} className={`flex w-full items-center gap-3 border-b border-butter/10 py-3 text-left ${ticked.has(n) ? "text-butter/40 line-through" : ""}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-base ${ticked.has(n) ? "border-saffron bg-saffron text-cocoa" : "border-butter/30"}`}>{ticked.has(n) ? "✓" : ""}</span>
                    {l}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : steps.length === 0 ? (
          <div className="mx-auto max-w-2xl text-center">
            <p className={`${display} text-3xl`}>Nobody has written the method down yet.</p>
            <p className="mt-3 text-butter/70">Tap Ingredients to see what goes in — then maybe add the steps after you've cooked it.</p>
          </div>
        ) : done ? (
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-6xl" aria-hidden>🍽️</p>
            <p className={`${display} mt-4 text-4xl sm:text-5xl`}>Enjoy!</p>
            {kind === "saved" ? (
              <Link to={`/recipe/${encodeURIComponent(id)}/cook`} className="mt-8 inline-block rounded-full bg-saffron px-6 py-3 font-semibold text-cocoa">
                Record how it went
              </Link>
            ) : (
              <p className="mt-4 text-butter/70">In the real version you'd note how it went — what you changed, what the family thought — and confirm what you used from the Pantry. Nothing is taken out of stock until you say so.</p>
            )}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-saffron">Step {i + 1} of {steps.length}</p>
            <p className={`${display} ${SIZES[size]} mt-4 leading-snug sm:leading-tight`}>{step}</p>
            {forStep.length > 0 && (
              <div className="mt-6 rounded-2xl bg-butter/[0.07] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-butter/50">For this step</p>
                <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-lg sm:text-xl">
                  {forStep.map((ing) => <li key={ing.name}>{ingredientLine(ing)}</li>)}
                </ul>
              </div>
            )}
            {minutes !== null && !running && (
              <button type="button" onClick={() => timers.start(i, minutes)} className="mt-6 rounded-full bg-butter/10 px-5 py-3 text-lg hover:bg-butter/20">
                ⏲ Start a {minutes}-minute timer
              </button>
            )}
            {running && (
              <p className="mt-6 text-lg text-butter/70">⏲ Timer running — it keeps going if you move on, and will ring.</p>
            )}
          </div>
        )}
      </main>

      {!showIngredients && steps.length > 0 && (
        <footer className="grid grid-cols-2 gap-3 px-5 pb-6">
          <button type="button" onClick={prev} disabled={i === 0} className="rounded-2xl bg-butter/10 py-5 text-lg font-semibold disabled:opacity-30">← Back</button>
          <button type="button" onClick={next} disabled={done} className="rounded-2xl bg-saffron py-5 text-lg font-semibold text-cocoa disabled:opacity-30">
            {i === steps.length - 1 ? "Done" : "Next →"}
          </button>
        </footer>
      )}
    </div>
  );
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Several timers at once, measured against the clock (so they stay right if
// the tab sleeps). Each rings once — a few beeps, and a buzz on phones.
function useTimers() {
  const [list, setList] = useState<Timer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!list.length) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [list.length]);

  useEffect(() => {
    const due = list.filter((t) => !t.rang && t.endsAt <= now);
    if (!due.length) return;
    ring(audio.current);
    setList((l) => l.map((t) => (due.some((d) => d.id === t.id) ? { ...t, rang: true } : t)));
  }, [now, list]);

  return {
    list, now,
    start(step: number, minutes: number) {
      // Audio needs a tap to start, so set it up now.
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC && !audio.current) audio.current = new AC();
        audio.current?.resume().catch(() => {});
      } catch { /* no sound available; the timer still shows */ }
      const total = Math.round(minutes * 60);
      setNow(Date.now());
      setList((l) => [...l, { id: Date.now(), step, label: `Step ${step + 1}`, endsAt: Date.now() + total * 1000, total, rang: false }]);
    },
    remove(id: number) { setList((l) => l.filter((t) => t.id !== id)); },
  };
}

function ring(ctx: AudioContext | null) {
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  if (!ctx) return;
  for (let n = 0; n < 3; n++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + n * 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.start(t); o.stop(t + 0.3);
  }
}

// Keep the screen on while cooking, where the browser allows it.
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
    let s: Sentinel | null = null;
    wl?.request("screen").then((x) => { s = x; }).catch(() => {});
    return () => { s?.release().catch(() => {}); };
  }, []);
}

function Dark({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-cocoa px-6 text-center">{children}</div>;
}
