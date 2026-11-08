import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { addPhoto } from "../lib/photos";
import { canSpeak, primeAudio, ring, speak, stopSpeaking, useListening, useWakeLock } from "../lib/cooking/device";
import { clock } from "../lib/cooking/parse";
import { useDrafts } from "../lib/cooking/useCookingSession";
import { PlanStore, loadPrefs, savePrefs } from "../lib/sausage/preferences";
import { costsFor, fatOf, gramsText, money, usableOf } from "../lib/sausage/plan";
import { cutOf } from "../lib/sausage/cuts";
import { fatComparison, fatText, recommend, substitutionNotes, todayFat } from "../lib/sausage/allocate";
import {
  addDayPhoto, applyRecommendation, approveDay, batchEntryInput, celebrate, dayOf, endDayTimer, exactKg, finishedCount, hearDay,
  inPlanOrder, liveTimers, markStep, meatTotals, nextAction, openQuestions, progressOf, recipePlanOf, repeatBatch, setMeatStatus, setOptional,
  setResult, setStorage, setUsable, startDayTimer, stepStates, type StepState,
} from "../lib/sausage/day";
import { SEED_PREFS, ensureSausageDay } from "../lib/sausage/today";
import { PhotoImg } from "../components/Photos";
import { DinnerFeedback } from "../components/DinnerFeedback";
import { CompletedDay } from "./CompletedDay";
import type { Recipe } from "../types/recipe";
import type { DayPhoto, DayStepKey, MeatStatus, Purchase, SausagePlan } from "../types/sausage";

const usePlans = () => useMemo(() => new PlanStore(window.localStorage), []);
const SPEAK_KEY = "elk-kitchen-sausage-day-speak";
const kgIn = (v: string) => { const n = Number(v.replace(",", ".")); return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null; };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// /sausage-day: today's pre-filled day (made on first open), then the live page.
export function SausageDayPage() {
  const { id } = useParams<{ id: string }>();
  const { store, myName } = useKitchen();
  const plans = usePlans();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (id) return;
    ensureSausageDay(store, plans, new Date().toISOString(), myName).then((p) => navigate(`/sausage-day/${p.id}`, { replace: true }), (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, store, plans, myName, navigate]);
  if (!id) return <div className="p-8 text-center text-bark/70">{error ?? "Getting Sausage Day ready…"}</div>;
  // A finished day opens as the tasting page, never back on the grinding instructions.
  const done = plans.get(id);
  if (done?.day?.completion) return <CompletedDay initial={done} />;
  return <SausageDay id={id} />;
}

function SausageDay({ id }: { id: string }) {
  const { store, photos, myName } = useKitchen();
  const plans = usePlans();
  const drafts = useDrafts();
  const navigate = useNavigate();
  const { data: all, error } = useLoad(() => store.listRecipes(), [store]);
  const feedback = useLoad(() => store.listFeedback(), [store]);
  const [plan, setPlanState] = useState<SausagePlan | null>(() => plans.get(id));
  const latest = useRef(plan);
  latest.current = plan;
  const [heard, setHeard] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [cheer, setCheer] = useState("");
  const [typed, setTyped] = useState("");
  const [speakOn, setSpeakOn] = useState(() => localStorage.getItem(SPEAK_KEY) !== "off");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useWakeLock(true);
  useEffect(() => { localStorage.setItem(SPEAK_KEY, speakOn ? "on" : "off"); }, [speakOn]);
  // A cook who hasn't set preferences gets today's: one coarse grind, large plate, grams.
  const prefs = useMemo(() => { const p = loadPrefs(localStorage); if (!p.grind && !p.plate) { savePrefs(localStorage, SEED_PREFS); return SEED_PREFS; } return p; }, []);

  const recipes = useMemo(() => (plan ? inPlanOrder(plan, (all ?? []) as Recipe[]) : []), [plan, all]);
  const d = plan ? dayOf(plan) : null;
  const ratings = useMemo(() => {
    const out: Record<string, number> = {};
    const items = feedback.data?.status === "ready" ? feedback.data.items : [];
    for (const [rid, eid] of Object.entries(d?.entries ?? {})) out[rid] = items.filter((f) => f.entryId === eid && f.rating != null).length;
    return out;
  }, [feedback.data, d?.entries]);

  // Timers tick and ring once.
  const timers = plan ? liveTimers(plan) : [];
  useEffect(() => {
    if (!timers.length) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timers.length]);
  useEffect(() => {
    const p = latest.current;
    if (!p) return;
    const due = liveTimers(p).filter((t) => Date.parse(t.endsAt) <= now);
    if (!due.length) return;
    ring();
    const at = new Date().toISOString();
    save(due.reduce((acc, t) => endDayTimer(acc, t.id, "done", at), p));
    const msg = `${due.map((t) => t.label).join(" and ")} timer is done.`;
    setCheer(msg);
    say(msg);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: SausagePlan) {
    const n = { ...next, updatedAt: new Date().toISOString() };
    latest.current = n;
    plans.put(n);
    setPlanState(n);
  }
  // A tap: the same rules as speech, with a celebration when something finishes.
  function change(f: (p: SausagePlan) => SausagePlan) {
    const p = latest.current;
    if (!p) return;
    const c = celebrate(p, f(p), recipes, new Date().toISOString(), ratings);
    save(c.plan);
    if (c.cheer) { setCheer(c.cheer); say(c.cheer); }
  }

  function respond(text: string) {
    const p = latest.current;
    if (!p || !text.trim()) return;
    const h = hearDay(p, text, { recipes, now: new Date().toISOString(), by: myName || "the cook", prefs, ratings });
    save(h.plan);
    setHeard(text);
    setChips(h.chips);
    setCheer(dayOf(h.plan).log.slice(dayOf(p).log.length).filter((e) => e.kind === "celebrate").map((e) => e.text).join(" "));
    say(h.reply);
  }
  function say(text: string) {
    if (!speakOn || !text) return;
    mic.hold();
    speak(text, () => mic.release());
  }
  const mic = useListening({ onHeard: respond, keepListening: true });

  if (!plan || !d) return <div className="p-8 text-center text-bark/70">That Sausage Day isn't on this phone. <Link to="/" className="text-sage underline">Kitchen</Link></div>;
  if (error) return <div className="p-8 text-center text-red-700">{error}</div>;
  if (!all) return <div className="p-8 text-center text-bark/60">Loading the recipes…</div>;

  const states = stepStates(plan, recipes, ratings);
  const prog = progressOf(states, recipes.length);
  const next = nextAction(plan, recipes, ratings);
  const reply = d.lastReply || next.text;
  const shownChips = chips.length ? chips : next.chips;
  const totals = meatTotals(plan);
  const listening = mic.state === "listening" || mic.state === "starting";
  const finished = finishedCount(plan);

  async function addFile(file: File | undefined, phase: DayPhoto["phase"], recipeId: string | null) {
    if (!file) return;
    setBusy("Saving photo…");
    try {
      const ref = await addPhoto(photos, file);
      const r = recipes.find((x) => x.id === recipeId);
      change((p) => addDayPhoto(p, { ...ref, caption: `${phase === "before" ? "Before" : phase === "after" ? "Finished" : "During"}${r ? `: ${r.title}` : ""}`, phase, recipeId }));
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(null);
  }

  async function keepBatch(r: Recipe) {
    const p = latest.current!;
    setBusy(`Saving ${r.title} to its recipe…`);
    try {
      // A cook done in the voice helper is already a batch; link it rather than make a second one.
      const sid = p.sessions[r.id];
      const saved = sid ? drafts.get(sid)?.savedEntryId : null;
      const entryId = saved ?? (await store.addCookingEntry(r.id, batchEntryInput(p, r, myName || "", new Date().toISOString()))).id;
      change((x) => ({ ...x, day: { ...dayOf(x), entries: { ...dayOf(x).entries, [r.id]: entryId } } }));
      feedback.reload();
      setBusy(null);
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e));
    }
  }

  const rec = recommend(plan, recipes);
  const questions = openQuestions(plan, recipes);

  return (
    <div className="min-h-screen bg-parchment pb-40">
      <header className="bg-cocoa px-4 pb-5 pt-4 text-butter">
        <div className="mx-auto max-w-3xl">
          <Link to="/" className="text-sm text-butter/70">← Kitchen</Link>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-saffron">{prog.current ? "In progress" : "Done"} · {plan.title.replace(/^Sausage Day —\s*/, "")}</p>
              <h1 className="font-display text-4xl font-bold leading-none">SAUSAGE DAY!</h1>
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-bold tabular-nums">{finished}</p>
              <p className="text-xs text-butter/60">sausages made</p>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-butter/15" role="progressbar" aria-valuenow={prog.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Cooking progress">
            <div className="h-full rounded-full bg-saffron transition-all" style={{ width: `${prog.percent}%` }} />
          </div>
          <p className="mt-1 text-sm text-butter/80">{prog.percent}% · {prog.current ? `Step ${prog.current.n} of 17: ${prog.current.label}` : "Every step done"}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="meat bought" value={exactKg(totals.bought)} sub={money(totals.paid)} />
            <Stat label={totals.weighedAll ? "usable, weighed" : "usable (part estimate)"} value={exactKg(totals.usable)} sub={totals.lossG ? `${exactKg(totals.lossG)} trimmed` : "—"} />
            <Stat label="in batches" value={exactKg(totals.planned)} sub={`${recipes.length} varieties`} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 pt-4">
        {cheer && (
          <button type="button" onClick={() => setCheer("")} className="w-full rounded-2xl bg-saffron p-4 text-left text-lg font-bold text-cocoa shadow-md">🎉 {cheer}</button>
        )}

        <section aria-label="Kitchen says" className="rounded-3xl bg-cocoa p-5 text-butter shadow-md">
          {heard && <p className="text-sm text-butter/60">You said: “{heard}”</p>}
          <p aria-live="polite" className="mt-1 text-xl font-semibold leading-snug">{reply}</p>
          {mic.interim && <p className="mt-1 text-sm italic text-butter/60">{mic.interim}…</p>}
          {mic.error && <p role="alert" className="mt-2 rounded-xl bg-tomato/25 px-3 py-2 text-sm">{mic.error}</p>}
          {shownChips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {shownChips.map((c) => <button key={c} type="button" onClick={() => respond(c)} className="min-h-12 rounded-2xl border border-butter/30 bg-butter/10 px-4 text-base font-semibold">{c}</button>)}
            </div>
          )}
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <button type="button" disabled={!mic.supported} onClick={() => { primeAudio(); stopSpeaking(); if (mic.state !== "off") mic.stop(); else mic.start(); }}
              className={`flex min-h-16 items-center justify-center gap-3 rounded-2xl text-xl font-bold shadow ${listening ? "animate-pulse bg-tomato text-white" : "bg-butter text-cocoa"} disabled:opacity-50`}>
              <span aria-hidden className="text-2xl">🎤</span>{!mic.supported ? "Voice not available here" : listening ? "Listening — tap to stop" : mic.state === "paused-for-reply" ? "Talking…" : "Talk to Kitchen"}
            </button>
            {canSpeak() && <button type="button" onClick={() => { if (speakOn) stopSpeaking(); setSpeakOn(!speakOn); }} aria-pressed={speakOn} className="min-h-16 rounded-2xl border border-butter/30 px-4 text-xl" aria-label="Speak replies">{speakOn ? "🔊" : "🔇"}</button>}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); respond(typed); setTyped(""); }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type: “chicken is done”" aria-label="Tell Kitchen"
              className="min-h-12 flex-1 rounded-xl border border-butter/20 bg-butter/10 px-3 text-base text-butter placeholder:text-butter/40" />
            <button type="submit" disabled={!typed.trim()} className="rounded-xl bg-saffron px-4 font-bold text-cocoa disabled:opacity-40">Send</button>
          </form>
        </section>

        <section aria-label="Timers" className="rounded-2xl border border-clay bg-cream p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-sage">Timers</h2>
            {timers.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                {timers.map((t) => (
                  <div key={t.id} className="rounded-xl bg-white p-3">
                    <p className="truncate text-xs text-bark/60">{t.label}</p>
                    <p className="font-mono text-3xl font-bold tabular-nums text-bark">{clock((Date.parse(t.endsAt) - now) / 1000)}</p>
                    <button type="button" onClick={() => save(endDayTimer(plan, t.id, "cancelled", new Date().toISOString()))} className="text-xs text-bark/60 underline">Cancel</button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {[["Chill meat", 30], ["Rest the mix", 20], ["Soak casings", 30], ["Test patty", 5]].map(([label, min]) => (
                <button key={label} type="button" onClick={() => { primeAudio(); setNow(Date.now()); save(startDayTimer(plan, Number(min) * 60, String(label), new Date().toISOString())); }}
                  className="min-h-11 rounded-full border border-clay bg-white px-3 text-sm font-medium text-bark">⏱ {label} {min} min</button>
              ))}
            </div>
          </section>

        <Steps states={states} recipes={recipes} />

        <section aria-label="Meat">
          <h2 className="mb-2 font-display text-2xl font-bold text-bark">The meat</h2>
          <ul className="space-y-3">
            {plan.purchases.map((p) => <MeatRow key={p.id} p={p} status={d.meat[p.id] ?? "unknown"}
              onStatus={(s) => change((x) => setMeatStatus(x, [p.id], s))}
              onUsable={(g) => change((x) => (g == null ? { ...x, purchases: x.purchases.map((y) => (y.id === p.id ? { ...y, usableG: null } : y)) } : setUsable(x, [p.id], g)))} />)}
          </ul>
          {totals.lossG > 0 && <p className="mt-2 text-sm text-bark/70">Trimming and deboning so far: {exactKg(totals.lossG)}, worth {money(totals.lossCost)} at the price paid.</p>}
        </section>

        <section aria-label="Batch plan" className="rounded-3xl border border-clay bg-cream p-4">
          <h2 className="font-display text-2xl font-bold text-bark">The batches</h2>
          <p className="mt-1 text-sm text-bark/70">Each card's meat ratios are kept: pork butt for the tenderloin and belly, eye of round for the beef, the thighs for chicken. {rec.estimated ? "Meat that isn't weighed yet uses an estimate." : "All from weighed meat."}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => change((x) => applyRecommendation(x, recipes, 1))} aria-pressed={d.scale === 1}
              className={`min-h-14 rounded-2xl border text-base font-semibold ${d.scale === 1 ? "border-sage bg-sage text-white" : "border-clay bg-white text-bark"}`}>As written{rec.maxScale < 1 ? " (not enough meat)" : ""}</button>
            <button type="button" onClick={() => change((x) => applyRecommendation(x, recipes, rec.maxScale))} aria-pressed={d.scale != null && d.scale === rec.maxScale && d.scale !== 1}
              className={`min-h-14 rounded-2xl border text-base font-semibold ${d.scale != null && d.scale === rec.maxScale && d.scale !== 1 ? "border-sage bg-sage text-white" : "border-clay bg-white text-bark"}`}>As much as we can ({Math.round(rec.maxScale * 100)}%)</button>
          </div>
          {rec.leftover.filter((x) => x.g >= 50).length > 0 && Object.keys(plan.alloc).length > 0 && (
            <p className="mt-2 text-sm text-bark/70">Not in a batch: {rec.leftover.filter((x) => x.g >= 50).map((x) => `${exactKg(x.g)} ${x.purchase.name.toLowerCase()}`).join(", ")}. That's fine — it can go in the freezer.</p>
          )}
          <p className="mt-2 text-sm"><Link to={`/plan/${plan.id}`} className="text-sage underline">Adjust any batch by hand</Link> <span className="text-bark/50">(the planner: grams per meat, needed items, Pantry's shopping list)</span></p>
          {questions.length > 0 && (
            <ul className="mt-3 space-y-3">
              {questions.map((q) => (
                <li key={q.key + q.recipeId} className="rounded-2xl border-2 border-saffron/60 bg-butter p-3">
                  <p className="font-semibold text-cocoa">{q.text}</p>
                  <div className="mt-2 flex flex-wrap gap-2">{q.chips.map((c) => <button key={c} type="button" onClick={() => respond(c)} className="min-h-11 rounded-xl border border-cocoa/20 bg-white px-3 text-sm font-semibold text-cocoa">{c}</button>)}</div>
                </li>
              ))}
            </ul>
          )}
          {plan.status === "approved"
            ? <p className="mt-3 rounded-xl bg-sage/15 p-3 text-sm font-semibold text-bark">✓ Approved {plan.approvedAt ? time(plan.approvedAt) : ""}{plan.approvedBy ? ` by ${plan.approvedBy}` : ""}. Changing meat or seasonings will ask again.</p>
            : Object.keys(plan.alloc).length > 0 && (
              <button type="button" onClick={() => change((x) => approveDay(x, recipes, prefs, myName || "the cook", new Date().toISOString()))}
                className="mt-3 min-h-16 w-full rounded-2xl bg-sage text-xl font-bold text-white shadow">
                {questions.length ? "Approve (open questions left out)" : "Approve today's batches"}
              </button>
            )}
        </section>

        {recipes.map((r) => (
          <BatchCard key={r.id} plan={plan} recipe={r} states={states} rating={ratings[r.id] ?? 0}
            change={change} onPhoto={(f) => addFile(f, "after", r.id)} onKeep={() => keepBatch(r)} onRated={() => feedback.reload()}
            onRepeat={() => { const again = repeatBatch(plan, r, new Date().toISOString()); plans.put(again); navigate(`/plan/${again.id}`); }} />
        ))}

        <section aria-label="Photos" className="rounded-2xl border border-clay bg-cream p-4">
          <h2 className="font-display text-2xl font-bold text-bark">Photos</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <FileButton label="📷 Before" onFile={(f) => addFile(f, "before", null)} />
            <FileButton label="📷 During" onFile={(f) => addFile(f, "during", null)} />
          </div>
          {busy && <p role="status" className="mt-2 text-sm text-bark/70">{busy}</p>}
          {d.photos.length > 0 && (
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {d.photos.map((ph) => <li key={ph.id}><PhotoImg id={ph.id} className="aspect-square w-full rounded-xl" /><p className="mt-0.5 truncate text-xs text-bark/60">{ph.caption}</p></li>)}
            </ul>
          )}
        </section>

        <Awards plan={plan} recipes={recipes} feedback={feedback.data?.status === "ready" ? feedback.data.items : []} />

        <section aria-label="Timeline" className="rounded-2xl border border-clay bg-cream p-4">
          <h2 className="font-display text-2xl font-bold text-bark">Today so far</h2>
          <ol className="mt-2 space-y-1.5">
            {[...d.log].reverse().slice(0, 60).map((e) => (
              <li key={e.id} className={`flex gap-3 text-sm ${e.kind === "celebrate" ? "font-semibold text-sage" : e.kind === "said" ? "text-bark/55" : "text-bark"}`}>
                <span className="w-16 shrink-0 tabular-nums text-bark/50">{time(e.at)}</span>
                <span>{ICON[e.kind]} {e.kind === "said" ? `“${e.text}”` : e.text}</span>
              </li>
            ))}
          </ol>
          {!d.finishedAt && !prog.current && <button type="button" onClick={() => save({ ...plan, day: { ...d, finishedAt: new Date().toISOString() } })} className="mt-3 min-h-14 w-full rounded-2xl bg-sage text-lg font-bold text-white">That's Sausage Day done!</button>}
          {!d.finishedAt && <Link to={`/sausage-day/${plan.id}/finish`} className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl border-2 border-sage text-lg font-bold text-sage">Sausage Day is over — record what I made</Link>}
          {!d.finishedAt && prog.current && <button type="button" onClick={() => { if (confirm("Take Sausage Day off the home page? Everything stays here and in the recipes.")) save({ ...plan, day: { ...d, finishedAt: new Date().toISOString() } }); }} className="mt-3 text-sm text-bark/60 underline">Take it off the home page</button>}
          <p className="mt-2 text-xs text-bark/50">Kept on this phone with the day. Each batch you save keeps its own record in the recipe's journal, which goes in Kitchen's backups.</p>
        </section>
      </main>
    </div>
  );
}

const ICON: Record<string, string> = { said: "🗣", step: "✅", meat: "🥩", weight: "⚖️", plan: "📋", adjust: "🧂", photo: "📷", timer: "⏱", result: "🌭", note: "📝", celebrate: "🎉" };

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-xl bg-butter/10 p-2"><p className="font-mono text-lg font-bold tabular-nums">{value}</p><p className="text-[11px] leading-tight text-butter/60">{label}</p><p className="text-xs text-butter/80">{sub}</p></div>;
}

function Steps({ states, recipes }: { states: StepState[]; recipes: Recipe[] }) {
  const [open, setOpen] = useState(false);
  const cur = states.find((s) => !s.done);
  return (
    <section aria-label="Cooking steps" className="rounded-2xl border border-clay bg-cream p-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <h2 className="font-display text-2xl font-bold text-bark">17 steps</h2>
        <span className="text-sm text-sage underline">{open ? "Hide" : "Show all"}</span>
      </button>
      <ol className="mt-2 space-y-1">
        {states.filter((s) => open || s === cur || (!s.done && s.n <= (cur?.n ?? 0) + 1)).map((s) => (
          <li key={s.key} className={`flex items-baseline gap-2 text-base ${s === cur ? "font-bold text-bark" : s.done ? "text-bark/50 line-through" : "text-bark/80"}`}>
            <span className="w-6 shrink-0 tabular-nums">{s.done ? "✓" : s.n}</span>
            <span>{s.label}{s.scope === "batch" && !s.done && s.pending.length < recipes.length && <span className="text-sm font-normal text-bark/60"> — still: {s.pending.map((id) => recipes.find((r) => r.id === id)?.title).join(", ")}</span>}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STATUS: { s: MeatStatus; label: string }[] = [{ s: "grinding", label: "Grinding" }, { s: "ground", label: "Ground ✓" }, { s: "not-using", label: "Not using" }];

function MeatRow({ p, status, onStatus, onUsable }: { p: Purchase; status: MeatStatus; onStatus: (s: MeatStatus) => void; onUsable: (g: number | null) => void }) {
  const u = usableOf(p);
  const f = fatOf(p);
  const cut = cutOf(p.name);
  const loss = p.usableG && p.weightG ? p.weightG - p.usableG : null;
  const cpk = p.price != null && u.g ? (p.price / u.g) * 1000 : null;
  return (
    <li className={`rounded-2xl border bg-white p-3 ${status === "not-using" ? "border-clay opacity-60" : "border-clay"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-bark">{p.name}</p>
        <p className="shrink-0 text-sm text-bark/70">{p.weightG ? exactKg(p.weightG) : "?"} · {money(p.price)}</p>
      </div>
      <p className="text-xs text-bark/60">{status === "unknown" ? "Not confirmed yet" : status === "grinding" ? "Going through the grinder" : status === "ground" ? "Ground" : "Not in today's batches"}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {STATUS.map((x) => <button key={x.s} type="button" onClick={() => onStatus(x.s)} aria-pressed={status === x.s}
          className={`min-h-11 rounded-xl border text-sm font-semibold ${status === x.s ? "border-sage bg-sage text-white" : "border-clay text-bark"}`}>{x.label}</button>)}
      </div>
      <label className="mt-2 block text-xs text-bark/70">Usable meat after trimming / boning (kg)
        <input inputMode="decimal" key={p.usableG ?? "x"} defaultValue={p.usableG ? String(p.usableG / 1000) : ""} onBlur={(e) => onUsable(kgIn(e.target.value))}
          placeholder={u.g ? `not weighed — about ${(u.g / 1000).toFixed(2)}` : "weigh it"} className="mt-1 w-full rounded-xl border border-clay px-3 py-3 text-lg" />
      </label>
      <p className="mt-1 text-xs text-bark/60">
        {u.measured ? `Weighed: ${exactKg(u.g!)}${loss != null && loss > 0 ? ` — ${exactKg(loss)} trimmed (${Math.round((loss / p.weightG!) * 100)}%)` : ""}.` : u.g ? `Estimate ${gramsText(u.range![0])}–${gramsText(u.range![1])}. ${cut.note}` : ""}
        {" "}Fat {f.estimated ? `≈ ${f.pct}% (typical ${f.range![0]}–${f.range![1]}%, an estimate)` : `${f.pct}%`}.{cpk != null && ` ${money(cpk)}/kg usable.`}
      </p>
    </li>
  );
}

const BATCH_TAPS: DayStepKey[] = ["weigh-seasonings", "mix", "liquids", "bind", "sample", "adjust", "stuff", "link"];
const TAP_LABEL: Partial<Record<DayStepKey, string>> = { "weigh-seasonings": "Seasonings weighed", mix: "Mixed", liquids: "Liquids in", bind: "Good bind", sample: "Tasted", adjust: "Seasoning right", stuff: "Stuffed", link: "Linked" };

function BatchCard({ plan, recipe, states, rating, change, onPhoto, onKeep, onRepeat, onRated }: {
  plan: SausagePlan; recipe: Recipe; states: StepState[]; rating: number;
  change: (f: (p: SausagePlan) => SausagePlan) => void; onPhoto: (f: File | undefined) => void; onKeep: () => void; onRepeat: () => void; onRated: () => void;
}) {
  const { store } = useKitchen();
  const d = dayOf(plan);
  const rp = recipePlanOf(plan, recipe);
  const res = plan.results[recipe.id];
  const c = costsFor(rp, res);
  const fat = todayFat(plan, recipe.id);
  const subs = substitutionNotes(recipe, plan);
  const done = new Set(d.done[recipe.id] ?? []);
  const skipped = (k: DayStepKey) => states.find((s) => s.key === k)?.skipped.includes(recipe.id);
  const handwritten = /handwritten notes?:/i.test(recipe.notes) ? recipe.notes.split(/\n\n/)[0] : "";
  const entryId = d.entries[recipe.id];
  const entry = useLoad(async () => (entryId ? (await store.getRecipe(recipe.id)) : null), [store, recipe.id, entryId]);
  const e = entry.data?.entries.find((x) => x.id === entryId) ?? null;
  const photos = d.photos.filter((x) => x.recipeId === recipe.id);
  return (
    <article className="rounded-3xl border border-clay bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-2xl font-bold text-bark">{recipe.title}</h3>
          <p className="text-sm text-bark/70">{rp.meatG ? exactKg(rp.meatG) : "No meat yet"} meat{rp.measured ? " (weighed)" : rp.meatG ? " (from estimates)" : ""} · fat {fatText(fat)} · {rp.poultry ? "cook to 74 °C — has chicken" : "cook to 71 °C"}</p>
        </div>
        <Link to={`/recipe/${encodeURIComponent(recipe.id)}`} className="shrink-0 text-sm text-sage underline">The card</Link>
      </div>

      {rp.meats.length > 0 && <p className="mt-2 text-sm text-bark">{rp.meats.map((m) => `${m.purchase.name} ${exactKg(m.g)}`).join(" · ")}</p>}
      {subs.map((s) => <p key={s} className="mt-1 text-sm text-bark/80"><b>Swap:</b> {s}</p>)}
      {rp.meatG > 0 && <p className="mt-1 text-sm text-bark/80">{fatComparison(recipe, plan)}</p>}
      {handwritten && <p className="mt-2 whitespace-pre-line rounded-xl bg-butter p-2 font-display text-base italic text-cocoa">✍️ {handwritten.replace(/^Handwritten notes?:\s*/i, "")}</p>}

      {rp.meatG > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-sage">Weigh out, in grams</p>
          <ul className="mt-1 divide-y divide-clay/50">
            {rp.seasonings.map((x) => (
              <li key={x.s.raw} className={`flex items-center justify-between gap-3 py-2 ${x.included ? "" : "opacity-50"}`}>
                <span className="text-base text-bark">{x.s.name}
                  <span className="block text-xs text-bark/55">{x.addedToday ? `added today — ${x.tweak?.reason}` : `card: “${x.s.raw}”`}{x.tweak && !x.addedToday && x.tweak.percent ? ` · ${x.tweak.reason}` : ""}</span>
                  {x.s.optional && (
                    <span className="mt-1 flex gap-2">
                      <button type="button" onClick={() => change((p) => setOptional(p, recipe.id, x.s.name, true))} aria-pressed={x.included} className={`rounded-lg border px-2 py-1 text-xs font-semibold ${x.included ? "border-sage bg-sage text-white" : "border-clay"}`}>In</button>
                      <button type="button" onClick={() => change((p) => setOptional(p, recipe.id, x.s.name, false))} aria-pressed={!x.included && d.optional[recipe.id]?.[x.s.name.toLowerCase()] === false} className={`rounded-lg border px-2 py-1 text-xs font-semibold ${!x.included && d.optional[recipe.id]?.[x.s.name.toLowerCase()] === false ? "border-bark bg-bark text-white" : "border-clay"}`}>Out</button>
                      <span className="text-xs text-bark/50">optional</span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-2xl font-bold tabular-nums text-bark">{x.included ? x.text || "—" : "out"}</span>
                  {x.tweak && x.recipeText && x.text !== x.recipeText && <span className="block text-xs text-bark/50 line-through">{x.recipeText}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-2 space-y-1">{rp.safety.filter((s) => s.level === "warn").map((s) => <li key={s.text} className="rounded-lg bg-red-50 px-2 py-1 text-sm text-red-800">⚠ {s.text}</li>)}</ul>
      {/\bsmok/i.test(recipe.title) && <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-sm text-red-800">⚠ Fresh, raw sausage — not shelf-stable or ready-to-eat. Kitchen has no validated cure or smoking process for these: refrigerate or freeze, and cook to 74 °C.</p>}

      {plan.status === "approved" && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BATCH_TAPS.map((k) => {
              const on = done.has(k) || !!skipped(k);
              return (
                <button key={k} type="button" disabled={!!skipped(k)} onClick={() => change((p) => markStep(p, recipe.id, k, !done.has(k)))} aria-pressed={on}
                  className={`min-h-14 rounded-2xl border text-base font-semibold ${on ? "border-sage bg-sage/15 text-bark" : "border-clay text-bark"} disabled:opacity-50`}>
                  {on ? "✓ " : ""}{TAP_LABEL[k]}{skipped(k) ? " (none)" : ""}
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-2xl bg-cream p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-bark/70">Finished weight (kg)
                <input inputMode="decimal" key={`f${res?.finishedG ?? ""}`} defaultValue={res?.finishedG ? String(res.finishedG / 1000) : ""} onBlur={(ev) => change((p) => setResult(p, recipe.id, { finishedG: kgIn(ev.target.value) }))} className="mt-1 w-full rounded-xl border border-clay px-3 py-3 text-lg" />
              </label>
              <label className="text-xs text-bark/70">Sausages
                <input inputMode="numeric" key={`c${res?.count ?? ""}`} defaultValue={res?.count ?? ""} onBlur={(ev) => { const n = Number(ev.target.value); change((p) => setResult(p, recipe.id, { count: ev.target.value.trim() && n > 0 ? Math.round(n) : null })); }} className="mt-1 w-full rounded-xl border border-clay px-3 py-3 text-lg" />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["cooked", "fridge", "freezer"] as const).map((h) => (
                <button key={h} type="button" onClick={() => change((p) => setStorage(p, recipe.id, d.storage[recipe.id] === h ? "" : h))} aria-pressed={d.storage[recipe.id] === h}
                  className={`min-h-12 rounded-xl border text-sm font-semibold ${d.storage[recipe.id] === h ? "border-sage bg-sage text-white" : "border-clay text-bark"}`}>{h === "cooked" ? "🍳 Cooked" : h === "fridge" ? "🧊 Fridge" : "❄️ Freezer"}</button>
              ))}
            </div>
            <p className="mt-2 text-sm text-bark"><b>Meat cost:</b> {money(c.meatCost)}{c.perKg != null && ` · ${money(c.perKg)}/kg ${c.perKgBasis}`}{c.perSausage != null && ` · ${money(c.perSausage)} a sausage`}</p>
            <p className="text-xs text-bark/55">Seasonings and casings aren't counted. Bone and trim are: the price is per usable kg.</p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FileButton label="📷 Finished photo" onFile={onPhoto} />
            {photos.map((ph) => <PhotoImg key={ph.id} id={ph.id} className="h-16 w-16 rounded-xl" />)}
          </div>

          {!entryId ? (
            <button type="button" onClick={onKeep} className="mt-3 min-h-14 w-full rounded-2xl bg-tomato text-lg font-bold text-white shadow">Save this batch to the recipe</button>
          ) : (
            <div className="mt-3 rounded-2xl border border-clay bg-cream p-3">
              <p className="text-sm font-semibold text-bark">✓ Saved in {recipe.title}'s journal {e && <Link className="font-normal text-sage underline" to={`/recipe/${encodeURIComponent(recipe.id)}/batch/${encodeURIComponent(e.id)}`}>open</Link>}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-sage">Family ratings {rating ? `· ${rating}` : ""}</p>
              {e && <DinnerFeedback entry={e} favourite={entry.data?.favourite ?? false} onFavourite={(on) => { store.setFavourite(recipe.id, on).then(() => entry.reload()); }} onSaved={onRated} />}
              <button type="button" onClick={onRepeat} className="mt-3 min-h-12 w-full rounded-xl border border-clay bg-white font-semibold text-bark">🔁 Make this batch again</button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function Awards({ plan, recipes, feedback }: { plan: SausagePlan; recipes: Recipe[]; feedback: { entryId: string; rating: number | null; authorName: string }[] }) {
  const d = dayOf(plan);
  const rows = recipes.map((r) => {
    const fs = feedback.filter((f) => f.entryId === d.entries[r.id] && f.rating != null);
    const avg = fs.length ? fs.reduce((n, f) => n + f.rating!, 0) / fs.length : null;
    const c = costsFor(recipePlanOf(plan, r), plan.results[r.id]);
    return { r, avg, votes: fs.length, count: plan.results[r.id]?.count ?? 0, perSausage: c.perSausage };
  });
  const rated = rows.filter((x) => x.avg != null).sort((a, b) => b.avg! - a.avg!);
  const most = [...rows].sort((a, b) => b.count - a.count)[0];
  const value = rows.filter((x) => x.perSausage != null).sort((a, b) => a.perSausage! - b.perSausage!)[0];
  if (!rated.length && !most?.count) return null;
  return (
    <section aria-label="Awards" className="rounded-3xl bg-cocoa p-5 text-butter">
      <h2 className="font-display text-2xl font-bold">Sausage awards</h2>
      <ul className="mt-2 space-y-2 text-base">
        {rated[0] && <Award icon="🏆" title="Family favourite" body={`${rated[0].r.title} — ${rated[0].avg!.toFixed(1)}/10 from ${rated[0].votes} ${rated[0].votes === 1 ? "vote" : "votes"}`} />}
        {most?.count > 0 && <Award icon="🌭" title="Most sausages" body={`${most.r.title} — ${most.count}`} />}
        {value && <Award icon="💰" title="Best value" body={`${value.r.title} — ${money(value.perSausage)} of meat a sausage`} />}
      </ul>
      {rated.length > 1 && <p className="mt-2 text-sm text-butter/70">Votes: {rated.map((x) => `${x.r.title} ${x.avg!.toFixed(1)}`).join(" · ")}</p>}
    </section>
  );
}
const Award = ({ icon, title, body }: { icon: string; title: string; body: string }) => <li><span aria-hidden>{icon}</span> <b>{title}:</b> {body}</li>;

function FileButton({ label, onFile }: { label: string; onFile: (f: File | undefined) => void }): ReactNode {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-clay bg-white px-3 text-sm font-semibold text-bark">
      {label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
