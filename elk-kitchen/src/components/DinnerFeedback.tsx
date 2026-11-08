import { useEffect, useState } from "react";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { SCORE_FIELDS, blankFeedbackScores, type FeedbackInput, type FeedbackScores, type MakeAgain, type MealFeedback } from "../types/feedback";
import { hasScores } from "../lib/familyMemory";
import type { CookingEntry } from "../types/recipe";
import { PhotoGallery, PhotoPicker } from "./Photos";
import { inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

// "How was dinner?" — everyone who ate gives their own rating, comment,
// photos, "make it again?" and an improvement. Nobody edits anyone else's;
// changing your own keeps what you said before.

const NAME_KEY = "elk-kitchen-feedback-name";
const AGAIN: { v: MakeAgain; label: string }[] = [{ v: "yes", label: "Yes, again" }, { v: "maybe", label: "Maybe" }, { v: "no", label: "Not again" }];
const againLabel = (v: MakeAgain | null) => AGAIN.find((a) => a.v === v)?.label ?? "";

export function DinnerFeedback({ entry, favourite, onFavourite, onSaved }: { entry: CookingEntry; favourite: boolean; onFavourite: (on: boolean) => void; onSaved?: () => void }) {
  const { store, myName } = useKitchen();
  const shared = store.mode === "family";
  const { data, error, reload } = useLoad(() => store.listFeedback(), [store]);
  const [editing, setEditing] = useState<MealFeedback | "new" | null>(null);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (data === undefined) return <p className="text-sm text-bark/60">Loading feedback…</p>;
  if (data.status === "not-set-up") {
    return <p className="text-sm text-bark/70">Family ratings need the latest <code>kitchen.sql</code> (v5) in the shared database. Ask whoever set up ELK Kitchen to run it.</p>;
  }
  const mineList = data.items.filter((f) => f.entryId === entry.id);
  const myOwn = shared ? mineList.find((f) => f.mine) ?? null : null;

  return (
    <div>
      {mineList.length === 0 && !editing && <p className="text-sm text-bark/70">No one has said how it was yet.</p>}
      <ul className="space-y-3">
        {mineList.map((f) => (
          <li key={f.id} className="rounded-xl border border-clay bg-white/60 p-3">
            {editing !== null && editing !== "new" && editing.id === f.id ? (
              <FeedbackForm entry={entry} base={f} shared={shared} defaultName={f.authorName}
                onDone={() => { setEditing(null); reload(); onSaved?.(); }} onCancel={() => setEditing(null)} />
            ) : (
              <FeedbackCard f={f} canEdit={shared ? f.mine : f.source === "this-device"} onEdit={() => setEditing(f)} />
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        <div className="mt-3 rounded-xl border border-sage/40 bg-white/60 p-3">
          <FeedbackForm entry={entry} base={null} shared={shared} defaultName={shared ? myName : ""}
            onDone={() => { setEditing(null); reload(); onSaved?.(); }} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        editing === null && (!shared || !myOwn) && (
          <button type="button" className={`${primaryButton} mt-3`} onClick={() => setEditing("new")}>
            {shared ? "Add how it was for you" : mineList.length ? "Add someone else's" : "How was it?"}
          </button>
        )
      )}
      <label className="mt-4 flex items-center gap-2 text-sm text-bark">
        <input type="checkbox" checked={favourite} onChange={(e) => onFavourite(e.target.checked)} className="h-5 w-5" />
        {shared ? "A favourite of mine" : "A favourite on this phone"}
      </label>
    </div>
  );
}

function FeedbackCard({ f, canEdit, onEdit }: { f: MealFeedback; canEdit: boolean; onEdit: () => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-bark">
          {f.authorName || "Someone"}
          {f.rating != null && <span className="ml-2 font-normal text-bark/80">★ {f.rating}/10</span>}
          {f.makeAgain && <span className="ml-2 text-sm font-normal text-sage">{againLabel(f.makeAgain)}</span>}
        </p>
        {canEdit && <button type="button" className="text-sm text-sage underline" onClick={onEdit}>Change</button>}
      </div>
      {hasScores(f.scores) && (
        <p className="mt-1 text-sm text-bark/80">{SCORE_FIELDS.filter((s) => f.scores[s.key] != null).map((s) => `${s.label} ${f.scores[s.key]}`).join(" · ")}</p>
      )}
      {f.comment && <p className="mt-1 whitespace-pre-wrap text-bark">{f.comment}</p>}
      {f.improvement && <p className="mt-1 text-sm text-bark/80"><span className="font-semibold text-sage">Next time: </span>{f.improvement}</p>}
      {f.photos.length > 0 && <div className="mt-2"><PhotoGallery photos={f.photos} /></div>}
      <p className="mt-1 text-xs text-bark/50">
        {f.source === "device-import" ? "Typed on a phone and brought in from its backup" : f.source === "this-device" ? "On this phone" : ""}
        {f.history.length > 0 && ` · changed ${f.history.length}× (earlier answers kept)`}
      </p>
    </div>
  );
}

function FeedbackForm({ entry, base, shared, defaultName, onDone, onCancel }: {
  entry: CookingEntry; base: MealFeedback | null; shared: boolean; defaultName: string; onDone: () => void; onCancel: () => void;
}) {
  const { store } = useKitchen();
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (!shared && !base && !defaultName) setName(window.localStorage.getItem(NAME_KEY) ?? "");
  }, []);
  const [rating, setRating] = useState<number | null>(base?.rating ?? null);
  const [scores, setScores] = useState<FeedbackScores>(base?.scores ?? blankFeedbackScores());
  const [detail, setDetail] = useState(hasScores(base?.scores));
  const [comment, setComment] = useState(base?.comment ?? "");
  const [improvement, setImprovement] = useState(base?.improvement ?? "");
  const [again, setAgain] = useState<MakeAgain | null>(base?.makeAgain ?? null);
  const [photos, setPhotos] = useState(base?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input: FeedbackInput = { authorName: name, rating, scores, comment: comment.trim(), improvement: improvement.trim(), makeAgain: again, photos };
      const saved = await store.saveFeedback(entry.id, input, base);
      if (saved.scoresNotSaved) window.alert("Your rating and words are saved. The flavour / seasoning / texture / juiciness scores couldn't be shared yet: the family database needs kitchen.sql v6.");
      if (!shared) window.localStorage.setItem(NAME_KEY, name.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {shared ? (
        <p className="text-sm text-bark/70">From <strong>{defaultName || "you"}</strong> (your name on the family list)</p>
      ) : (
        <label className={labelClass}>Who's this from?
          <input className={inputClass} value={name} disabled={!!base} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={60} />
        </label>
      )}
      <fieldset>
        <legend className={labelClass}>Rating <span className="text-sm font-normal text-bark/60">(optional)</span></legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {Array.from({ length: 11 }, (_, n) => n).map((n) => (
            <button key={n} type="button" aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)}
              className={`h-11 w-11 rounded-full border text-base ${rating === n ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>{n}</button>
          ))}
        </div>
      </fieldset>
      {!detail ? (
        <button type="button" className="text-sm text-sage underline" onClick={() => setDetail(true)}>Rate flavour, seasoning, texture, juiciness (optional)</button>
      ) : (
        <div className="space-y-2 rounded-xl bg-cream/70 p-2">
          {SCORE_FIELDS.map((s) => (
            <fieldset key={s.key}>
              <legend className="text-sm font-semibold text-bark">{s.label} <span className="font-normal text-bark/60">{scores[s.key] ?? "—"}/10</span></legend>
              <div className="mt-1 flex flex-wrap gap-1">
                {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                  <button key={n} type="button" aria-label={`${s.label} ${n}`} aria-pressed={scores[s.key] === n}
                    onClick={() => setScores((x) => ({ ...x, [s.key]: x[s.key] === n ? null : n }))}
                    className={`h-9 w-9 rounded-full border text-sm ${scores[s.key] === n ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>{n}</button>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-bark/60">Leave any blank. A blank score never counts as zero.</p>
        </div>
      )}
      <fieldset>
        <legend className={labelClass}>Make it again?</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {AGAIN.map((a) => (
            <button key={a.v} type="button" aria-pressed={again === a.v} onClick={() => setAgain(again === a.v ? null : a.v)}
              className={`rounded-full border px-4 py-2 ${again === a.v ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>{a.label}</button>
          ))}
        </div>
      </fieldset>
      <label className={labelClass}>What did you think?
        <textarea className={inputClass} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={5000} />
      </label>
      <label className={labelClass}>One thing to change next time
        <textarea className={inputClass} rows={2} value={improvement} onChange={(e) => setImprovement(e.target.value)} maxLength={5000} />
      </label>
      <div><span className={labelClass}>Photos</span><PhotoPicker value={photos} onChange={setPhotos} /></div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryButton} disabled={busy || (!shared && !name.trim())} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
