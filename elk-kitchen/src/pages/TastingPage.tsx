import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { PlanStore } from "../lib/sausage/preferences";
import { dayOf } from "../lib/sausage/day";
import { CERTAINTY_LABEL, madeOf } from "../lib/sausage/finish";
import { ensureEntry, mirrorToFeedback } from "../lib/sausage/record";
import { SCORE_KEYS, TastingStore, blankScores, familyView, type Scores, type Tasting } from "../lib/sausage/tasting";
import { PhotoImg, PhotoPicker } from "../components/Photos";
import { inputClass, labelClass, primaryButton, secondaryButton } from "../components/ui";
import type { MakeAgain } from "../types/feedback";
import type { PhotoRef } from "../types/recipe";
import type { MadeSausage, SausagePlan } from "../types/sausage";

const NAME_KEY = "elk-kitchen-feedback-name";
const AGAIN: { v: MakeAgain; label: string }[] = [{ v: "yes", label: "Yes" }, { v: "maybe", label: "Maybe" }, { v: "no", label: "No" }];

// One sausage's tasting card: each person rates it on their own, can save part of it and come back, and can change it later.
export function TastingPage() {
  const { planId = "", recipeId = "" } = useParams<{ planId: string; recipeId: string }>();
  const { store, myName } = useKitchen();
  const plans = useMemo(() => new PlanStore(window.localStorage), []);
  const tastings = useMemo(() => new TastingStore(window.localStorage), []);
  const [plan, setPlan] = useState<SausagePlan | null>(() => plans.get(planId));
  const [cards, setCards] = useState<Tasting[]>(() => tastings.forSausage(planId, recipeId));
  const [editing, setEditing] = useState<Tasting | "new" | null>(null);
  const shared = store.mode === "family";
  const m = plan ? madeOf(plan).find((x) => x.recipeId === recipeId) : undefined;
  const feedback = useLoad(() => store.listFeedback(), [store, cards.length]);
  if (!plan || !m) return <p className="p-8 text-center text-bark/70">That sausage isn't on this phone. <Link to="/" className="text-sage underline">Home</Link></p>;

  const others = feedback.data?.status === "ready" && m.entryId ? feedback.data.items.filter((f) => f.entryId === m.entryId).map((f) => ({ name: f.authorName, rating: f.rating, makeAgain: f.makeAgain })) : [];
  const fam = familyView(cards, others);
  const refresh = () => setCards(tastings.forSausage(planId, recipeId));
  const mine = shared ? cards.find((c) => c.author.toLowerCase() === myName.toLowerCase()) : undefined;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to={`/sausage-day/${plan.id}`} className="text-sm font-medium text-sage hover:underline">← Sausage Day</Link>
      <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-bark">{m.title}</h1>
      <p className="text-sm font-semibold uppercase tracking-wide text-sage">Made {m.madeOn} · {cards.some((c) => c.status === "complete") ? "Rated" : cards.length ? "Rating started" : "Awaiting tasting"}</p>

      <section className="mt-5 rounded-3xl border border-clay bg-white p-4">
        <h2 className="font-display text-2xl font-bold text-bark">Family ratings</h2>
        {fam.people.length === 0 && <p className="mt-1 text-bark/70">Nobody has rated it yet.</p>}
        <ul className="mt-2 divide-y divide-clay/50">
          {fam.people.map((p) => {
            const card = cards.find((c) => c.author === p.name);
            return (
              <li key={p.name} className="flex items-center justify-between gap-3 py-2">
                <span className="text-bark"><b>{p.name}</b>{" "}
                  <span className="text-sm text-bark/70">{p.scores.overall != null ? `${p.scores.overall}/10` : "no overall score yet"}{p.status === "partial" ? " · unfinished" : p.status === "rating-only" ? " · overall only" : ""}</span>
                </span>
                {card && (!shared || card.author.toLowerCase() === myName.toLowerCase()) && <button type="button" className="text-sm text-sage underline" onClick={() => setEditing(card)}>Change</button>}
              </li>
            );
          })}
        </ul>
        {fam.raters > 0 && <p className="mt-2 text-lg font-bold text-bark">Family average: {fam.average.overall}/10 <span className="text-sm font-normal text-bark/70">({fam.raters} {fam.raters === 1 ? "person" : "people"})</span></p>}
        <p className="mt-2 text-xs text-bark/60">
          {shared
            ? "Overall ratings are shared with the family. Seasoning, texture and juiciness scores stay on this phone until the shared database is updated."
            : "These are the ratings given on this phone. Ratings from other phones or accounts only appear here once the family database is set up."}
        </p>
      </section>

      {editing ? (
        <TastingForm key={editing === "new" ? "new" : editing.id} plan={plan} made={m} base={editing === "new" ? null : editing} tastings={tastings}
          defaultName={shared ? myName : editing === "new" ? window.localStorage.getItem(NAME_KEY) ?? "" : editing.author} shared={shared}
          onSaved={(next) => { setPlan(next); setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" className={`${primaryButton} mt-4 min-h-14 w-full text-lg`} onClick={() => setEditing(mine ?? "new")}>
          {mine ? "Change my rating" : cards.length ? "Add someone else's rating" : "Rate it"}
        </button>
      )}

      <CookNotes plan={plan} made={m} />
    </div>
  );
}

function Scale({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <fieldset>
      <legend className={labelClass}>{label} <span className="text-sm font-normal text-bark/60">{value != null ? `${value}/10` : "(optional)"}</span></legend>
      <div className="mt-1 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}
            className={`h-12 rounded-xl border text-lg ${value === n ? "border-sage bg-sage font-bold text-white" : "border-clay bg-cream text-bark"}`}>{n}</button>
        ))}
      </div>
    </fieldset>
  );
}

function TastingForm({ plan, made, base, tastings, defaultName, shared, onSaved, onCancel }: {
  plan: SausagePlan; made: MadeSausage; base: Tasting | null; tastings: TastingStore; defaultName: string; shared: boolean;
  onSaved: (plan: SausagePlan) => void; onCancel: () => void;
}) {
  const { store } = useKitchen();
  const [name, setName] = useState(defaultName);
  const [scores, setScores] = useState<Scores>(base?.scores ?? blankScores());
  const [again, setAgain] = useState<MakeAgain | null>(base?.makeAgain ?? null);
  const [change, setChange] = useState(base?.change ?? "");
  const [notes, setNotes] = useState(base?.notes ?? "");
  const [photos, setPhotos] = useState<PhotoRef[]>(base?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const t = tastings.save(plan.id, made.recipeId, { author: name, scores, makeAgain: again, change, notes, photos }, base);
      if (!shared) window.localStorage.setItem(NAME_KEY, name.trim());
      let next = plan;
      // The overall rating also goes to Kitchen's dinner feedback; if that fails the card itself is safe.
      try {
        const e = await ensureEntry(store, new PlanStore(window.localStorage), plan, made.recipeId, name.trim());
        next = e.plan;
        await mirrorToFeedback(store, e.entryId, t);
      } catch (e) {
        setMsg(`Saved on this phone. It couldn't be added to the shared dinner ratings yet: ${e instanceof Error ? e.message : String(e)}`);
        setBusy(false);
        onSaved(next);
        return;
      }
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-4 space-y-4 rounded-3xl border border-sage/40 bg-white p-4">
      <h2 className="font-display text-2xl font-bold text-bark">{base ? `${base.author}'s rating` : "Rate it"}</h2>
      {shared ? <p className="text-sm text-bark/70">From <strong>{defaultName || "you"}</strong></p> : (
        <label className={labelClass}>Who's rating?
          <input className={inputClass} value={name} disabled={!!base} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} />
        </label>
      )}
      {SCORE_KEYS.map((s) => <Scale key={s.key} label={s.label} value={scores[s.key]} onChange={(v) => setScores((x) => ({ ...x, [s.key]: v }))} />)}
      <fieldset>
        <legend className={labelClass}>Would you make it again?</legend>
        <div className="mt-1 flex gap-2">
          {AGAIN.map((a) => (
            <button key={a.v} type="button" aria-pressed={again === a.v} onClick={() => setAgain(again === a.v ? null : a.v)}
              className={`min-h-12 flex-1 rounded-xl border text-lg ${again === a.v ? "border-sage bg-sage font-bold text-white" : "border-clay bg-cream text-bark"}`}>{a.label}</button>
          ))}
        </div>
      </fieldset>
      <label className={labelClass}>What would you change?
        <textarea className={inputClass} rows={2} value={change} onChange={(e) => setChange(e.target.value)} maxLength={5000} />
      </label>
      <label className={labelClass}>Anything else?
        <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
      </label>
      <div><span className={labelClass}>Photos</span><PhotoPicker value={photos} onChange={setPhotos} /></div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {msg && <p className="text-sm text-amber-800">{msg}</p>}
      <p className="text-sm text-bark/70">You can save part of this and come back to finish it.</p>
      <div className="flex gap-2">
        <button type="button" className={`${primaryButton} min-h-12 flex-1`} disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

// What was recorded during the cook, as it was.
function CookNotes({ plan, made }: { plan: SausagePlan; made: MadeSausage }) {
  const photos = dayOf(plan).photos.filter((p) => p.recipeId === made.recipeId);
  return (
    <section className="mt-5 rounded-3xl border border-clay bg-white p-4">
      <h2 className="font-display text-2xl font-bold text-bark">How it was made</h2>
      <p className="mt-1 text-sm text-bark/80">{made.note}</p>
      {(made.count || made.finishedG) && <p className="mt-1 text-sm text-bark/80">{[made.count ? `${made.count} sausages` : "", made.finishedG ? `${Math.round(made.finishedG)} g finished` : ""].filter(Boolean).join(" · ")}</p>}
      <ul className="mt-2 space-y-1">
        {made.ingredients.map((l) => (
          <li key={l.id} className="text-bark">{l.name}{l.amount ? `: ${l.amount}` : ""}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${l.certainty === "known" ? "bg-sage/20" : "bg-butter text-cocoa"}`}>{CERTAINTY_LABEL[l.certainty]}</span>
          </li>
        ))}
      </ul>
      <Link to={`/sausage-day/${plan.id}`} className="mt-2 inline-block text-sm text-sage underline">Correct the ingredients</Link>
      {photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{photos.map((p) => <PhotoImg key={p.id} id={p.id} className="h-20 w-20 rounded-xl" />)}</div>}
      {made.entryId && <p className="mt-3 text-xs text-bark/60"><Link className="underline" to={`/recipe/${encodeURIComponent(made.recipeId)}`}>Open the recipe</Link></p>}
    </section>
  );
}
