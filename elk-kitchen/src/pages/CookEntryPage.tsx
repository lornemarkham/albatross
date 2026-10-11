import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { inputClass, labelClass, primaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { parseOptionalNumber, todayIso } from "../lib/recipeModel";
import type { Recipe } from "../types/recipe";

// Records one occasion of cooking a recipe. Never changes the recipe itself.
export function CookEntryPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { store, myName } = useKitchen();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [form, setForm] = useState({
    cookedOn: todayIso(),
    cookName: myName,
    ingredientsUsed: "",
    substitutions: "",
    familyReaction: "",
    rating: "",
    improveNextTime: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store.getRecipe(id).then((d) => {
      if (cancelled) return;
      setRecipe(d?.recipe ?? null);
      // Start from the plan; edit it into what was actually used.
      if (d) setForm((f) => ({ ...f, ingredientsUsed: f.ingredientsUsed || d.recipe.ingredients }));
    }, (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [id, store]);

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await store.addCookingEntry(id, {
        cookedOn: form.cookedOn,
        cookName: form.cookName.trim(),
        ingredientsUsed: form.ingredientsUsed.trim(),
        substitutions: form.substitutions.trim(),
        familyReaction: form.familyReaction.trim(),
        improveNextTime: form.improveNextTime.trim(),
        notes: form.notes.trim(),
        rating: parseOptionalNumber(form.rating, 0, 10, "Rating"),
      });
      navigate(`/recipe/${encodeURIComponent(id)}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (recipe === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-bark/70">Recipe not found.</p>
        <Link to="/" className="mt-4 inline-block text-sage underline">Back to recipes</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to={`/recipe/${encodeURIComponent(id)}`} className="text-sm font-medium text-sage hover:underline">← Back to recipe</Link>
      <h1 className="mt-4 text-2xl font-bold text-bark">Record a cook</h1>
      <p className="mt-1 text-bark/70">{recipe ? recipe.title : "Loading…"}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="cookedOn" className={labelClass}>Cooked on</label>
            <input id="cookedOn" name="cookedOn" type="date" required className={inputClass} value={form.cookedOn} onChange={handleChange} />
          </div>
          <div>
            <label htmlFor="cookName" className={labelClass}>Cooked by</label>
            <input id="cookName" name="cookName" maxLength={60} className={inputClass} value={form.cookName} onChange={handleChange} />
          </div>
        </div>
        <div>
          <label htmlFor="ingredientsUsed" className={labelClass}>What you actually used</label>
          <textarea id="ingredientsUsed" name="ingredientsUsed" rows={7} className={inputClass} value={form.ingredientsUsed} onChange={handleChange} />
        </div>
        <div>
          <label htmlFor="substitutions" className={labelClass}>Substitutions &amp; changes</label>
          <textarea id="substitutions" name="substitutions" rows={3} className={inputClass} placeholder="e.g. Gouda rind instead of parmesan" value={form.substitutions} onChange={handleChange} />
        </div>
        <div>
          <label htmlFor="familyReaction" className={labelClass}>Family reaction</label>
          <textarea id="familyReaction" name="familyReaction" rows={3} className={inputClass} placeholder="Who loved it, who didn't" value={form.familyReaction} onChange={handleChange} />
        </div>
        <div className="sm:w-1/2">
          <label htmlFor="rating" className={labelClass}>Rating (0–10)</label>
          <input id="rating" name="rating" type="number" inputMode="decimal" min={0} max={10} step={0.5} className={inputClass} value={form.rating} onChange={handleChange} />
        </div>
        <div>
          <label htmlFor="improveNextTime" className={labelClass}>What to change next time</label>
          <textarea id="improveNextTime" name="improveNextTime" rows={3} className={inputClass} value={form.improveNextTime} onChange={handleChange} />
        </div>
        <div>
          <label htmlFor="notes" className={labelClass}>Other notes</label>
          <textarea id="notes" name="notes" rows={3} className={inputClass} value={form.notes} onChange={handleChange} />
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving || !recipe} className={`${primaryButton} w-full sm:w-auto sm:px-8`}>
          {saving ? "Saving…" : "Save this cook"}
        </button>
      </form>
    </div>
  );
}
