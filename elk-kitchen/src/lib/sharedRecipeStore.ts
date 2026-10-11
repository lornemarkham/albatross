import type { SupabaseClient } from "@supabase/supabase-js";
import type { CookingEntry, CookingEntryInput, Recipe, RecipeDetail, RecipeInput } from "../types/recipe";
import { EXPORT_APP, EXPORT_FORMAT, newId, type ExportBundle, type ImportItem, type ImportResult } from "./recipeModel";
import { byNewestCook, keysOf, summarize, type RecipeStore, type UpdateResult } from "./recipeStorage";

// Family recipes in the ELK Supabase project (supabase/kitchen.sql). Who may
// read or write is decided there, by the family list; nothing here is a
// security boundary.

type RecipeRow = {
  id: string; title: string; author_name: string; ingredients: string; instructions: string; notes: string;
  tags: string[]; suggested_tags: string[]; approx_calories: number | null; legacy: unknown;
  version: number; created_at: string; updated_at: string; removed_at: string | null;
};
type EntryRow = {
  id: string; recipe_id: string; cooked_on: string | null; cook_name: string; ingredients_used: string;
  substitutions: string; family_reaction: string; improve_next_time: string; notes: string;
  rating: number | string | null; created_by: string | null; created_at: string;
};

const RECIPE_COLS = "id,title,author_name,ingredients,instructions,notes,tags,suggested_tags,approx_calories,legacy,version,created_at,updated_at,removed_at";
const ENTRY_COLS = "id,recipe_id,cooked_on,cook_name,ingredients_used,substitutions,family_reaction,improve_next_time,notes,rating,created_by,created_at";

export const toRecipe = (r: RecipeRow): Recipe => ({
  id: r.id,
  title: r.title,
  authorName: r.author_name,
  ingredients: r.ingredients,
  instructions: r.instructions,
  notes: r.notes,
  tags: r.tags ?? [],
  suggestedTags: r.suggested_tags ?? [],
  approxCalories: r.approx_calories,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.legacy != null ? { legacy: r.legacy } : {}),
  removedAt: r.removed_at,
});

// Writable columns only: id/version/authorship/timestamps are set by the database.
const recipeRow = (i: RecipeInput) => ({
  title: i.title,
  author_name: i.authorName,
  ingredients: i.ingredients,
  instructions: i.instructions,
  notes: i.notes,
  tags: i.tags,
  suggested_tags: i.suggestedTags,
  approx_calories: i.approxCalories,
});

const entryRow = (recipeId: string, i: CookingEntryInput) => ({
  recipe_id: recipeId,
  cooked_on: i.cookedOn || null,
  cook_name: i.cookName,
  ingredients_used: i.ingredientsUsed,
  substitutions: i.substitutions,
  family_reaction: i.familyReaction,
  improve_next_time: i.improveNextTime,
  notes: i.notes,
  rating: i.rating,
});

// Supabase's API returns at most 1000 rows per request, silently. Page
// through so backups and duplicate checks always see everything.
const PAGE = 1000;
type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
async function fetchAll<T>(what: string, page: (from: number, to: number) => Page): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(what, error);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGE) return rows;
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Couldn't ${what}: ${error.message}`);
}

// PGRST205 = table not in PostgREST's schema cache; 42P01 = no such table.
export const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table/i.test(e.message ?? "");

export async function sharedTablesReady(client: SupabaseClient): Promise<"ready" | "not-set-up" | { error: string }> {
  const { error } = await client.from("kitchen_recipes").select("id").limit(1);
  if (!error) return "ready";
  return isMissingTable(error) ? "not-set-up" : { error: error.message };
}

export class SharedRecipeStore implements RecipeStore {
  readonly mode = "family" as const;
  private client: SupabaseClient;
  private userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  private toEntry = (e: EntryRow): CookingEntry => ({
    id: e.id,
    recipeId: e.recipe_id,
    cookedOn: e.cooked_on ?? "",
    cookName: e.cook_name,
    ingredientsUsed: e.ingredients_used,
    substitutions: e.substitutions,
    familyReaction: e.family_reaction,
    improveNextTime: e.improve_next_time,
    notes: e.notes,
    rating: e.rating == null ? null : Number(e.rating),
    createdAt: e.created_at,
    mine: e.created_by === this.userId,
  });

  // The signed-in person's name on the family list ("" if none set).
  async myName(): Promise<string> {
    const { data } = await this.client.from("elk_family_members").select("display_name").eq("user_id", this.userId).maybeSingle();
    return (data?.display_name as string | null) ?? "";
  }

  listRecipes() { return this.list(false); }
  listRemoved() { return this.list(true); }

  private async list(removed: boolean) {
    const [recipes, entries, favs] = await Promise.all([
      fetchAll<RecipeRow>("load recipes", (a, b) => {
        const q = this.client.from("kitchen_recipes").select(RECIPE_COLS);
        return (removed ? q.not("removed_at", "is", null) : q.is("removed_at", null)).order("id").range(a, b);
      }),
      fetchAll<{ recipe_id: string; cooked_on: string | null }>("load cooking history",
        (a, b) => this.client.from("kitchen_cooking_entries").select("recipe_id,cooked_on").order("id").range(a, b)),
      fetchAll<{ recipe_id: string }>("load favourites",
        (a, b) => this.client.from("kitchen_favourites").select("recipe_id").eq("user_id", this.userId).order("recipe_id").range(a, b)),
    ]);
    return summarize(
      recipes.map(toRecipe),
      entries.map((e) => ({ recipeId: e.recipe_id, cookedOn: e.cooked_on ?? "" })),
      new Set(favs.map((f) => f.recipe_id)),
    );
  }

  async getRecipe(id: string): Promise<RecipeDetail | null> {
    const [recipe, entries, favs, family] = await Promise.all([
      this.client.from("kitchen_recipes").select(RECIPE_COLS).eq("id", id).maybeSingle(),
      this.client.from("kitchen_cooking_entries").select(ENTRY_COLS).eq("recipe_id", id),
      this.client.from("kitchen_favourites").select("user_id").eq("recipe_id", id),
      this.client.from("elk_family_members").select("user_id,display_name"),
    ]);
    if (recipe.error) fail("load the recipe", recipe.error);
    if (!recipe.data) return null;
    if (entries.error) fail("load cooking history", entries.error);
    if (favs.error) fail("load favourites", favs.error);
    const names = new Map(((family.data ?? []) as { user_id: string; display_name: string | null }[])
      .map((m) => [m.user_id, m.display_name || "Someone"]));
    const favUsers = (favs.data as { user_id: string }[]).map((f) => f.user_id);
    return {
      recipe: toRecipe(recipe.data as RecipeRow),
      entries: (entries.data as EntryRow[]).map(this.toEntry).sort(byNewestCook),
      favourite: favUsers.includes(this.userId),
      favouriteOf: favUsers.map((u) => names.get(u) ?? "Someone"),
    };
  }

  async createRecipe(input: RecipeInput) {
    const { data, error } = await this.client.from("kitchen_recipes")
      .insert({ id: newId(), ...recipeRow(input) }).select(RECIPE_COLS).single();
    if (error) fail("save the recipe", error);
    return toRecipe(data as RecipeRow);
  }

  updateRecipe(id: string, baseVersion: number, input: RecipeInput): Promise<UpdateResult> {
    return this.versioned(id, baseVersion, recipeRow(input));
  }

  private async versioned(id: string, baseVersion: number, patch: Record<string, unknown>): Promise<UpdateResult> {
    const { data, error } = await this.client.from("kitchen_recipes")
      .update(patch).eq("id", id).eq("version", baseVersion).select(RECIPE_COLS);
    if (error) fail("save the recipe", error);
    const rows = data as RecipeRow[];
    if (rows.length === 1) return { ok: true, recipe: toRecipe(rows[0]) };
    const now = await this.client.from("kitchen_recipes").select(RECIPE_COLS).eq("id", id).maybeSingle();
    if (now.error) fail("check the recipe", now.error);
    return { ok: false, current: now.data ? toRecipe(now.data as RecipeRow) : null };
  }

  async setRemoved(id: string, baseVersion: number, removed: boolean): Promise<UpdateResult> {
    // The database replaces this time with its own, and records who did it.
    return this.versioned(id, baseVersion, { removed_at: removed ? new Date().toISOString() : null });
  }

  async setFavourite(recipeId: string, on: boolean) {
    const { error } = on
      ? await this.client.from("kitchen_favourites").upsert({ recipe_id: recipeId, user_id: this.userId }, { ignoreDuplicates: true })
      : await this.client.from("kitchen_favourites").delete().eq("recipe_id", recipeId).eq("user_id", this.userId);
    if (error) fail("update favourites", error);
  }

  async addCookingEntry(recipeId: string, input: CookingEntryInput) {
    const { data, error } = await this.client.from("kitchen_cooking_entries")
      .insert(entryRow(recipeId, input)).select(ENTRY_COLS).single();
    if (error) fail("save the cooking entry", error);
    return this.toEntry(data as EntryRow);
  }

  async removeCookingEntry(entryId: string) {
    const { data, error } = await this.client.from("kitchen_cooking_entries").delete().eq("id", entryId).select("id");
    if (error) fail("remove the entry", error);
    if ((data ?? []).length === 0) throw new Error("Only the person who recorded an entry can remove it.");
  }

  async existingKeys() {
    const [recipes, entries] = await Promise.all([
      fetchAll<Recipe>("check existing recipes", (a, b) => this.client.from("kitchen_recipes").select("id,title").order("id").range(a, b)),
      fetchAll<{ id: string }>("check existing entries", (a, b) => this.client.from("kitchen_cooking_entries").select("id").order("id").range(a, b)),
    ]);
    return keysOf(recipes, entries);
  }

  // Insert-if-absent by id (ON CONFLICT DO NOTHING): re-running an import, or
  // two people importing the same file, can never overwrite or duplicate.
  async importItems(items: ImportItem[], favouriteRecipeIds: string[]): Promise<ImportResult> {
    let recipesAdded = 0;
    let entriesAdded = 0;
    const failed: ImportResult["failed"] = [];
    for (const item of items.filter((x) => x.selected)) {
      const r = item.recipe;
      // One recipe the database refuses (e.g. an over-long field from the old
      // app) mustn't stop the rest; it's reported and stays where it came from.
      try {
        if (item.status !== "already-here") {
          const { data, error } = await this.client.from("kitchen_recipes")
            .upsert({ id: r.id, ...recipeRow(r), legacy: r.legacy ?? null }, { onConflict: "id", ignoreDuplicates: true })
            .select("id");
          if (error) fail(`import "${r.title}"`, error);
          recipesAdded += (data ?? []).length;
          if (favouriteRecipeIds.includes(r.id)) await this.setFavourite(r.id, true);
        }
        if (item.newEntries.length > 0) {
          const { data, error } = await this.client.from("kitchen_cooking_entries")
            .upsert(item.newEntries.map((e) => ({ id: e.id, ...entryRow(r.id, e) })), { onConflict: "id", ignoreDuplicates: true })
            .select("id");
          if (error) fail(`import cooking history for "${r.title}"`, error);
          entriesAdded += (data ?? []).length;
        }
      } catch (e) {
        failed.push({ title: r.title || "(untitled)", error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { recipesAdded, entriesAdded, failed };
  }

  async exportAll(): Promise<ExportBundle> {
    const [recipes, entries, favs] = await Promise.all([
      fetchAll<RecipeRow>("export recipes", (a, b) => this.client.from("kitchen_recipes").select(RECIPE_COLS).order("created_at").order("id").range(a, b)),
      fetchAll<EntryRow>("export cooking history", (a, b) => this.client.from("kitchen_cooking_entries").select(ENTRY_COLS).order("created_at").order("id").range(a, b)),
      fetchAll<{ recipe_id: string }>("export favourites",
        (a, b) => this.client.from("kitchen_favourites").select("recipe_id").eq("user_id", this.userId).order("recipe_id").range(a, b)),
    ]);
    return {
      app: EXPORT_APP,
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      source: "family",
      recipes: recipes.map(toRecipe),
      cookingEntries: entries.map(this.toEntry),
      favouriteRecipeIds: favs.map((f) => f.recipe_id),
    };
  }
}
