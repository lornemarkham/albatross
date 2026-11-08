import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { PlanStore } from "../lib/sausage/preferences";
import { hasLearning, learningFor } from "../lib/sausage/learning";
import { CERTAINTY_LABEL } from "../lib/sausage/finish";
import { SCORE_KEYS, TastingStore } from "../lib/sausage/tasting";
import { VersionStore, makeNewVersion } from "../lib/sausage/versions";
import { PhotoGallery } from "./Photos";
import { inputClass, primaryButton, secondaryButton, sectionLabel } from "./ui";
import type { Recipe } from "../types/recipe";

// "What we learned": shown on a recipe that has been tasted, so the next cook starts from last time.
// Reads only; the recipe itself changes only when the cook makes a new version.
export function RecipeLearning({ recipe }: { recipe: Recipe }) {
  const { store, myName } = useKitchen();
  const navigate = useNavigate();
  const versions = useMemo(() => new VersionStore(window.localStorage), []);
  const data = useLoad(async () => {
    const [d, fb] = await Promise.all([store.getRecipe(recipe.id), store.listFeedback()]);
    return { entries: d?.entries ?? [], feedback: fb.status === "ready" ? fb.items : [] };
  }, [store, recipe.id]);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data.data) return null;
  const plans = new PlanStore(window.localStorage).list();
  const l = learningFor(recipe, new TastingStore(window.localStorage).list(), data.data.feedback, data.data.entries, plans);
  const chain = versions.chain(recipe.id);
  if (!hasLearning(l) && chain.length < 2) return null;

  async function newVersion() {
    setError(null);
    try {
      const v = await makeNewVersion(store, versions, recipe, {}, reason!.trim(), myName, new Date().toISOString());
      navigate(`/recipe/${encodeURIComponent(v.id)}/edit`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <section className="mt-5 rounded-xl border border-sage/30 bg-sage/10 p-4">
      <p className={sectionLabel}>What we learned</p>
      {l.family.people.length > 0 && (
        <p className="mt-2 text-bark">
          {l.family.average.overall != null && <b>Family average {l.family.average.overall}/10 · </b>}
          {l.family.people.map((p) => `${p.name} ${p.scores.overall ?? "—"}`).join(", ")}
          <span className="block text-sm text-bark/70">{SCORE_KEYS.filter((s) => l.family.average[s.key] != null && s.key !== "overall").map((s) => `${s.label} ${l.family.average[s.key]}`).join(" · ")}</span>
        </p>
      )}
      {l.improvements.length > 0 && <div className="mt-2"><p className="text-sm font-semibold text-bark">Change next time</p><ul className="list-disc pl-5 text-bark">{l.improvements.map((i) => <li key={i.name + i.text}>{i.text} <span className="text-sm text-bark/60">— {i.name}</span></li>)}</ul></div>}
      {l.nudges.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-bark/80">{l.nudges.map((n) => <li key={n}>{n}</li>)}</ul>}
      {l.comments.length > 0 && <div className="mt-2"><p className="text-sm font-semibold text-bark">What the family said</p><ul className="text-bark">{l.comments.map((c) => <li key={c.name + c.text}>“{c.text}” <span className="text-sm text-bark/60">— {c.name}</span></li>)}</ul></div>}
      {l.madeBefore.map((m) => (
        <details key={m.planTitle + m.madeOn} className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-bark">What went in last time ({m.madeOn}){m.corrected ? " · corrected" : ""}</summary>
          <ul className="mt-1 text-sm text-bark">{m.ingredients.map((i) => <li key={i.id}>{i.name}{i.amount ? `: ${i.amount}` : ""} <span className="text-bark/55">· {CERTAINTY_LABEL[i.certainty]}</span></li>)}</ul>
        </details>
      ))}
      {l.photos.length > 0 && <div className="mt-3"><PhotoGallery photos={l.photos} /></div>}
      {chain.length > 1 && (
        <p className="mt-3 text-sm text-bark">Versions: {chain.map((id, i) => <span key={id}>{i > 0 && " → "}{id === recipe.id ? <b>this one</b> : <Link className="text-sage underline" to={`/recipe/${encodeURIComponent(id)}`}>{i === 0 ? "original" : `v${i + 1}`}</Link>}</span>)}</p>
      )}
      {reason === null ? (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setReason("")}>Make an improved version…</button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-bark/80">This keeps the current recipe exactly as it is and starts a new version for you to edit.</p>
          <input className={inputClass} placeholder="What's the change? e.g. less salt" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2"><button type="button" className={primaryButton} disabled={!reason.trim()} onClick={newVersion}>Start new version</button><button type="button" className={secondaryButton} onClick={() => setReason(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}
