// What the kitchen screen last saw, kept so it stays useful when the internet
// drops: the family's recipes (to read and cook from), ELK Pantry's food and
// the open shopping list, all READ-ONLY and always shown with the time they
// were read. Nothing is queued or changed while offline; Inventory stays the
// source of truth and the snapshot is replaced on the next good load.
// (Doctrine §14 records this as a deliberate exception to "Kitchen never
// caches stock", made by the M783 brief: offline read-only pantry.)

import type { PantryItem } from "../pantry";
import type { RecipeSummary } from "../../types/recipe";

export const SNAPSHOT_KEY = "elk-kitchen-home-snapshot-v1";
// Keep well inside a browser's ~5 MB localStorage, beside recipes and drafts.
export const SNAPSHOT_MAX_CHARS = 1_500_000;

export type SnapshotRecipe = Pick<RecipeSummary, "id" | "title" | "ingredients" | "instructions" | "tags" | "lastCookedOn" | "timesCooked" | "favourite">;

export type KitchenSnapshot = {
  at: string;
  recipes: SnapshotRecipe[];
  pantry: PantryItem[] | null;
  shopping: string[] | null;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const slim = (r: RecipeSummary): SnapshotRecipe => ({
  id: r.id, title: r.title, ingredients: r.ingredients, instructions: r.instructions, tags: r.tags,
  lastCookedOn: r.lastCookedOn, timesCooked: r.timesCooked, favourite: r.favourite,
});

// Returns false (and keeps the older snapshot) when it wouldn't fit.
export function saveSnapshot(storage: Storage, s: { at: string; recipes: RecipeSummary[]; pantry: PantryItem[] | null; shopping: string[] | null }): boolean {
  const snap: KitchenSnapshot = { at: s.at, recipes: s.recipes.filter((r) => !r.removedAt).map(slim), pantry: s.pantry, shopping: s.shopping };
  const text = JSON.stringify(snap);
  if (text.length > SNAPSHOT_MAX_CHARS) return false;
  try { storage.setItem(SNAPSHOT_KEY, text); return true; } catch { return false; }
}

export function readSnapshot(storage: Storage): KitchenSnapshot | null {
  try {
    const v = JSON.parse(storage.getItem(SNAPSHOT_KEY) ?? "null");
    if (!v || typeof v.at !== "string" || !Array.isArray(v.recipes)) return null;
    return { at: v.at, recipes: v.recipes, pantry: Array.isArray(v.pantry) ? v.pantry : null, shopping: Array.isArray(v.shopping) ? v.shopping : null };
  } catch {
    return null;
  }
}
