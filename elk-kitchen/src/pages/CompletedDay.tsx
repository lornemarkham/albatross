import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PhotoImg } from "../components/Photos";
import { TastingCards } from "../components/TastingCards";
import { useKitchen } from "../context/KitchenContext";
import { SessionDrafts } from "../lib/cooking/drafts";
import { dayOf } from "../lib/sausage/day";
import { CERTAINTY_LABEL, correctIngredients } from "../lib/sausage/finish";
import { PlanStore } from "../lib/sausage/preferences";
import { STAGES, TastingStore, dayStage, type Stage } from "../lib/sausage/tasting";
import { VERSIONS_KEY } from "../lib/sausage/versions";
import type { Certainty, IngredientLine, MadeSausage, SausagePlan } from "../types/sausage";

const STAGE_LABEL: Record<Stage, string> = { planning: "Planning", cooking: "Cooking", completed: "Completed", tasting: "Tasting", rated: "Rated" };
const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// A finished Sausage Day: what was made, ready to taste. The cook's record stays below, as it was.
export function CompletedDay({ initial }: { initial: SausagePlan }) {
  const { myName } = useKitchen();
  const plans = useMemo(() => new PlanStore(window.localStorage), []);
  const tastings = useMemo(() => new TastingStore(window.localStorage).list(), []);
  const [plan, setPlan] = useState(initial);
  const d = dayOf(plan);
  const c = d.completion!;
  const stage = dayStage(plan, tastings);

  function save(next: SausagePlan) { plans.put(next); setPlan(next); }

  // One file with everything about the day, for keeping safe: this record lives on this phone.
  function download() {
    const sessions = new SessionDrafts(window.localStorage).list().filter((s) => c.closedSessionIds.includes(s.id) || s.plan?.planId === plan.id);
    const blob = new Blob([JSON.stringify({ app: "elk-kitchen", kind: "sausage-day-record", savedAt: new Date().toISOString(), plan, tastings: new TastingStore(window.localStorage).list().filter((t) => t.planId === plan.id), sessions, recipeVersions: window.localStorage.getItem(VERSIONS_KEY) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sausage-day-${d.seed ?? plan.id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
      <header className="mt-3 overflow-hidden rounded-3xl bg-tomato p-5 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-widest text-butter">{plan.title.replace(/^Sausage Day —\s*/, "")}</p>
        <h1 className="font-display text-4xl font-bold leading-tight">{stage === "rated" ? "Sausage Day — Rated!" : "Sausage Day — Ready to Taste!"}</h1>
        <p className="mt-1 text-white/85">{c.made.length} sausages made{c.completedBy ? `, recorded by ${c.completedBy}` : ""}.</p>
        <ol className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
          {STAGES.map((s) => <li key={s} className={`rounded-full px-3 py-1 ${s === stage ? "bg-butter text-cocoa" : STAGES.indexOf(s) < STAGES.indexOf(stage) ? "bg-white/30" : "bg-white/10 text-white/70"}`}>{STAGE_LABEL[s]}</li>)}
        </ol>
      </header>

      <div className="mt-4"><TastingCards plan={plan} tastings={tastings} /></div>
      {c.notMade.length > 0 && <p className="mt-3 text-sm text-bark/70">Not made this time (still in your recipes): {c.notMade.map((n) => n.title).join(", ")}.</p>}

      <section className="mt-6">
        <h2 className="font-display text-2xl font-bold text-bark">What went in</h2>
        <p className="text-sm text-bark/70">Rebuilt afterwards from what was recorded. Fix anything you remember; the rebuilt version is kept.</p>
        <div className="mt-2 space-y-3">{c.made.map((m) => <IngredientEditor key={m.recipeId} made={m} onSave={(lines) => save(correctIngredients(plan, m.recipeId, lines, myName || c.completedBy, new Date().toISOString()))} />)}</div>
      </section>

      {d.photos.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-2xl font-bold text-bark">Photos from the day</h2>
          <div className="mt-2 flex flex-wrap gap-2">{d.photos.map((p) => <PhotoImg key={p.id} id={p.id} className="h-24 w-24 rounded-xl" />)}</div>
        </section>
      )}

      <details className="mt-6 rounded-2xl border border-clay bg-white p-4">
        <summary className="cursor-pointer font-display text-xl font-bold text-bark">The cook, as it happened ({d.log.length} notes)</summary>
        <ul className="mt-2 space-y-1 text-sm text-bark">{d.log.map((e) => <li key={e.id}><span className="text-bark/50">{time(e.at)}</span> {e.text}</li>)}</ul>
        {d.equipment.length > 0 && <p className="mt-2 text-sm text-bark/70">Equipment: {d.equipment.join("; ")}</p>}
      </details>

      <button type="button" onClick={download} className="mt-5 min-h-12 w-full rounded-2xl border border-clay bg-cream text-base font-semibold text-bark">Save a copy of this Sausage Day (file)</button>
      <p className="mt-1 text-xs text-bark/60">Sausage Day and its tasting cards live on this phone. The file keeps them safe. Dinner ratings are also in the normal Backup &amp; import.</p>
    </div>
  );
}

const CERTAINTIES: Certainty[] = ["known", "estimate", "planned", "card", "unknown"];

function IngredientEditor({ made, onSave }: { made: MadeSausage; onSave: (lines: IngredientLine[]) => void }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(made.ingredients);
  const set = (id: string, patch: Partial<IngredientLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  return (
    <article className="rounded-2xl border border-clay bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl font-bold text-bark">{made.title}</h3>
        <button type="button" className="text-sm text-sage underline" onClick={() => setOpen(!open)}>{open ? "Close" : "Correct"}</button>
      </div>
      {!open ? (
        <ul className="mt-1 space-y-0.5 text-sm text-bark">
          {made.ingredients.map((l) => <li key={l.id}>{l.name}{l.amount ? `: ${l.amount}` : ""} <span className="text-xs text-bark/55">· {CERTAINTY_LABEL[l.certainty]}</span></li>)}
          {made.corrections.length > 0 && <li className="text-xs text-bark/55">Corrected {made.corrections.length}× — the first rebuild is kept.</li>}
        </ul>
      ) : (
        <div className="mt-2 space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_6rem] gap-2">
              <input className="rounded-lg border border-clay px-2 py-2" aria-label="Ingredient" value={l.name} onChange={(e) => set(l.id, { name: e.target.value })} />
              <input className="rounded-lg border border-clay px-2 py-2" aria-label="Amount" placeholder="amount" value={l.amount} onChange={(e) => set(l.id, { amount: e.target.value })} />
              <select className="col-span-2 rounded-lg border border-clay bg-white px-2 py-2 text-sm" aria-label="How sure" value={l.certainty} onChange={(e) => set(l.id, { certainty: e.target.value as Certainty, source: "Corrected by the cook" })}>
                {CERTAINTIES.map((c) => <option key={c} value={c}>{CERTAINTY_LABEL[c]}</option>)}
              </select>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border border-clay px-3 py-2" onClick={() => setLines((ls) => [...ls, { id: crypto.randomUUID(), name: "", amount: "", certainty: "known", source: "Added by the cook" }])}>+ Add</button>
            <button type="button" className="rounded-xl bg-sage px-4 py-2 font-semibold text-white" onClick={() => { onSave(lines); setOpen(false); }}>Save</button>
          </div>
        </div>
      )}
    </article>
  );
}
