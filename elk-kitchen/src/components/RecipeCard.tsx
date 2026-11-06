import { Link } from "react-router-dom";
import type { RecipeSummary } from "../types/recipe";
import type { RecipePantryCheck } from "../lib/pantryCheck";
import { PhotoImg } from "./Photos";
import { TagChips } from "./TagChips";

type Props = { recipe: RecipeSummary; pantry?: RecipePantryCheck | null };

export function RecipeCard({ recipe, pantry }: Props) {
  const cardTags = recipe.tags.slice(0, 4);

  return (
    <Link
      to={`/recipe/${encodeURIComponent(recipe.id)}`}
      className="block overflow-hidden rounded-2xl border border-clay/80 bg-cream shadow-sm transition hover:border-sage/40 hover:shadow-md"
    >
      {recipe.photos[0]
        ? <PhotoImg id={recipe.photos[0].id} className="h-44 w-full" />
        : <div aria-hidden className="flex h-24 items-center justify-center bg-gradient-to-br from-butter to-clay/60 text-4xl">{recipe.kind === "sausage" ? "🌭" : recipe.kind === "jerky" ? "🥩" : "🍲"}</div>}
      <div className="p-4">
      {(recipe.kind !== "general" || recipe.category) && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sage">{[recipe.kind !== "general" ? recipe.kind : "", recipe.category].filter((x, i, a) => x && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(" · ")}</p>
      )}
      <h2 className="text-lg font-semibold text-bark">
        {recipe.favourite && <span className="mr-1 text-amber-500" aria-label="Favourite">★</span>}
        {recipe.title}
      </h2>
      {recipe.authorName && <p className="mt-1 text-sm text-bark/70">by {recipe.authorName}</p>}
      <div className="mt-3 flex flex-wrap gap-3 text-sm text-bark/80">
        <span>
          {recipe.timesCooked === 0
            ? "Not cooked yet"
            : `Cooked ${recipe.timesCooked}×${recipe.lastCookedOn ? ` · last ${recipe.lastCookedOn}` : ""}`}
        </span>
        {recipe.approxCalories != null && <span>~{recipe.approxCalories} cal</span>}
      </div>
      {pantry && pantry.total > 0 && (
        <p className="mt-2 text-sm text-sage">🥫 Pantry has {pantry.have} of {pantry.total}{pantry.missing ? ` · ${pantry.missing} out` : ""}</p>
      )}
      {cardTags.length > 0 && (
        <div className="mt-3 pointer-events-none">
          <TagChips tags={cardTags} variant="primary" />
        </div>
      )}
      </div>
    </Link>
  );
}
