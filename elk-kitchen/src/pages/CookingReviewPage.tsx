import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useCookingSession, useDrafts } from "../lib/cooking/useCookingSession";
import { batchFromSession, recipeFromSession, SESSION_MAX_CHARS, sessionSize, type BatchDraft } from "../lib/cooking/summary";
import { resume } from "../lib/cooking/session";
import { DRAFTS_KEY } from "../lib/cooking/drafts";
import { clock } from "../lib/cooking/parse";
import { parseOptionalNumber } from "../lib/recipeModel";
import { CookingJournal, Transcript } from "../components/CookingJournal";
import { FoodSafetyPanel, MeatFields } from "../components/MeatFields";
import { PantryUse } from "../components/PantryUse";
import { inputClass, labelClass, primaryButton, secondaryButton } from "../components/ui";

type Form = Omit<BatchDraft, "rating" | "photos"> & { rating: string };
const formKey = (id: string) => `${DRAFTS_KEY}-review-${id}`;

const TEXT_FIELDS: { name: keyof Form; label: string; rows: number; hint?: string }[] = [
  { name: "ingredientsUsed", label: "What went in", rows: 6, hint: "From what you said. Corrections are shown in brackets." },
  { name: "equipment", label: "Equipment", rows: 2 },
  { name: "timesAndTemps", label: "Temperatures & times", rows: 4 },
  { name: "yieldNote", label: "Finished yield", rows: 1 },
  { name: "tastingNotes", label: "Tasting notes", rows: 3 },
  { name: "substitutions", label: "Substitutions & changes", rows: 2 },
  { name: "familyReaction", label: "Family reaction", rows: 2 },
  { name: "improveNextTime", label: "Next time", rows: 3 },
  { name: "notes", label: "Notes", rows: 4 },
];

// After cooking: check what Kitchen made of it, fix anything, confirm what came
// out of Pantry, then save it as a batch. The original transcript is saved
// with it, untouched.
export function CookingReviewPage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { store, photos } = useKitchen();
  const drafts = useDrafts();
  const { session, recipe, update } = useCookingSession(sessionId);
  const [form, setForm] = useState<Form | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Start from Kitchen's summary, or from what was already edited here.
  useEffect(() => {
    if (!session || recipe === undefined || form) return;
    const saved = localStorage.getItem(formKey(session.id));
    if (saved) { try { setForm(JSON.parse(saved)); setNewTitle(session.recipeTitle); return; } catch { /* start fresh */ } }
    const b = batchFromSession(session, recipe);
    setForm({ ...b, rating: "" });
    setNewTitle(session.recipeTitle);
  }, [session, recipe, form]);
  useEffect(() => { if (form && session) localStorage.setItem(formKey(session.id), JSON.stringify(form)); }, [form, session]);

  if (session === undefined) return null;
  if (session === null) return <Message>This cooking session isn't on this device. <Link to="/cook" className="text-sage underline">Start cooking</Link></Message>;
  if (session.savedEntryId && session.recipeId) {
    return <Message>Saved. <Link className="text-sage underline" to={`/recipe/${encodeURIComponent(session.recipeId)}/batch/${encodeURIComponent(session.savedEntryId)}`}>Open the cooking journal</Link></Message>;
  }
  if (!form) return <Message>Loading…</Message>;

  const kind = recipe?.kind ?? "general";
  const sessionPhotos = batchFromSession(session, recipe ?? null).photos;
  const finishedAt = session.endedAt ?? new Date().toISOString();
  const change = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => f && { ...f, [e.target.name]: e.target.value });

  async function save() {
    if (!form || !session) return;
    setError(null);
    setSaving(true);
    try {
      if (sessionSize(session) > SESSION_MAX_CHARS) throw new Error("This cooking session is too long to save in one batch. Use Backup & import → Export to keep a copy, then contact whoever runs ELK.");
      const rating = parseOptionalNumber(form.rating, 0, 10, "Rating");
      let recipeId = session.recipeId;
      if (!recipeId) {
        // Recorded on the session first, so a retry can't create the recipe twice.
        const r = await store.createRecipe({ ...recipeFromSession(session, newTitle), photos: sessionPhotos.filter((p) => session.events.some((e) => e.kind === "media" && e.media.id === p.id && e.media.finished)).slice(0, 1) });
        recipeId = r.id;
        update((s) => ({ ...s, recipeId: r.id, recipeTitle: r.title }));
      }
      const entry = await store.addCookingEntry(recipeId, {
        ...form,
        cookName: form.cookName.trim(),
        rating,
        photos: sessionPhotos,
        session: { ...session, recipeId, savedEntryId: null },
      });
      update((s) => ({ ...s, recipeId, savedEntryId: entry.id }));
      localStorage.removeItem(formKey(session.id));
      drafts.prune();
      navigate(`/recipe/${encodeURIComponent(recipeId)}/batch/${encodeURIComponent(entry.id)}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32">
      <button type="button" onClick={() => { update(resume); navigate(`/cook/${encodeURIComponent(session.id)}`); }} className="text-sm font-medium text-sage hover:underline">
        ← Back to cooking
      </button>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">Review this cook</h1>
      <p className="mt-1 text-bark/70">
        {session.recipeTitle} · {new Date(session.startedAt).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })} · {clock((Date.parse(finishedAt) - Date.parse(session.startedAt)) / 1000)}
      </p>
      <p className="mt-2 rounded-xl bg-butter px-3 py-2 text-sm text-cocoa">
        Kept on this phone until you save. Kitchen filled this in from what you said — check the amounts. The original transcript is saved with it, unchanged.
      </p>

      {!session.recipeId && (
        <Card title="Save as a new recipe">
          <label htmlFor="newTitle" className={labelClass}>Recipe name</label>
          <input id="newTitle" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className={inputClass} />
          <p className="mt-1 text-xs text-bark/60">Its ingredients start from what went in this time. You can add the method later.</p>
        </Card>
      )}

      <Card title="Batch summary">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="cookedOn" className={labelClass}>Cooked on</label><input id="cookedOn" name="cookedOn" type="date" value={form.cookedOn} onChange={change} className={inputClass} /></div>
          <div><label htmlFor="cookName" className={labelClass}>Cooked by</label><input id="cookName" name="cookName" value={form.cookName} onChange={change} className={inputClass} /></div>
        </div>
        {TEXT_FIELDS.map((f) => (
          <div key={f.name} className="mt-4">
            <label htmlFor={f.name} className={labelClass}>{f.label}</label>
            {f.hint && <p className="text-xs text-bark/60">{f.hint}</p>}
            <textarea id={f.name} name={f.name} rows={f.rows} value={String(form[f.name] ?? "")} onChange={change} className={inputClass} />
          </div>
        ))}
        <div className="mt-4 sm:w-1/2"><label htmlFor="rating" className={labelClass}>Rating (0–10)</label><input id="rating" name="rating" type="number" inputMode="decimal" min={0} max={10} step={0.5} value={form.rating} onChange={change} className={inputClass} /></div>
        {kind !== "general" && (
          <div className="mt-4">
            <MeatFields kind={kind} mode="batch" value={form.details} onChange={(d) => setForm((f) => f && { ...f, details: d })} />
            <FoodSafetyPanel kind={kind} />
          </div>
        )}
      </Card>

      <Card title="ELK Pantry">
        <PantryUse session={session} update={update} defaultName={session.recipeTitle} />
      </Card>

      <Card title="Cooking journal">
        <CookingJournal session={session} />
      </Card>

      <Card title="Transcript (as heard)">
        <Transcript session={session} />
      </Card>

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-clay bg-parchment/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button type="button" disabled={saving} onClick={save} className={`${primaryButton} flex-1 text-lg`}>{saving ? "Saving…" : "Save this cook"}</button>
          <button type="button" disabled={saving} className={secondaryButton}
            onClick={() => { if (window.confirm("Put this cook aside without saving it? It's kept on this phone in case you need it back, but it won't show in Kitchen.")) { drafts.discard(session.id); navigate("/"); } }}>
            Discard
          </button>
        </div>
        <p className="mx-auto mt-1 max-w-2xl text-xs text-bark/60">{store.mode === "family" ? "Saves to the family's recipes." : "Saves on this phone. Take a backup afterwards."} {photos.where === "family" ? "Photos and clips are in the family's storage." : ""}</p>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-clay bg-cream p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-bold text-bark">{title}</h2>
      {children}
    </section>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-12 text-center text-bark/70">{children}</div>;
}
