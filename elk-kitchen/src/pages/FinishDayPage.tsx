import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { SessionDrafts } from "../lib/cooking/drafts";
import { PlanStore } from "../lib/sausage/preferences";
import { dayOf, inPlanOrder } from "../lib/sausage/day";
import { finishSausageDay } from "../lib/sausage/record";
import { primaryButton } from "../components/ui";
import type { Recipe } from "../types/recipe";

// "Sausage Day is finished": say which sausages were really made. Kitchen closes the day and
// keeps everything it recorded. Nothing is tasted or rated, and no recipe is removed.
const MADE_TODAY = /potato|breakfast|brat/i;

export function FinishDayPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { store, myName } = useKitchen();
  const navigate = useNavigate();
  const plans = useMemo(() => new PlanStore(window.localStorage), []);
  const plan = plans.get(id);
  const { data: all } = useLoad(() => store.listRecipes(), [store]);
  const [extra, setExtra] = useState<string[]>(["Potato Sausage"]);
  const [other, setOther] = useState("");
  const [off, setOff] = useState<Set<string> | null>(null);
  const [by, setBy] = useState(myName || window.localStorage.getItem("elk-kitchen-feedback-name") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!plan) return <p className="p-8 text-center text-bark/70">That Sausage Day isn't on this phone.</p>;
  if (dayOf(plan).completion) { navigate(`/sausage-day/${plan.id}`, { replace: true }); return null; }
  if (!all) return <p className="p-8 text-center text-bark/70">Loading…</p>;
  const inPlan = inPlanOrder(plan, all as Recipe[]);
  const rank = (t: string) => { const i = [/potato/i, /breakfast/i, /brat/i].findIndex((r) => r.test(t)); return i < 0 ? 9 : i; };
  const names = [...inPlan.map((r) => r.title), ...extra.filter((e) => !inPlan.some((r) => r.title.toLowerCase() === e.toLowerCase()))].sort((a, b) => rank(a) - rank(b));
  const checked = (t: string) => (off ? !off.has(t) : MADE_TODAY.test(t));
  const toggle = (t: string) => setOff((cur) => { const base = cur ?? new Set(names.filter((n) => !MADE_TODAY.test(n))); const n = new Set(base); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const picks = names.filter(checked).map((title) => ({ title, recipeId: inPlan.find((r) => r.title === title)?.id }));
      await finishSausageDay(store, plans, new SessionDrafts(window.localStorage), plan!, picks, new Date().toISOString(), by.trim());
      navigate(`/sausage-day/${plan!.id}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to={`/sausage-day/${plan.id}`} className="text-sm font-medium text-sage hover:underline">← Back to Sausage Day</Link>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">Which sausages did you make?</h1>
      <p className="mt-1 text-bark/80">Tick what was actually made. Kitchen closes the cook and keeps every note, timer, photo and measurement. Nothing is marked as tasted or rated, and no recipe is deleted.</p>
      <ul className="mt-4 space-y-2">
        {names.map((t) => (
          <li key={t}>
            <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-clay bg-white px-4 py-3 text-lg text-bark">
              <input type="checkbox" className="h-6 w-6" checked={checked(t)} onChange={() => toggle(t)} /> {t}
            </label>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = other.trim(); if (t) { setExtra((x) => [...x, t]); setOff((cur) => { const n = new Set(cur ?? names.filter((x) => !MADE_TODAY.test(x))); n.delete(t); return n; }); setOther(""); } }}>
        <input className="min-w-0 flex-1 rounded-xl border border-clay bg-white px-3 py-3" placeholder="Another sausage that was made" value={other} onChange={(e) => setOther(e.target.value)} />
        <button type="submit" className="rounded-xl border border-clay bg-cream px-4">Add</button>
      </form>
      <label className="mt-4 block text-base font-medium text-bark">Your name
        <input className="mt-1 w-full rounded-xl border border-clay bg-white px-3 py-3" value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <p className="mt-4 text-sm text-bark/70">Amounts weren't kept while you were cooking, so each sausage's ingredients are rebuilt only from what was recorded, with every line labelled. You can correct them afterwards; the rebuilt version is kept.</p>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy || !names.some(checked)} onClick={confirm} className={`${primaryButton} mt-4 min-h-14 w-full text-lg`}>
        {busy ? "Closing Sausage Day…" : `Yes — ${names.filter(checked).length} made. Close Sausage Day`}
      </button>
    </div>
  );
}
