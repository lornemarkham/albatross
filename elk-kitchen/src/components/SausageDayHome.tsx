import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { PlanStore } from "../lib/sausage/preferences";
import { SEED_PLAN_ID, TODAY_SEED, ensureSausageDay } from "../lib/sausage/today";
import { dayOf, exactKg, finishedCount, inPlanOrder, liveTimers, meatTotals, nextAction, progressOf, stepStates } from "../lib/sausage/day";
import { clock } from "../lib/cooking/parse";
import { TastingStore, dayStage } from "../lib/sausage/tasting";
import { TastingCards } from "./TastingCards";
import { PhotoImg } from "./Photos";
import type { Recipe } from "../types/recipe";
import type { SausagePlan } from "../types/sausage";

// Today's pre-filled Sausage Day is set up on this phone during its week, once.
const SEED_UNTIL = "2026-11-21";
const inSeedWeek = (d = new Date().toISOString().slice(0, 10)) => d >= TODAY_SEED && d <= SEED_UNTIL;

// The home page's "SAUSAGE DAY — IN PROGRESS" card: varieties, meat, progress, next action, photos, timers.
export function SausageDayHome() {
  const { store, myName } = useKitchen();
  const plans = useMemo(() => new PlanStore(window.localStorage), []);
  // A finished day (with its tasting cards) comes first; else the live one.
  const [plan, setPlan] = useState<SausagePlan | null>(() => plans.list().find((p) => p.day?.completion) ?? plans.list().find((p) => p.day && !p.day.finishedAt) ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (plan || !inSeedWeek() || plans.get(SEED_PLAN_ID)) return;
    ensureSausageDay(store, plans, new Date().toISOString(), myName).then((p) => { if (!p.day?.finishedAt) setPlan(p); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [plan, store, plans, myName]);
  // Re-read once the day exists: on first open its recipes were only just added.
  const { data: all } = useLoad(() => store.listRecipes(), [store, plan?.id]);
  const { data: fb } = useLoad(() => store.listFeedback(), [store]);
  const [now, setNow] = useState(() => Date.now());
  const timers = plan ? liveTimers(plan) : [];
  useEffect(() => {
    if (!timers.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timers.length]);

  if (error) return <p className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Sausage Day couldn't be set up: {error}</p>;
  if (!plan) return null;
  if (plan.day?.completion) {
    const tastings = new TastingStore(window.localStorage).list();
    const stage = dayStage(plan, tastings);
    return (
      <section className="mb-5 overflow-hidden rounded-3xl bg-tomato p-5 text-white shadow-lg sm:p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-butter">{plan.title.replace(/^Sausage Day —\s*/, "")}</p>
        <h2 className="font-display text-3xl font-bold leading-tight">{stage === "rated" ? "Sausage Day — Rated!" : "Sausage Day — Ready to Taste!"}</h2>
        <p className="mb-4 mt-1 text-sm text-white/85">{plan.day.completion.made.length} sausages made. {stage === "rated" ? "Every one is rated — tap to change a rating." : "Tap one to rate it; you can finish later."}</p>
        <TastingCards plan={plan} tastings={tastings} onDark />
        <Link to={`/sausage-day/${plan.id}`} className="mt-3 block text-center text-sm font-semibold text-butter underline">Open Sausage Day</Link>
      </section>
    );
  }
  const recipes = inPlanOrder(plan, (all ?? []) as Recipe[]);
  const ratings: Record<string, number> = {};
  for (const [rid, eid] of Object.entries(dayOf(plan).entries)) ratings[rid] = fb?.status === "ready" ? fb.items.filter((f) => f.entryId === eid && f.rating != null).length : 0;
  const prog = progressOf(stepStates(plan, recipes, ratings), recipes.length);
  const t = meatTotals(plan);
  const next = recipes.length ? nextAction(plan, recipes, ratings).text : "";
  const photos = dayOf(plan).photos.slice(-4);
  const n = finishedCount(plan);
  return (
    <Link to={`/sausage-day/${plan.id}`} className="mb-5 block overflow-hidden rounded-3xl bg-tomato p-5 text-white shadow-lg sm:p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-butter">{plan.title.replace(/^Sausage Day —\s*/, "")}</p>
      <h2 className="font-display text-3xl font-bold leading-tight">SAUSAGE DAY — {prog.current ? "IN PROGRESS" : "DONE"}</h2>
      <p className="mt-1 text-sm text-white/85">{recipes.map((r) => r.title).join(" · ") || "Loading recipes…"}</p>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-butter" style={{ width: `${prog.percent}%` }} /></div>
      <p className="mt-1 text-sm">{prog.percent}% · {prog.current ? `Step ${prog.current.n}: ${prog.current.label}` : "Every step done"}</p>
      <p className="mt-1 text-sm text-white/85">{exactKg(t.usable)} of meat {t.weighedAll ? "weighed" : "available (part estimate)"} from {exactKg(t.bought)} bought{n ? ` · ${n} sausages made` : ""}</p>
      {next && <p className="mt-3 rounded-2xl bg-white/15 p-3 text-base font-semibold leading-snug">Next: {next}</p>}
      {timers.length > 0 && <p className="mt-2 text-sm font-semibold">⏱ {timers.map((x) => `${x.label} ${clock((Date.parse(x.endsAt) - now) / 1000)}`).join(" · ")}</p>}
      {photos.length > 0 && <div className="mt-3 flex gap-2">{photos.map((p) => <PhotoImg key={p.id} id={p.id} className="h-14 w-14 rounded-xl" />)}</div>}
      <span className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-white text-lg font-bold text-tomato">🎤 Keep cooking</span>
    </Link>
  );
}
