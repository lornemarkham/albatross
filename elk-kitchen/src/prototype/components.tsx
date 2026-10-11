import { Link } from "react-router-dom";
import type { RecipeSummary } from "../types/recipe";
import { answerKey, type PantryFit } from "./ideas/pantryMatch";
import { NUTRIENTS, PROVENANCE_LABEL, formatNutrient, type Nutrition } from "./ideas/nutrition";
import type { SampleSuggestion, SavedSuggestion } from "./ideas/suggest";
import { ingredientLine } from "./ideas/scale";
import { useIdeas } from "./IdeasSession";

export const display = "font-[family-name:var(--font-display)]";

export function chipClass(on: boolean) {
  return `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ring-1 ${
    on ? "bg-cocoa text-butter ring-cocoa" : "bg-white/80 text-cocoa ring-cocoa/15 hover:ring-cocoa/40"
  }`;
}

// Illustrated stand-in for a photo. There are no recipe photos yet, and the
// prototype won't borrow anyone else's.
export function FoodArt({ emoji, palette, className = "", big = false }: { emoji: string; palette: [string, string]; className?: string; big?: boolean }) {
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: `radial-gradient(circle at 30% 25%, ${palette[0]} 0%, ${palette[1]} 85%)` }}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 70% 80%, #fff8 0, transparent 45%)" }} />
      <span className={`${big ? "text-[7rem] sm:text-[9rem]" : "text-6xl"} drop-shadow-[0_8px_12px_rgba(0,0,0,0.25)]`}>{emoji}</span>
    </div>
  );
}

const SAVED_PALETTES: [string, string][] = [["#f3d5b5", "#a47148"], ["#e9edc9", "#ccd5ae"], ["#ffe8d6", "#cb997e"], ["#fefae0", "#dda15e"]];
export function savedPalette(title: string): [string, string] {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SAVED_PALETTES[h % SAVED_PALETTES.length];
}

function Badge({ children, tone }: { children: string; tone: "sample" | "family" }) {
  return (
    <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm ${
      tone === "family" ? "bg-cocoa text-butter" : "bg-white/90 text-cocoa"}`}>
      {children}
    </span>
  );
}

export function Reasons({ reasons, max = 2 }: { reasons: string[]; max?: number }) {
  return (
    <ul className="space-y-1">
      {reasons.slice(0, max).map((r) => (
        <li key={r} className="flex gap-2 text-sm leading-snug text-cocoa/85">
          <span className="text-saffron" aria-hidden>●</span>{r}
        </li>
      ))}
    </ul>
  );
}

export function SampleCard({ s, serves }: { s: SampleSuggestion; serves?: number | null }) {
  const { idea, fit } = s;
  return (
    <Link
      to={`/ideas/idea/${idea.id}${serves ? `?serves=${serves}` : ""}`}
      className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-[0_2px_0_rgba(61,44,34,0.06),0_12px_30px_-12px_rgba(61,44,34,0.25)] ring-1 ring-cocoa/5 transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_rgba(61,44,34,0.35)]"
    >
      <div className="relative">
        <FoodArt emoji={idea.emoji} palette={idea.palette} className="aspect-[4/3] transition group-hover:scale-[1.02]" />
        <Badge tone="sample">Sample idea</Badge>
        <span className="absolute right-3 top-3 rounded-full bg-cocoa/80 px-2.5 py-1 text-xs font-semibold text-butter">~{idea.minutes} min</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className={`${display} text-xl leading-tight text-cocoa`}>{idea.title}</h3>
        <Reasons reasons={s.reasons} />
        <p className="mt-auto pt-1 text-xs font-medium text-leaf">{fitLine(fit)}</p>
      </div>
    </Link>
  );
}

export function fitLine(fit: PantryFit): string {
  if (fit.total > 0 && fit.have === fit.total) return "✓ You have everything";
  return `🫙 ${fit.headline}`;
}

export function SavedCard({ s }: { s: SavedSuggestion | { recipe: RecipeSummary; reasons: string[] } }) {
  const r = s.recipe;
  return (
    <Link
      to={`/recipe/${encodeURIComponent(r.id)}`}
      className="group flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-[0_2px_0_rgba(61,44,34,0.06),0_12px_30px_-12px_rgba(61,44,34,0.25)] ring-1 ring-cocoa/5 transition hover:-translate-y-0.5"
    >
      <div className="relative">
        <FoodArt emoji="📖" palette={savedPalette(r.title)} className="aspect-[4/3]" />
        <Badge tone="family">Family recipe</Badge>
        {r.favourite && <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-sm" aria-label="Your favourite">★</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className={`${display} text-xl leading-tight text-cocoa`}>{r.title}</h3>
        {r.authorName && <p className="text-sm text-cocoa/60">from {r.authorName}</p>}
        <Reasons reasons={s.reasons} />
      </div>
    </Link>
  );
}

// Each ingredient with what Kitchen actually knows about it.
export function PantryCheck({ fit, factor }: { fit: PantryFit; factor: number }) {
  const { answer, answers, pantryMode } = useIdeas();
  const missing = fit.statuses.filter((s) => s.status.state === "out");
  return (
    <div>
      <div className={`rounded-2xl px-4 py-3 ${fit.total > 0 && fit.have === fit.total ? "bg-leaf/10 text-leaf" : "bg-saffron/15 text-cocoa"}`}>
        <p className="font-semibold">{fitLine(fit)}</p>
        <p className="mt-0.5 text-xs opacity-80">
          {pantryMode === "sample"
            ? "Checked against the sample Pantry. Pantry counts packages, not amounts, so Kitchen can't tell whether 1 bag is enough."
            : "Pantry isn't connected, so Kitchen asks instead of guessing."}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-cocoa/10">
        {fit.statuses.map(({ ingredient, status }) => {
          const scaled = ingredient.qty === null ? ingredient : { ...ingredient, qty: ingredient.qty * factor };
          const key = answerKey(ingredient);
          return (
            <li key={ingredient.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
              <span className={`text-[15px] ${status.state === "basic" ? "text-cocoa/60" : "text-cocoa"}`}>{ingredientLine(scaled)}</span>
              {status.state === "have" && (
                <span className="text-xs font-medium text-leaf">
                  ✓ {status.evidence}
                  {status.useSoon && <span className="ml-1 rounded bg-tomato/10 px-1.5 py-0.5 text-tomato">use soon</span>}
                  {status.source === "you-said" && <UndoAnswer onClick={() => answer(key, null)} />}
                </span>
              )}
              {status.state === "out" && (
                <span className="text-xs font-medium text-tomato">
                  ✕ {status.evidence}
                  {answers[key] && <UndoAnswer onClick={() => answer(key, null)} />}
                </span>
              )}
              {status.state === "ask" && (
                <span className="flex items-center gap-1.5 text-xs text-cocoa/70">
                  {status.question}
                  <button type="button" onClick={() => answer(key, "yes")} className="rounded-full bg-leaf/10 px-2.5 py-1 font-semibold text-leaf hover:bg-leaf/20">Yes</button>
                  <button type="button" onClick={() => answer(key, "no")} className="rounded-full bg-cocoa/5 px-2.5 py-1 font-semibold text-cocoa/70 hover:bg-cocoa/10">No</button>
                </span>
              )}
              {status.state === "basic" && <span className="text-xs text-cocoa/40">basic — not checked</span>}
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-cocoa/70">Need: {missing.map((m) => m.ingredient.name).join(", ")}</span>
          <button type="button" disabled className="rounded-full bg-cocoa/5 px-3 py-1 text-xs text-cocoa/50" title="No shopping list exists yet (doctrine Q9)">
            Add to shopping list · not built yet
          </button>
        </div>
      )}
    </div>
  );
}

function UndoAnswer({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="ml-1.5 text-cocoa/40 underline hover:text-cocoa">change</button>;
}

export function NutritionPanel({ nutrition, note }: { nutrition: Nutrition; note: string }) {
  const known = Object.keys(nutrition.perServing).length;
  return (
    <section className="rounded-3xl bg-white p-5 ring-1 ring-cocoa/10">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={`${display} text-xl text-cocoa`}>Nutrition</h3>
        <span className="text-xs text-cocoa/50">{nutrition.servingKnown ? "per serving" : "serving size not recorded"}</span>
      </div>
      <dl className="mt-3 grid grid-cols-5 gap-1.5 text-center">
        {NUTRIENTS.map((n) => {
          const v = nutrition.perServing[n.key];
          return (
            <div key={n.key} className={`rounded-2xl px-1 py-2.5 ${v ? "bg-butter" : "border border-dashed border-cocoa/15 bg-cocoa/[0.03]"}`}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-cocoa/60 sm:text-[11px]">{n.label === "Carbohydrates" ? "Carbs" : n.label}</dt>
              <dd className={`mt-1 text-sm font-semibold ${v ? "text-cocoa" : "text-cocoa/35"}`}>
                {v ? formatNutrient(v, n.unit) : "—"}
              </dd>
              {v && <dd className="mt-1 text-[10px] font-medium text-saffron">{PROVENANCE_LABEL[v.provenance].short}</dd>}
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-cocoa/60">
        {known === 0 ? "Not known yet. " : ""}{note}
      </p>
      <details className="mt-2 text-xs text-cocoa/60">
        <summary className="cursor-pointer font-medium text-cocoa/70">How Kitchen labels nutrition</summary>
        <ul className="mt-2 space-y-1">
          {(Object.keys(PROVENANCE_LABEL) as (keyof typeof PROVENANCE_LABEL)[]).map((k) => (
            <li key={k}><strong className="text-cocoa">{PROVENANCE_LABEL[k].short}:</strong> {PROVENANCE_LABEL[k].long}</li>
          ))}
          <li><strong className="text-cocoa">—</strong> Not known. Kitchen leaves it blank rather than guess.</li>
        </ul>
      </details>
    </section>
  );
}

export function PrototypeRibbon() {
  return (
    <div className="bg-cocoa px-4 py-2 text-center text-xs text-butter/90">
      <strong className="font-semibold text-butter">Prototype.</strong> Ideas and chat replies are simulated. Your family recipes are real, and nothing on these pages is saved.{" "}
      <a href="/ideas#whats-real" className="underline decoration-butter/40 underline-offset-2 hover:decoration-butter">What's real?</a>
    </div>
  );
}

export function PrototypeHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-5 sm:px-6">
      <Link to="/ideas" className={`${display} text-lg font-semibold text-cocoa`}>ELK Kitchen</Link>
      <Link to="/" className="rounded-full bg-white/70 px-3.5 py-1.5 text-sm font-medium text-cocoa ring-1 ring-cocoa/10 hover:bg-white">📖 Recipe book</Link>
    </header>
  );
}
