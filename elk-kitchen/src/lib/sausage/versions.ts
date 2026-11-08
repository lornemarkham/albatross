// Recipe versions (M635). A recipe on the card is never silently overwritten by
// what a tasting taught. When the cook decides a change is material, Kitchen
// makes a NEW recipe ("Bratwurst v2") from a copy of the current one, and
// records the lineage here. The original keeps its text, ratings and photos.
//
// Lineage is kept on this device (the recipe tables have no column for it).
// Earlier edits made through the normal Edit page are not versioned by Kitchen
// today: only "make a new version" is.

import type { Recipe, RecipeInput } from "../../types/recipe";
import type { RecipeStore } from "../recipeStorage";

export const VERSIONS_KEY = "elk-kitchen-recipe-versions-v1";
type KV = Pick<Storage, "getItem" | "setItem">;

export type VersionLink = {
  recipeId: string; // the new version
  parentId: string; // the version it was made from
  label: string; // "v2"
  reason: string; // what changed and why, in the cook's words
  createdAt: string;
  by: string;
};

export class VersionStore {
  private storage: KV;
  constructor(storage: KV) { this.storage = storage; }
  list(): VersionLink[] {
    try {
      const v = JSON.parse(this.storage.getItem(VERSIONS_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is VersionLink => !!x && typeof x.recipeId === "string" && typeof x.parentId === "string") : [];
    } catch {
      return [];
    }
  }
  add(link: VersionLink) { this.storage.setItem(VERSIONS_KEY, JSON.stringify([...this.list().filter((l) => l.recipeId !== link.recipeId), link])); }
  parentOf(recipeId: string): VersionLink | null { return this.list().find((l) => l.recipeId === recipeId) ?? null; }
  childrenOf(recipeId: string): VersionLink[] { return this.list().filter((l) => l.parentId === recipeId); }
  // Oldest first: the original, then each version made from the one before.
  chain(recipeId: string): string[] {
    const up: string[] = [recipeId];
    for (let p = this.parentOf(recipeId); p && !up.includes(p.parentId); p = this.parentOf(p.parentId)) up.unshift(p.parentId);
    const out = [...up];
    for (let kids = this.childrenOf(out[out.length - 1]); kids.length && !out.includes(kids[0].recipeId); kids = this.childrenOf(out[out.length - 1])) out.push(kids[0].recipeId);
    return out;
  }
}

const baseTitle = (t: string) => t.replace(/\s+v\d+$/i, "");

// Makes the next version from a recipe: a copy with the cook's edits, a note saying where it came from,
// and a lineage link. The source recipe is not changed.
export async function makeNewVersion(
  store: RecipeStore, versions: VersionStore, source: Recipe, edits: Partial<Pick<RecipeInput, "ingredients" | "instructions" | "notes" | "details">>,
  reason: string, by: string, now: string,
): Promise<Recipe> {
  const n = versions.chain(source.id).length + 1;
  const label = `v${n}`;
  const input: RecipeInput = {
    title: `${baseTitle(source.title)} ${label}`, authorName: source.authorName, ingredients: edits.ingredients ?? source.ingredients,
    instructions: edits.instructions ?? source.instructions, tags: source.tags, suggestedTags: source.suggestedTags, approxCalories: source.approxCalories,
    kind: source.kind, category: source.category, photos: [], details: edits.details ?? source.details,
    notes: [`Version ${n} of ${baseTitle(source.title)}, made from "${source.title}" on ${now.slice(0, 10)}: ${reason}`, edits.notes ?? source.notes].filter(Boolean).join("\n\n"),
  };
  const created = await store.createRecipe(input);
  versions.add({ recipeId: created.id, parentId: source.id, label, reason, createdAt: now, by });
  return created;
}
