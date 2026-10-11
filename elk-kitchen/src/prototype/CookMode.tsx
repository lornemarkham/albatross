import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { stepsFromText, timerIn } from "./ideas/cookSteps";
import { sampleById } from "./ideas/sampleIdeas";
import { ingredientLine, scaleIngredient } from "./ideas/scale";
import { display } from "./components";

// Big text, one step at a time, screen kept awake. Works for a sample idea
// or a real family recipe (read only — finishing doesn't record anything).
export function CookMode() {
  const { kind, id = "" } = useParams<{ kind: "idea" | "saved"; id: string }>();
  const [params] = useSearchParams();
  const { store } = useKitchen();
  const savedRecipe = useLoad(() => (kind === "saved" ? store.getRecipe(id) : Promise.resolve(null)), [store, kind, id]);

  let title = "", steps: string[] = [], ingredients: string[] = [], back = "/ideas";
  if (kind === "idea") {
    const idea = sampleById(id);
    if (idea) {
      const serves = Number(params.get("serves")) || idea.serves;
      title = idea.title;
      steps = idea.steps;
      ingredients = idea.ingredients.map((i) => ingredientLine(scaleIngredient(i, serves / idea.serves)));
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
  useWakeLock();

  if (kind === "saved" && savedRecipe.data === undefined && !savedRecipe.error) return <Dark><p className="text-butter/70">Loading…</p></Dark>;
  if (!title) return <Dark><p className="text-butter/70">{savedRecipe.error ?? "Recipe not found."}</p><Link to="/ideas" className="mt-4 text-saffron underline">Back</Link></Dark>;

  const done = i >= steps.length;
  const step = steps[i];

  return (
    <div className="flex min-h-screen flex-col bg-cocoa text-butter">
      <header className="flex items-center justify-between gap-3 px-5 pt-5">
        <Link to={back} className="text-sm text-butter/60 hover:text-butter">✕ Close</Link>
        <p className={`${display} truncate text-center text-base text-butter/80`}>{title}</p>
        <button type="button" onClick={() => setShowIngredients((s) => !s)} className="rounded-full bg-butter/10 px-3 py-1.5 text-sm hover:bg-butter/20">
          {showIngredients ? "Steps" : "Ingredients"}
        </button>
      </header>

      {steps.length > 0 && (
        <div className="mx-5 mt-4 flex gap-1" aria-hidden>
          {steps.map((_, n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= i ? "bg-saffron" : "bg-butter/15"}`} />)}
        </div>
      )}

      <main className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-12">
        {showIngredients ? (
          <ul className="mx-auto w-full max-w-2xl space-y-3 text-xl sm:text-2xl">
            {ingredients.map((l) => <li key={l} className="border-b border-butter/10 pb-3">{l}</li>)}
          </ul>
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
            <p className={`${display} mt-4 text-[1.9rem] leading-snug sm:text-5xl sm:leading-tight`}>{step}</p>
            <StepTimer key={i} minutes={timerIn(step)} />
          </div>
        )}
      </main>

      {!showIngredients && steps.length > 0 && (
        <footer className="grid grid-cols-2 gap-3 px-5 pb-6">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="rounded-2xl bg-butter/10 py-5 text-lg font-semibold disabled:opacity-30">← Back</button>
          <button type="button" onClick={() => setI((n) => Math.min(steps.length, n + 1))} disabled={done} className="rounded-2xl bg-saffron py-5 text-lg font-semibold text-cocoa disabled:opacity-30">
            {i === steps.length - 1 ? "Done" : "Next →"}
          </button>
        </footer>
      )}
    </div>
  );
}

function StepTimer({ minutes }: { minutes: number | null }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const t = setTimeout(() => setLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  if (!minutes) return null;
  if (left === null) {
    return (
      <button type="button" onClick={() => setLeft(Math.round(minutes * 60))} className="mt-8 rounded-full bg-butter/10 px-5 py-3 text-lg hover:bg-butter/20">
        ⏲ Start a {minutes}-minute timer
      </button>
    );
  }
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return (
    <div className="mt-8 flex items-center gap-4">
      <p className={`text-5xl font-semibold tabular-nums ${left === 0 ? "animate-pulse text-saffron" : ""}`}>{left === 0 ? "Time!" : `${mm}:${ss}`}</p>
      <button type="button" onClick={() => setLeft(null)} className="text-sm text-butter/60 underline">Reset</button>
    </div>
  );
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
