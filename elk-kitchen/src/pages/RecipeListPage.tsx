import { useState } from "react";
import { Link } from "react-router-dom";
import { RecipeCard } from "../components/RecipeCard";
import { ModeNotice } from "../components/ModeNotice";
import { inputClass, secondaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { readDeviceData } from "../lib/recipeStorage";
import { useLoad } from "../lib/useLoad";
import type { RecipeSummary } from "../types/recipe";

// Matches every word typed, anywhere in the title, ingredients, tags, author or notes.
export function matchesSearch(r: RecipeSummary, q: string): boolean {
  const hay = [r.title, r.authorName, r.ingredients, r.tags.join(" "), r.notes].join("\n").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const ACTIONS: { to: string; icon: string; label: string; sub: string }[] = [
  { to: "/ideas", icon: "🍲", label: "What should we cook?", sub: "Ideas from your recipes" },
  { to: "/add/photo", icon: "📷", label: "Photograph a recipe", sub: "Card, book or note" },
  { to: "/add", icon: "✍️", label: "Type a recipe", sub: "Add it by hand" },
  { to: "/pantry", icon: "🥫", label: "What's in the pantry?", sub: "From ELK Inventory" },
];

export function RecipeListPage() {
  const { store, member } = useKitchen();
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [q, setQ] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const removed = useLoad(() => (showRemoved ? store.listRemoved() : Promise.resolve(null)), [store, showRemoved]);
  const { data: recipes, error } = useLoad(() => store.listRecipes(), [store]);
  const notImported = useLoad(async () => {
    if (store.mode !== "family") return 0;
    const device = readDeviceData(window.localStorage);
    if (!device) return 0;
    const keys = await store.existingKeys();
    return device.recipes.filter((r) => !keys.recipeIds.has(r.id)).length;
  }, [store]).data ?? 0;

  const shown = (recipes ?? []).filter((r) => (!onlyFavourites || r.favourite) && matchesSearch(r, q));
  // Photo reading and the pantry need the family account; /ideas works anywhere.
  const actions = ACTIONS.filter((a) => member || a.to === "/ideas" || a.to === "/add");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-bark">ELK Kitchen</h1>
          <p className="mt-1 text-bark/70">The family recipe book.</p>
        </div>
        <Link to="/data" className={`${secondaryButton} shrink-0`}>Backup &amp; import</Link>
      </header>

      <nav aria-label="Main actions" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.to} to={a.to}
            className={`flex flex-col gap-0.5 rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${a.to === "/add/photo" ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>
            <span className="text-2xl" aria-hidden>{a.icon}</span>
            <span className="font-semibold leading-tight">{a.label}</span>
            <span className={`text-xs ${a.to === "/add/photo" ? "text-white/80" : "text-bark/60"}`}>{a.sub}</span>
          </Link>
        ))}
      </nav>

      <ModeNotice />

      {notImported > 0 && (
        <p className="mb-6 rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-bark">
          {notImported} recipe{notImported === 1 ? " is" : "s are"} saved on this device but not in the family collection.{" "}
          <Link to="/data?from=device" className="font-semibold text-sage underline">Review and import</Link>
        </p>
      )}

      <h2 className="mb-3 text-xl font-bold text-bark">{store.mode === "family" ? "Family recipes" : "My recipes"}</h2>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes, ingredients, tags…"
        aria-label="Search recipes" className={`${inputClass} mb-3`} />
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
          {q.trim() ? `No recipes match "${q.trim()}".`
            : onlyFavourites ? "No favourites yet. Open a recipe and tap ☆ Favourite."
            : <>No recipes yet. <Link to={member ? "/add/photo" : "/add"} className="font-semibold text-sage underline">Add your first one</Link>.</>}
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

      <div className="mt-10 text-sm">
        <button type="button" onClick={() => setShowRemoved((v) => !v)} className="text-bark/60 underline" aria-expanded={showRemoved}>
          {showRemoved ? "Hide recently removed" : "Recently removed recipes"}
        </button>
        {showRemoved && (
          removed.error ? <p className="mt-2 text-red-700">{removed.error}</p>
          : !removed.data ? <p className="mt-2 text-bark/60">Loading…</p>
          : removed.data.length === 0 ? <p className="mt-2 text-bark/60">Nothing has been removed.</p>
          : (
            <ul className="mt-2 space-y-1">
              {removed.data.map((r) => (
                <li key={r.id}>
                  <Link to={`/recipe/${encodeURIComponent(r.id)}`} className="text-sage underline">{r.title}</Link>
                  <span className="text-bark/50"> · removed {r.removedAt?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
