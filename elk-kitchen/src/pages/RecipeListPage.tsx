import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RecipeCard } from "../components/RecipeCard";
import { ModeNotice } from "../components/ModeNotice";
import { inputClass } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { readDeviceData } from "../lib/recipeStorage";
import { useLoad } from "../lib/useLoad";
import type { RecipeSummary } from "../types/recipe";
import { useDrafts } from "../lib/cooking/useCookingSession";
import { usePantry } from "../lib/usePantry";
import { checkRecipe } from "../lib/pantryCheck";
import { ContinueCooking } from "./StartCookingPage";
import { HistoryCard, cookingHistory } from "./HistoryPage";
import { AskBox } from "./CompanionPage";
import { ensureHouseholdRecipes } from "../lib/household/staples";
import { SausageDayHome } from "../components/SausageDayHome";

// Matches every word typed, anywhere in the title, ingredients, tags, author or notes.
export function matchesSearch(r: RecipeSummary, q: string): boolean {
  const hay = [r.title, r.authorName, r.ingredients, r.tags.join(" "), r.notes, r.category, r.kind === "general" ? "" : r.kind].join("\n").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const ACTIONS: { to: string; icon: string; label: string; sub: string }[] = [
  { to: "/ideas", icon: "🍲", label: "What should we cook?", sub: "Ideas from your recipes" },
  { to: "/history", icon: "📖", label: "Cooking history", sub: "Every cook and batch" },
  { to: "/add?kind=jerky", icon: "🥩", label: "New jerky recipe", sub: "Weights, cure, temps" },
  { to: "/add?kind=sausage", icon: "🌭", label: "New sausage recipe", sub: "Grind, casing, smoke" },
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
  // Staples, dressings and the sausage cards are in the book once; the list loads after.
  const { data: recipes, error } = useLoad(async () => { await ensureHouseholdRecipes(store).catch(() => 0); return store.listRecipes(); }, [store]);
  const notImported = useLoad(async () => {
    if (store.mode !== "family") return 0;
    const device = readDeviceData(window.localStorage);
    if (!device) return 0;
    const keys = await store.existingKeys();
    return device.recipes.filter((r) => !keys.recipeIds.has(r.id)).length;
  }, [store]).data ?? 0;

  const drafts = useDrafts();
  const unsaved = drafts.unsaved();
  const recent = useLoad(() => cookingHistory(store, 3), [store]);
  const { pantry } = usePantry();
  const pantryItems = pantry && pantry !== "off" && pantry.status === "ready" ? pantry.items : null;
  const shown = (recipes ?? []).filter((r) => (!onlyFavourites || r.favourite) && matchesSearch(r, q));
  // Photo reading and the pantry need the family account; /ideas works anywhere.
  const actions = ACTIONS.filter((a) => member || a.to === "/ideas" || a.to === "/history" || a.to.startsWith("/add"));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-bark">ELK Kitchen</h1>
          <p className="text-sm text-bark/70">Cook it, talk it through, remember it.</p>
        </div>
        <Link to="/data" className="shrink-0 text-sm text-sage underline">Backup &amp; import</Link>
      </header>

      <Link to="/food" className="mb-5 flex min-h-16 items-center justify-center gap-3 rounded-3xl bg-sage text-xl font-bold text-white shadow-md transition hover:bg-sage/90">
        <span aria-hidden className="text-2xl">📷</span> Add food
        <span className="text-sm font-medium text-white/80">photo · say it · done</span>
      </Link>

      <SausageDayHome />

      <TonightAsk />

      <section className="mb-5 overflow-hidden rounded-3xl bg-cocoa p-5 text-butter shadow-md sm:p-7">
        <p className="text-xs font-bold uppercase tracking-widest text-saffron">Hands-free cooking</p>
        <h2 className="mt-1 font-display text-2xl font-semibold leading-tight sm:text-3xl">What are we cooking?</h2>
        <p className="mt-1 text-sm text-butter/75">Say what goes in, fix it by voice, set timers, snap photos. Kitchen keeps the notes and asks before it guesses.</p>
        <Link to="/cook" className="mt-4 flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-tomato text-xl font-bold text-white shadow-lg transition hover:bg-tomato/90">
          <span aria-hidden className="text-2xl">🎤</span> Start cooking
        </Link>
        <Link to="/plan" className="mt-3 flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-butter/30 text-lg font-semibold text-butter transition hover:bg-butter/10">
          <span aria-hidden>🌭</span> Sausage day: cook with what I bought
        </Link>
      </section>

      {unsaved.length > 0 && <div className="mb-5"><ContinueCooking sessions={unsaved} /></div>}

      {(recent.data?.length ?? 0) > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-xl font-bold text-bark">Recently cooked</h2>
            <Link to="/history" className="text-sm text-sage underline">All history</Link>
          </div>
          <ul className="space-y-2">{recent.data!.map((i) => <li key={i.entry.id}><HistoryCard item={i} /></li>)}</ul>
        </section>
      )}

      <nav aria-label="More" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
        {actions.map((a) => (
          <Link key={a.to} to={a.to} className="flex shrink-0 items-center gap-2 rounded-full border border-clay bg-cream px-4 py-2.5 text-sm font-medium text-bark shadow-sm">
            <span aria-hidden>{a.icon}</span>{a.label}
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
              <RecipeCard recipe={recipe} pantry={pantryItems ? checkRecipe(recipe.ingredients, pantryItems) : null} />
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

// The companion's front door: ask, and land on /tonight with the answer.
function TonightAsk() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  return (
    <section className="mb-5 rounded-3xl border border-clay bg-cream p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-2xl font-semibold text-bark">What should we cook?</h2>
      <p className="mb-3 mt-1 text-sm text-bark/70">From the family's recipes, what Pantry shows and how everyone rated dinners. <Link to="/tonight" className="text-sage underline">What we have</Link></p>
      <AskBox compact text={text} setText={setText} onAsk={(q) => q.trim() && navigate(`/tonight?q=${encodeURIComponent(q.trim())}`)} />
    </section>
  );
}
