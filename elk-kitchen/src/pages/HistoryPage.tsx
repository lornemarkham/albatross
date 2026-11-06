import { Link } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { PhotoImg } from "../components/Photos";
import { byNewestCook, type RecipeStore } from "../lib/recipeStorage";
import { useDrafts } from "../lib/cooking/useCookingSession";
import { ContinueCooking } from "./StartCookingPage";
import type { CookingEntry, Recipe } from "../types/recipe";

export type HistoryItem = { recipe: Recipe; entry: CookingEntry };

// Every batch from every recipe, newest first.
export async function cookingHistory(store: RecipeStore, limit = Infinity): Promise<HistoryItem[]> {
  const cooked = (await store.listRecipes()).filter((r) => r.timesCooked > 0)
    .sort((a, b) => b.lastCookedOn.localeCompare(a.lastCookedOn));
  const out: HistoryItem[] = [];
  for (const r of cooked) {
    const d = await store.getRecipe(r.id);
    if (d) out.push(...d.entries.map((entry) => ({ recipe: d.recipe, entry })));
    if (out.length >= limit * 2 && limit !== Infinity) break;
  }
  return out.sort((a, b) => byNewestCook(a.entry, b.entry)).slice(0, limit);
}

export function HistoryCard({ item: { recipe, entry: e } }: { item: HistoryItem }) {
  const s = e.session;
  const cover = (s?.events ?? []).find((x) => x.kind === "media" && x.media.type === "photo" && x.media.finished);
  const photo = cover && cover.kind === "media" ? cover.media.id : e.photos[0]?.id ?? recipe.photos[0]?.id;
  const counts = s ? {
    notes: s.events.filter((x) => x.kind === "note").length,
    media: s.events.filter((x) => x.kind === "media").length,
  } : null;
  return (
    <Link to={`/recipe/${encodeURIComponent(recipe.id)}/batch/${encodeURIComponent(e.id)}`} className="flex gap-3 rounded-2xl border border-clay bg-cream p-3 shadow-sm transition hover:shadow-md">
      {photo ? <PhotoImg id={photo} className="h-20 w-20 shrink-0 rounded-xl" /> : <div aria-hidden className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-butter text-3xl">{recipe.kind === "sausage" ? "🌭" : recipe.kind === "jerky" ? "🥩" : "🍳"}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-bark">{recipe.title}</p>
        <p className="text-sm text-bark/70">{e.cookedOn || "Date unknown"}{e.cookName ? ` · ${e.cookName}` : ""}{e.rating != null ? ` · ★ ${e.rating}` : ""}</p>
        <p className="mt-1 truncate text-xs text-bark/60">
          {counts ? `🎤 Cooking session · ${counts.notes} notes · ${counts.media} photos & clips` : "Recorded by hand"}
          {e.improveNextTime.trim() ? ` · Next time: ${e.improveNextTime.split("\n")[0]}` : ""}
        </p>
      </div>
    </Link>
  );
}

export function HistoryPage() {
  const { store } = useKitchen();
  const drafts = useDrafts();
  const { data, error } = useLoad(() => cookingHistory(store), [store]);
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">Cooking history</h1>
      <p className="mt-1 text-bark/70">Every cook and batch, newest first.</p>
      <div className="mt-4"><ContinueCooking sessions={drafts.unsaved()} /></div>
      {error ? <p className="mt-4 text-red-700">{error}</p> : !data ? <p className="mt-4 text-bark/60">Loading…</p> : data.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-clay p-6 text-center text-bark/70">Nothing cooked yet. <Link to="/cook" className="font-semibold text-sage underline">Start cooking</Link></p>
      ) : (
        <ul className="mt-4 space-y-3">{data.map((i) => <li key={i.entry.id}><HistoryCard item={i} /></li>)}</ul>
      )}
    </div>
  );
}
