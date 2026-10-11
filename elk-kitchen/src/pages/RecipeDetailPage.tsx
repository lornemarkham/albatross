import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PantryCheck } from "../components/PantryCheck";
import { TagChips } from "../components/TagChips";
import { primaryButton, secondaryButton, sectionLabel } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import type { CookingEntry } from "../types/recipe";

export function RecipeDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { store } = useKitchen();
  const navigate = useNavigate();
  const { data: detail, error, reload } = useLoad(() => store.getRecipe(id), [store, id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Message text={error} />;
  if (detail === undefined) return <Message text="Loading…" />;
  if (detail === null) return <Message text="Recipe not found." />;

  const { recipe, entries, favourite, favouriteOf } = detail;
  const lastAdvice = entries.find((e) => e.improveNextTime.trim());
  const removed = !!recipe.removedAt;

  // "Delete" hides the recipe from everyone's book but keeps it (and its
  // history), so it can be restored from "Recently removed".
  function setRemoved(on: boolean) {
    if (on && !window.confirm(`Delete "${recipe.title}" from the family recipe book?\n\nIt disappears for everyone. Its history is kept, and it can be restored from "Recently removed".`)) return;
    act(async () => {
      const r = await store.setRemoved(recipe.id, recipe.version, on);
      if (!r.ok) throw new Error("Someone else changed this recipe just now. Nothing was changed — have a look and try again.");
      if (on) navigate("/", { replace: true });
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← All recipes</Link>

      {removed && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>This recipe was deleted{recipe.removedAt ? ` on ${recipe.removedAt.slice(0, 10)}` : ""} and is hidden from the recipe book.</span>
          <button type="button" disabled={busy} onClick={() => setRemoved(false)} className={secondaryButton}>Restore it</button>
        </div>
      )}

      <article className="mt-6 rounded-2xl border border-clay bg-cream p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-bark">{recipe.title}</h1>
            {recipe.authorName && <p className="mt-1 text-bark/70">by {recipe.authorName}</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              aria-pressed={favourite}
              onClick={() => act(() => store.setFavourite(recipe.id, !favourite))}
              className={secondaryButton}
            >
              {favourite ? "★ Favourite" : "☆ Favourite"}
            </button>
            <Link to={`/recipe/${encodeURIComponent(recipe.id)}/edit`} className={secondaryButton}>Edit</Link>
          </div>
        </div>
        {favouriteOf.length > 0 && (
          <p className="mt-2 text-sm text-bark/70">★ Favourite of {favouriteOf.join(", ")}</p>
        )}
        {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}

        {lastAdvice && (
          <div className="mt-5 rounded-xl border border-sage/30 bg-sage/10 p-4">
            <p className={sectionLabel}>Next time{lastAdvice.cookedOn ? ` (from ${lastAdvice.cookedOn})` : ""}</p>
            <p className="mt-1 whitespace-pre-wrap text-bark">{lastAdvice.improveNextTime}</p>
          </div>
        )}

        {recipe.tags.length > 0 && (
          <div className="mt-5">
            <p className={sectionLabel}>Tags</p>
            <div className="mt-2"><TagChips tags={recipe.tags} variant="primary" /></div>
          </div>
        )}
        {recipe.suggestedTags.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-bark/50">Suggested tags</p>
            <div className="mt-2"><TagChips tags={recipe.suggestedTags} variant="secondary" /></div>
          </div>
        )}

        <dl className="mt-6 space-y-6">
          <Field label="Ingredients" text={recipe.ingredients} />
          {!removed && <PantryCheck ingredients={recipe.ingredients} />}
          <Field label="Method" text={recipe.instructions} />
          <Field label="Notes" text={recipe.notes} />
          {recipe.approxCalories != null && <Field label="Approx calories" text={String(recipe.approxCalories)} />}
        </dl>
        {!removed && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-clay/60 pt-4">
            {recipe.instructions.trim() && (
              <Link to={`/ideas/cook/saved/${encodeURIComponent(recipe.id)}`} className={primaryButton}>👩‍🍳 Cook along step by step</Link>
            )}
            <button type="button" disabled={busy} onClick={() => setRemoved(true)} className="ml-auto text-sm text-bark/50 underline hover:text-red-700">
              Delete recipe
            </button>
          </div>
        )}
      </article>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-bark">Cooking history</h2>
          <Link to={`/recipe/${encodeURIComponent(recipe.id)}/cook`} className={primaryButton}>Record a cook</Link>
        </div>
        {entries.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-clay bg-cream/50 p-6 text-center text-bark/70">
            Nobody has recorded cooking this yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {entries.map((e) => (
              <li key={e.id}>
                <EntryCard
                  entry={e}
                  busy={busy}
                  onRemove={() => {
                    if (window.confirm(`Remove the cooking entry from ${e.cookedOn || "an unknown date"}? This can't be undone.`)) {
                      act(() => store.removeCookingEntry(e.id));
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EntryCard({ entry: e, busy, onRemove }: { entry: CookingEntry; busy: boolean; onRemove: () => void }) {
  return (
    <article className="rounded-2xl border border-clay bg-cream p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-bark">
          {e.cookedOn || "Date unknown"}
          {e.cookName && <span className="font-normal text-bark/70"> · {e.cookName}</span>}
        </p>
        {e.rating != null && <p className="text-sm text-bark/80">★ {e.rating}/10</p>}
      </div>
      <dl className="mt-3 space-y-3 text-sm">
        <Field label="Actually used" text={e.ingredientsUsed} small />
        <Field label="Substitutions & changes" text={e.substitutions} small />
        <Field label="Family reaction" text={e.familyReaction} small />
        <Field label="Next time" text={e.improveNextTime} small />
        <Field label="Notes" text={e.notes} small />
      </dl>
      {e.mine && (
        <button type="button" disabled={busy} onClick={onRemove} className="mt-3 text-xs text-bark/50 underline hover:text-red-700">
          Remove this entry
        </button>
      )}
    </article>
  );
}

function Field({ label, text, small }: { label: string; text: string; small?: boolean }) {
  if (!text.trim()) return null;
  return (
    <div>
      <dt className={small ? "text-xs font-semibold text-sage" : sectionLabel}>{label}</dt>
      <dd className={`${small ? "mt-0.5" : "mt-2"} whitespace-pre-wrap text-bark`}>{text}</dd>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <p className="text-bark/70">{text}</p>
      <Link to="/" className="mt-4 inline-block text-sage underline">Back to recipes</Link>
    </div>
  );
}
