import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { inputClass, labelClass, primaryButton, secondaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { parseOptionalNumber, parseTags } from "../lib/recipeModel";
import { generateSuggestedTags } from "../lib/suggestedTags";
import { clearDraft, readDraft, type PhotoDraft } from "../lib/capture/recipeCapture";
import type { Recipe, RecipeInput } from "../types/recipe";

type Form = {
  title: string;
  authorName: string;
  ingredients: string;
  instructions: string;
  notes: string;
  tagsRaw: string;
  approxCalories: string;
};

const formOf = (r: Recipe): Form => ({
  title: r.title,
  authorName: r.authorName,
  ingredients: r.ingredients,
  instructions: r.instructions,
  notes: r.notes,
  tagsRaw: r.tags.join(", "),
  approxCalories: r.approxCalories == null ? "" : String(r.approxCalories),
});

const FIELD_LABELS: Record<keyof Form, string> = {
  title: "Title", authorName: "Recipe by", ingredients: "Ingredients", instructions: "Method",
  notes: "Notes", tagsRaw: "Tags", approxCalories: "Approx calories",
};

function toInput(form: Form): RecipeInput {
  const title = form.title.trim();
  if (!title) throw new Error("A recipe needs a title.");
  const draft = { title, ingredients: form.ingredients.trim(), notes: form.notes.trim() };
  const calories = parseOptionalNumber(form.approxCalories, 0, 20000, "Calories");
  return {
    ...draft,
    authorName: form.authorName.trim(),
    instructions: form.instructions.trim(),
    tags: parseTags(form.tagsRaw),
    suggestedTags: generateSuggestedTags(draft),
    approxCalories: calories == null ? null : Math.round(calories),
  };
}

// Add (no :id) or edit (/recipe/:id/edit).
export function RecipeFormPage() {
  const { id } = useParams<{ id: string }>();
  const editing = id !== undefined;
  const { store, myName } = useKitchen();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const blank: Form = { title: "", authorName: myName, ingredients: "", instructions: "", notes: "", tagsRaw: "", approxCalories: "" };
  // A recipe read from photos, waiting for a person to check it (never saved until they do).
  const [photo] = useState<PhotoDraft | null>(() =>
    editing || params.get("from") !== "photo" ? null : ((location.state as PhotoDraft | null) ?? readDraft(window.sessionStorage)));
  const [form, setForm] = useState<Form>(() => {
    if (!photo) return blank;
    const d = photo.draft;
    return { ...blank, title: d.title, authorName: d.authorName, ingredients: d.ingredients, instructions: d.instructions, notes: d.notes };
  });
  const [initial, setInitial] = useState<Form>(blank);
  // The version this edit started from; the save only lands if it's still current.
  const [baseVersion, setBaseVersion] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">(editing ? "loading" : "ready");
  const [conflict, setConflict] = useState<Recipe | "deleted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    store.getRecipe(id).then((d) => {
      if (cancelled) return;
      if (!d) { setLoadState("missing"); return; }
      setForm(formOf(d.recipe));
      setInitial(formOf(d.recipe));
      setBaseVersion(d.recipe.version);
      setLoadState("ready");
    }, (e: unknown) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); });
    return () => { cancelled = true; };
  }, [editing, id, store]);

  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function save(version: number, values: Form = form) {
    setError(null);
    let input: RecipeInput;
    try {
      input = toInput(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaving(true);
    try {
      if (!editing) {
        const recipe = await store.createRecipe(input);
        clearDraft(window.sessionStorage);
        setInitial(values);
        navigate(`/recipe/${encodeURIComponent(recipe.id)}`, { replace: true });
        return;
      }
      const result = await store.updateRecipe(id, version, input);
      if (result.ok) {
        setInitial(values);
        navigate(`/recipe/${encodeURIComponent(id)}`, { replace: true });
      } else {
        // Nothing was written. Keep everything typed so far on screen.
        setConflict(result.current ?? "deleted");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save(baseVersion);
  }

  function cancel() {
    if (dirty && !window.confirm(photo ? "Discard this recipe? What was read from the photos will be lost." : "Discard your unsaved changes?")) return;
    clearDraft(window.sessionStorage);
    setInitial(form); // so the unload warning doesn't fire on the way out
    navigate(editing ? `/recipe/${encodeURIComponent(id)}` : "/");
  }

  if (loadState === "missing") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-bark/70">Recipe not found.</p>
        <Link to="/" className="mt-4 inline-block text-sage underline">Back to recipes</Link>
      </div>
    );
  }

  const theirs = conflict && conflict !== "deleted" ? formOf(conflict) : null;
  const changedByThem = theirs ? (Object.keys(theirs) as (keyof Form)[]).filter((k) => theirs[k] !== initial[k]) : [];
  // Fields both of you changed differently — the only places "mine" replaces "theirs".
  const clashes = theirs ? changedByThem.filter((k) => form[k] !== initial[k] && form[k] !== theirs[k]) : [];

  // Keep their changes in every field you didn't touch; yours win only where you edited.
  function saveMerged(current: Recipe) {
    const theirForm = formOf(current);
    const merged = { ...theirForm };
    for (const k of Object.keys(form) as (keyof Form)[]) if (form[k] !== initial[k]) merged[k] = form[k];
    setConflict(null);
    setForm(merged);
    setInitial(theirForm);
    setBaseVersion(current.version);
    save(current.version, merged);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button type="button" onClick={cancel} className="text-sm font-medium text-sage hover:underline">← Cancel</button>

      <h1 className="mt-4 text-2xl font-bold text-bark">{editing ? "Edit recipe" : photo ? "Check the recipe" : "Add recipe"}</h1>
      {photo ? (
        <PhotoReview photo={photo} tagsRaw={form.tagsRaw} addTag={(t) => setForm((f) => ({ ...f, tagsRaw: parseTags(f.tagsRaw).concat(t).join(", ") }))} />
      ) : (
        <p className="mt-1 text-sm text-bark/70">
          The recipe itself — what you plan to make. Record each time you cook it separately, from the recipe page.
          {!editing && <> Have it on paper? <Link to="/add/photo" className="font-semibold text-sage underline">Photograph it instead</Link>.</>}
        </p>
      )}

      {loadState === "loading" ? (
        <p className="mt-8 text-bark/60">{error ?? "Loading…"}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="title" className={labelClass}>Title *</label>
            <input id="title" name="title" required maxLength={200} className={inputClass} value={form.title} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="authorName" className={labelClass}>Recipe by</label>
            <input id="authorName" name="authorName" maxLength={60} className={inputClass} value={form.authorName} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="ingredients" className={labelClass}>Ingredients (what the recipe calls for)</label>
            <textarea id="ingredients" name="ingredients" rows={8} className={inputClass} value={form.ingredients} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="instructions" className={labelClass}>Method</label>
            <textarea id="instructions" name="instructions" rows={6} className={inputClass} value={form.instructions} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="notes" className={labelClass}>Notes</label>
            <textarea id="notes" name="notes" rows={3} className={inputClass} value={form.notes} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="tagsRaw" className={labelClass}>Tags (comma separated)</label>
            <input id="tagsRaw" name="tagsRaw" className={inputClass} placeholder="soup, cheese, weeknight" value={form.tagsRaw} onChange={handleChange} />
          </div>
          <div className="sm:w-1/2">
            <label htmlFor="approxCalories" className={labelClass}>Approx calories</label>
            <input id="approxCalories" name="approxCalories" type="number" inputMode="numeric" min={0} max={20000} className={inputClass} value={form.approxCalories} onChange={handleChange} />
          </div>

          {conflict && (
            <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              {conflict === "deleted" ? (
                <p>This recipe isn't there any more, so your changes weren't saved. Copy anything you need from the form above.</p>
              ) : (
                <>
                  <p className="font-semibold">Someone else saved this recipe while you were editing. Your changes are not saved yet.</p>
                  {changedByThem.length > 0 && <p className="mt-1">They changed: {changedByThem.map((k) => FIELD_LABELS[k]).join(", ")}.</p>}
                  <p className="mt-1">
                    {clashes.length > 0
                      ? `Saving keeps their other changes, but your ${clashes.map((k) => FIELD_LABELS[k]).join(", ")} will replace theirs.`
                      : "Saving keeps their changes and adds yours — nothing of theirs is replaced."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={saving} className={primaryButton} onClick={() => saveMerged(conflict)}>
                      {clashes.length > 0 ? "Save mine anyway" : "Save both"}
                    </button>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => {
                        if (!window.confirm("Throw away what you typed and load their version?")) return;
                        setForm(formOf(conflict)); setInitial(formOf(conflict)); setBaseVersion(conflict.version); setConflict(null);
                      }}
                    >
                      Load theirs instead
                    </button>
                  </div>
                  {store.mode === "family" && <p className="mt-2 text-amber-900/80">Either way, every earlier version stays in the recipe's history.</p>}
                </>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="pt-2">
            <button type="submit" disabled={saving || conflict !== null} className={`${primaryButton} w-full sm:w-auto sm:px-8`}>
              {saving ? "Saving…" : editing ? "Save changes" : "Save recipe"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// What the AI read, and what it couldn't — shown above the filled-in form.
function PhotoReview({ photo, tagsRaw, addTag }: { photo: PhotoDraft; tagsRaw: string; addTag: (t: string) => void }) {
  const chosen = parseTags(tagsRaw);
  const offered = photo.draft.suggestedTags.filter((t) => !chosen.includes(t));
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">
          Read by AI from {photo.pages === 1 ? "your photo" : `${photo.pages} photos`}. Not saved yet.
        </p>
        <p className="mt-1">Check each line against the card and fix anything that's wrong, then press <strong>Save recipe</strong>.</p>
        {photo.unclear.length > 0 ? (
          <>
            <p className="mt-3 font-semibold">⚠ It couldn't read {photo.unclear.length === 1 ? "this" : `these ${photo.unclear.length}`} clearly:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {photo.unclear.map((u, i) => <li key={i}>{u}</li>)}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-amber-900/80">It didn't flag anything as hard to read — still worth a quick check.</p>
        )}
      </div>
      {offered.length > 0 && (
        <p className="text-sm text-bark/70">
          Suggested tags:{" "}
          {offered.map((t) => (
            <button key={t} type="button" onClick={() => addTag(t)} className="mr-1.5 mt-1 rounded-full bg-cream px-2.5 py-0.5 ring-1 ring-clay hover:bg-clay/30">+ {t}</button>
          ))}
        </p>
      )}
    </div>
  );
}
