import { Link } from "react-router-dom";
import type { RecipeSummary } from "../types/recipe";
import { TagChips } from "./TagChips";

type Props = { recipe: RecipeSummary };

export function RecipeCard({ recipe }: Props) {
  const cardTags = recipe.tags.slice(0, 4);

  return (
    <Link
      to={`/recipe/${encodeURIComponent(recipe.id)}`}
      className="block rounded-2xl border border-clay/80 bg-cream p-5 shadow-sm transition hover:border-sage/40 hover:shadow-md"
    >
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
      {cardTags.length > 0 && (
        <div className="mt-3 pointer-events-none">
          <TagChips tags={cardTags} variant="primary" />
        </div>
      )}
    </Link>
  );
}
