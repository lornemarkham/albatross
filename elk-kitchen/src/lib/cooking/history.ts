import { byNewestCook, type RecipeStore } from "../recipeStorage";
import type { CookingEntry, Recipe } from "../../types/recipe";

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
