import type {
  CookingEntry, CookingEntryInput, LegacyRecipe, Recipe, RecipeDetail, RecipeInput, RecipeSummary,
} from "../types/recipe";
import {
  EXPORT_APP, EXPORT_FORMAT, legacyToRecipe, newId, normTitle,
  type ExistingKeys, type ExportBundle, type ImportItem, type ImportResult,
} from "./recipeModel";

// ── The storage abstraction ──────────────────────────────────────────────────
// "family": shared in Supabase, family members only (sharedRecipeStore.ts).
// "this-device": this browser's localStorage only (below).

export type UpdateResult =
  | { ok: true; recipe: Recipe }
  // Someone else saved first. Nothing was written; `current` is what's there now.
  | { ok: false; current: Recipe | null };

export interface RecipeStore {
  readonly mode: "family" | "this-device";
  listRecipes(): Promise<RecipeSummary[]>;
  getRecipe(id: string): Promise<RecipeDetail | null>;
  createRecipe(input: RecipeInput): Promise<Recipe>;
  // Saves only if the recipe is still at `baseVersion`.
  updateRecipe(id: string, baseVersion: number, input: RecipeInput): Promise<UpdateResult>;
  // "Delete" (removed = true) hides the recipe but keeps it and its history;
  // it can be restored. Version-checked like an edit.
  setRemoved(id: string, baseVersion: number, removed: boolean): Promise<UpdateResult>;
  // Recipes someone removed, newest first, for "Recently removed".
  listRemoved(): Promise<RecipeSummary[]>;
  setFavourite(recipeId: string, on: boolean): Promise<void>;
  addCookingEntry(recipeId: string, input: CookingEntryInput): Promise<CookingEntry>;
  removeCookingEntry(entryId: string): Promise<void>;
  existingKeys(): Promise<ExistingKeys>;
  // Adds selected items; never overwrites a recipe or entry that's already there.
  importItems(items: ImportItem[], favouriteRecipeIds: string[]): Promise<ImportResult>;
  exportAll(): Promise<ExportBundle>;
}

export function summarize(recipes: Recipe[], entries: { recipeId: string; cookedOn: string }[], favourites: Set<string>): RecipeSummary[] {
  return recipes
    .map((r) => {
      const mine = entries.filter((e) => e.recipeId === r.id);
      const lastCookedOn = mine.reduce((max, e) => (e.cookedOn > max ? e.cookedOn : max), "");
      return { ...r, lastCookedOn, timesCooked: mine.length, favourite: favourites.has(r.id) };
    })
    // Most recently cooked or edited first.
    .sort((a, b) => activity(b).localeCompare(activity(a)) || b.updatedAt.localeCompare(a.updatedAt));
}

const activity = (r: RecipeSummary) =>
  r.lastCookedOn > r.updatedAt.slice(0, 10) ? r.lastCookedOn : r.updatedAt.slice(0, 10);

export const byNewestCook = (a: CookingEntry, b: CookingEntry) =>
  (b.cookedOn || "0").localeCompare(a.cookedOn || "0") || b.createdAt.localeCompare(a.createdAt);

export function keysOf(recipes: Recipe[], entries: { id: string }[]): ExistingKeys {
  return {
    recipeIds: new Set(recipes.map((r) => r.id)),
    entryIds: new Set(entries.map((e) => e.id)),
    titles: new Map(recipes.map((r) => [normTitle(r.title), r.id])),
  };
}

// ── This device (localStorage) ───────────────────────────────────────────────

// Written by the original app. Read for migration; never written or removed.
export const LEGACY_KEY = "elk-kitchen-recipes";
export const DEVICE_KEY = "elk-kitchen-device-v2";

type DeviceData = { recipes: Recipe[]; entries: CookingEntry[]; favouriteRecipeIds: string[] };
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const SEED_RECIPE: LegacyRecipe = {
  id: "seed-elk-crunch-bowl-v1",
  title: "ELK Crunch Bowl v1",
  author: "Lorne",
  dateCooked: "2026-03-19",
  tags: ["asian", "light", "crunchy", "chicken", "weeknight", "fresh", "salad"],
  suggestedTags: ["sesame", "ginger", "kimchi", "healthy", "colorful"],
  ingredients: `Romaine
Soybean sprouts
Carrot
Red onion
Purple cabbage
Cucumber
Crispy noodles
Chicken
Kimchi

Dressing:
Soy sauce
Sesame oil
Vinegar
Fresh grated ginger
Optional chili oil`,
  notes:
    "Fresh, crunchy, super delicious. Purple cabbage added great color and crunch. Cucumber worked well added fresh at serving. Crispy noodles added right before serving.",
  changes:
    "Added purple cabbage. Added cucumber per serving. Forgot kimchi at first, then added it after.",
  improveNextTime:
    "Maybe reduce soy slightly. Try lime. Add peanuts or sesame seeds.",
  approxCalories: 550,
  rating: 9,
};

export function readLegacyRaw(storage: KeyValueStorage): unknown[] | null {
  const raw = storage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fromLegacy(items: unknown[], now: string): DeviceData {
  const data: DeviceData = { recipes: [], entries: [], favouriteRecipeIds: [] };
  for (const raw of items) {
    const { recipe, entries } = legacyToRecipe(raw, now);
    if (!recipe.id || data.recipes.some((r) => r.id === recipe.id)) continue;
    data.recipes.push(recipe);
    data.entries.push(...entries);
  }
  return data;
}

// What this browser holds, without creating anything: the current device
// data, else the old app's recipes converted. null = nothing here.
export function readDeviceData(storage: KeyValueStorage, now = new Date().toISOString()): DeviceData | null {
  const raw = storage.getItem(DEVICE_KEY);
  if (raw) {
    try {
      const d = JSON.parse(raw) as DeviceData;
      if (Array.isArray(d.recipes) && Array.isArray(d.entries)) {
        return { recipes: d.recipes, entries: d.entries, favouriteRecipeIds: d.favouriteRecipeIds ?? [] };
      }
    } catch { /* fall through to legacy; the unreadable value is left in place */ }
  }
  const legacy = readLegacyRaw(storage);
  return legacy && legacy.length > 0 ? fromLegacy(legacy, now) : null;
}

export class DeviceRecipeStore implements RecipeStore {
  readonly mode = "this-device" as const;
  private storage: KeyValueStorage;
  private now: () => string;

  constructor(storage: KeyValueStorage, now: () => string = () => new Date().toISOString()) {
    this.storage = storage;
    this.now = now;
  }

  private load(): DeviceData {
    return readDeviceData(this.storage, this.now()) ?? fromLegacy([SEED_RECIPE], this.now());
  }

  private save(data: DeviceData) {
    // Never overwrite something we couldn't read: set it aside first.
    const previous = this.storage.getItem(DEVICE_KEY);
    if (previous && readDeviceData({ getItem: (k) => (k === DEVICE_KEY ? previous : null), setItem() {} }) === null) {
      this.storage.setItem(`${DEVICE_KEY}-unreadable-${this.now()}`, previous);
    }
    this.storage.setItem(DEVICE_KEY, JSON.stringify(data));
  }

  async listRecipes() {
    const d = this.load();
    return summarize(d.recipes.filter((r) => !r.removedAt), d.entries, new Set(d.favouriteRecipeIds));
  }

  async listRemoved() {
    const d = this.load();
    return summarize(d.recipes.filter((r) => r.removedAt), d.entries, new Set(d.favouriteRecipeIds));
  }

  async setRemoved(id: string, baseVersion: number, removed: boolean): Promise<UpdateResult> {
    const d = this.load();
    const i = d.recipes.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, current: null };
    const current = d.recipes[i];
    if (current.version !== baseVersion) return { ok: false, current };
    const now = this.now();
    const recipe: Recipe = { ...current, removedAt: removed ? now : null, version: current.version + 1, updatedAt: now };
    d.recipes[i] = recipe;
    this.save(d);
    return { ok: true, recipe };
  }

  async getRecipe(id: string): Promise<RecipeDetail | null> {
    const d = this.load();
    const recipe = d.recipes.find((r) => r.id === id);
    if (!recipe) return null;
    return {
      recipe,
      entries: d.entries.filter((e) => e.recipeId === id).sort(byNewestCook),
      favourite: d.favouriteRecipeIds.includes(id),
      favouriteOf: [],
    };
  }

  async createRecipe(input: RecipeInput) {
    const d = this.load();
    const now = this.now();
    const recipe: Recipe = { ...input, id: newId(), version: 1, createdAt: now, updatedAt: now };
    d.recipes.unshift(recipe);
    this.save(d);
    return recipe;
  }

  async updateRecipe(id: string, baseVersion: number, input: RecipeInput): Promise<UpdateResult> {
    const d = this.load();
    const i = d.recipes.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, current: null };
    const current = d.recipes[i];
    if (current.version !== baseVersion) return { ok: false, current };
    const recipe: Recipe = { ...current, ...input, version: current.version + 1, updatedAt: this.now() };
    d.recipes[i] = recipe;
    this.save(d);
    return { ok: true, recipe };
  }

  async setFavourite(recipeId: string, on: boolean) {
    const d = this.load();
    const rest = d.favouriteRecipeIds.filter((x) => x !== recipeId);
    d.favouriteRecipeIds = on ? [...rest, recipeId] : rest;
    this.save(d);
  }

  async addCookingEntry(recipeId: string, input: CookingEntryInput) {
    const d = this.load();
    if (!d.recipes.some((r) => r.id === recipeId)) throw new Error("That recipe isn't on this device.");
    const entry: CookingEntry = { ...input, id: newId(), recipeId, createdAt: this.now(), mine: true };
    d.entries.push(entry);
    this.save(d);
    return entry;
  }

  async removeCookingEntry(entryId: string) {
    const d = this.load();
    d.entries = d.entries.filter((e) => e.id !== entryId);
    this.save(d);
  }

  async existingKeys() {
    // Same view as everything else here (including the seed recipe on an
    // empty browser), so the import preview matches what import will do.
    const d = this.load();
    return keysOf(d.recipes, d.entries);
  }

  async importItems(items: ImportItem[], favouriteRecipeIds: string[]): Promise<ImportResult> {
    const d = this.load();
    const have = keysOf(d.recipes, d.entries);
    let recipesAdded = 0;
    let entriesAdded = 0;
    for (const item of items.filter((x) => x.selected)) {
      if (!have.recipeIds.has(item.recipe.id)) {
        d.recipes.push(item.recipe);
        have.recipeIds.add(item.recipe.id);
        recipesAdded++;
        if (favouriteRecipeIds.includes(item.recipe.id) && !d.favouriteRecipeIds.includes(item.recipe.id)) {
          d.favouriteRecipeIds.push(item.recipe.id);
        }
      }
      for (const e of item.newEntries) {
        if (have.entryIds.has(e.id)) continue;
        d.entries.push({ ...e, recipeId: item.recipe.id, mine: true });
        have.entryIds.add(e.id);
        entriesAdded++;
      }
    }
    this.save(d);
    return { recipesAdded, entriesAdded, failed: [] };
  }

  async exportAll(): Promise<ExportBundle> {
    const d = this.load();
    const legacy = readLegacyRaw(this.storage);
    return {
      app: EXPORT_APP,
      format: EXPORT_FORMAT,
      exportedAt: this.now(),
      source: "this-device",
      recipes: d.recipes,
      cookingEntries: d.entries,
      favouriteRecipeIds: d.favouriteRecipeIds,
      ...(legacy ? { legacyBrowserRecipes: legacy } : {}),
    };
  }
}
