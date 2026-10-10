import { useState } from "react";
import { Link } from "react-router-dom";
import { RecipeCard } from "../components/RecipeCard";
import { ModeNotice } from "../components/ModeNotice";
import { primaryButton, secondaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { readDeviceData } from "../lib/recipeStorage";
import { useLoad } from "../lib/useLoad";

export function RecipeListPage() {
  const { store } = useKitchen();
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const { data: recipes, error } = useLoad(() => store.listRecipes(), [store]);
  const notImported = useLoad(async () => {
    if (store.mode !== "family") return 0;
    const device = readDeviceData(window.localStorage);
    if (!device) return 0;
    const keys = await store.existingKeys();
    return device.recipes.filter((r) => !keys.recipeIds.has(r.id)).length;
  }, [store]).data ?? 0;

  const shown = (recipes ?? []).filter((r) => !onlyFavourites || r.favourite);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-bark">ELK Kitchen</h1>
          <p className="mt-1 text-bark/70">Recipe memory — save before they slip away.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/data" className={secondaryButton}>Backup &amp; import</Link>
          <Link to="/add" className={primaryButton}>Add Recipe</Link>
        </div>
      </header>

      <ModeNotice />

      {notImported > 0 && (
        <p className="mb-6 rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-bark">
          {notImported} recipe{notImported === 1 ? " is" : "s are"} saved on this device but not in the family collection.{" "}
          <Link to="/data?from=device" className="font-semibold text-sage underline">Review and import</Link>
        </p>
      )}

      <div className="mb-4 flex gap-2 text-sm" role="group" aria-label="Filter">
        {[false, true].map((fav) => (
          <button
            key={String(fav)}
            type="button"
            aria-pressed={onlyFavourites === fav}
            onClick={() => setOnlyFavourites(fav)}
            className={`rounded-full px-3 py-1 ring-1 ${onlyFavourites === fav ? "bg-sage text-white ring-sage" : "bg-cream text-bark ring-clay"}`}
          >
            {fav ? "★ My favourites" : "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>
      ) : !recipes ? (
        <p className="text-bark/60">Loading recipes…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-clay bg-cream/50 p-8 text-center text-bark/70">
          {onlyFavourites ? "No favourites yet. Open a recipe and tap ☆ Favourite." : "No recipes yet. Add your first one."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
