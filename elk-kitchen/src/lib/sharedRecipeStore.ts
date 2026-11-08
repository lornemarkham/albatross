import type { SupabaseClient } from "@supabase/supabase-js";
import type { CookingEntry, CookingEntryInput, Recipe, RecipeDetail, RecipeInput } from "../types/recipe";
import { normalizeDetails } from "./meat";
import { EXPORT_APP, EXPORT_FORMAT, newId, normalizePhotos, type ExportBundle, type ImportItem, type ImportResult } from "./recipeModel";
import { byNewestCook, keysOf, summarize, type RecipeStore, type UpdateResult } from "./recipeStorage";
import { normalizeSession } from "./cooking/drafts";
import type { FeedbackInput, MealFeedback, MemberProfile, MemoryLoad, ProfileInput } from "../types/feedback";
import { hasScores, makeAgainOf, ratingOf, revisionsOf, scoresOf } from "./familyMemory";

// Family recipes in the ELK Supabase project (supabase/kitchen.sql). Who may
// read or write is decided there, by the family list; nothing here is a
// security boundary.

type RecipeRow = {
  id: string; title: string; author_name: string; ingredients: string; instructions: string; notes: string;
  tags: string[]; suggested_tags: string[]; approx_calories: number | null; legacy: unknown; extra: unknown;
  version: number; created_at: string; updated_at: string; removed_at: string | null;
};
type EntryRow = {
  id: string; recipe_id: string; cooked_on: string | null; cook_name: string; ingredients_used: string;
  substitutions: string; family_reaction: string; improve_next_time: string; notes: string;
  rating: number | string | null; extra: unknown; created_by: string | null; created_at: string;
};

type FeedbackRow = {
  id: string; entry_id: string; recipe_id: string; user_id: string; author_name: string; source: string;
  rating: number | string | null; comment: string; improvement: string; make_again: string | null;
  photos: unknown; history: unknown; version: number; created_at: string; updated_at: string; scores?: unknown;
};
type ProfileRow = { user_id: string; avoids: string; likes: string; notes: string; updated_at: string };
const FEEDBACK_COLS = "id,entry_id,recipe_id,user_id,author_name,source,rating,comment,improvement,make_again,photos,history,version,created_at,updated_at";
// kitchen.sql v6 adds `scores` (flavour / seasoning / texture / juiciness). A database
// still on v5 doesn't have it: Kitchen then reads and writes without it.
const SCORES_COL = ",scores";
const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === "42703" || e.code === "PGRST204" || /column .*scores.* does not exist|could not find the 'scores' column/i.test(e.message ?? "");

const RECIPE_COLS = "id,title,author_name,ingredients,instructions,notes,tags,suggested_tags,approx_calories,legacy,version,created_at,updated_at,removed_at,extra";
const ENTRY_COLS = "id,recipe_id,cooked_on,cook_name,ingredients_used,substitutions,family_reaction,improve_next_time,notes,rating,extra,created_by,created_at";

// Photos, kind, category and jerky/sausage details ride in one JSON column
// (supabase/kitchen.sql, v3) so the tables stay additive-only.
function recipeExtraOf(x: unknown): Pick<Recipe, "kind" | "category" | "photos" | "details"> {
  const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const now = "";
  return {
    kind: e.kind === "jerky" || e.kind === "sausage" ? e.kind : "general",
    category: typeof e.category === "string" ? e.category : "",
    photos: normalizePhotos(e.photos, now),
    details: normalizeDetails(e.details),
  };
}
function entryExtraOf(x: unknown): Pick<CookingEntry, "photos" | "equipment" | "timesAndTemps" | "yieldNote" | "tastingNotes" | "details" | "session"> {
  const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    photos: normalizePhotos(e.photos, ""),
    equipment: s(e.equipment), timesAndTemps: s(e.timesAndTemps), yieldNote: s(e.yieldNote), tastingNotes: s(e.tastingNotes),
    details: normalizeDetails(e.details),
    session: normalizeSession(e.session),
  };
}

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
  ...recipeExtraOf(r.extra),
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
  extra: { kind: i.kind, category: i.category, photos: i.photos, details: i.details },
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
  extra: { photos: i.photos, equipment: i.equipment, timesAndTemps: i.timesAndTemps, yieldNote: i.yieldNote, tastingNotes: i.tastingNotes, details: i.details, ...(i.session ? { session: i.session } : {}) },
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
    ...entryExtraOf(e.extra),
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
    // 23001 (RESTRICT) / 23503: family members have left feedback on this dinner (kitchen.sql v5 keeps it).
    if (error?.code === "23001" || error?.code === "23503") throw new Error("Family members have rated this dinner, so it stays — their feedback is theirs.");
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

  // ── Family memory (kitchen.sql v5) ──
  private toFeedback = (r: FeedbackRow): MealFeedback => ({
    id: r.id, entryId: r.entry_id, recipeId: r.recipe_id,
    authorName: r.author_name || "Someone",
    rating: ratingOf(r.rating), scores: scoresOf(r.scores), comment: r.comment, improvement: r.improvement, makeAgain: makeAgainOf(r.make_again),
    photos: normalizePhotos(r.photos, ""),
    source: r.source === "device-import" ? "device-import" : "app",
    version: r.version, history: revisionsOf(r.history), createdAt: r.created_at, updatedAt: r.updated_at,
    mine: r.source === "app" && r.user_id === this.userId,
  });

  // null until known; false when the shared database is still on kitchen.sql v5.
  private scoresColumn: boolean | null = null;
  private cols = () => (this.scoresColumn === false ? FEEDBACK_COLS : FEEDBACK_COLS + SCORES_COL);

  async listFeedback(): Promise<MemoryLoad<MealFeedback>> {
    const read = (cols: string) => this.client.from("kitchen_meal_feedback").select(cols).order("created_at").limit(5000) as unknown as Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
    let { data, error } = await read(this.cols());
    if (error && this.scoresColumn !== false && isMissingColumn(error)) {
      this.scoresColumn = false;
      ({ data, error } = await read(FEEDBACK_COLS));
    } else if (!error) this.scoresColumn ??= true;
    if (error) {
      if (isMissingTable(error)) return { status: "not-set-up" };
      fail("load dinner feedback", error);
    }
    return { status: "ready", items: (data as FeedbackRow[]).map(this.toFeedback) };
  }

  async saveFeedback(entryId: string, input: FeedbackInput, base: MealFeedback | null): Promise<MealFeedback> {
    const plain = {
      rating: input.rating, comment: input.comment, improvement: input.improvement,
      make_again: input.makeAgain, photos: input.photos,
    };
    const wantScores = hasScores(input.scores) || (base != null && hasScores(base.scores));
    if (wantScores && this.scoresColumn !== false) {
      try {
        return await this.writeFeedback(entryId, { ...plain, scores: scoresOf(input.scores) }, base, this.cols());
      } catch (e) {
        if (!(e instanceof MissingColumn)) throw e;
        this.scoresColumn = false;
      }
    }
    const saved = await this.writeFeedback(entryId, plain, base, FEEDBACK_COLS);
    return wantScores && this.scoresColumn === false ? { ...saved, scoresNotSaved: true } : saved;
  }

  private async writeFeedback(entryId: string, fields: Record<string, unknown>, base: MealFeedback | null, cols: string): Promise<MealFeedback> {
    const missing = (error: { code?: string; message?: string }) => { if ("scores" in fields && isMissingColumn(error)) throw new MissingColumn(); };
    if (base) {
      const { data, error } = await this.client.from("kitchen_meal_feedback")
        .update(fields).eq("id", base.id).eq("version", base.version).select(cols);
      if (error) { missing(error); fail("save your feedback", error); }
      const rows = data as unknown as FeedbackRow[];
      if (rows.length !== 1) throw new Error("Your feedback changed somewhere else first (another phone?). Reload to see it, then try again.");
      return this.toFeedback(rows[0]);
    }
    // recipe_id (from the dinner), user_id and author_name (from the family
    // list) are set by the database; the placeholder only satisfies NOT NULL.
    const { data, error } = await this.client.from("kitchen_meal_feedback")
      .insert({ entry_id: entryId, recipe_id: "-", ...fields }).select(cols).single();
    if (error) {
      missing(error);
      if (error.code === "23505") throw new Error("You've already given feedback on this dinner — change that one instead.");
      fail("save your feedback", error);
    }
    return this.toFeedback(data as unknown as FeedbackRow);
  }

  // From a phone's backup: kept under the name typed there, read-only, added once.
  async importFeedback(items: MealFeedback[]): Promise<number> {
    if (items.length === 0) return 0;
    const have = await this.existingKeys();
    const rows = items.filter((f) => have.entryIds.has(f.entryId)).map((f) => ({
      id: f.id, entry_id: f.entryId, recipe_id: f.recipeId, source: "device-import",
      author_name: (f.authorName || "Someone").slice(0, 60),
      rating: f.rating, comment: f.comment, improvement: f.improvement, make_again: f.makeAgain, photos: f.photos,
      ...(hasScores(f.scores) && this.scoresColumn !== false ? { scores: f.scores } : {}),
    }));
    if (rows.length === 0) return 0;
    let { data, error } = await this.client.from("kitchen_meal_feedback")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error && isMissingColumn(error)) {
      // v5 database: bring the ratings and words in; the detail scores stay in the backup file.
      this.scoresColumn = false;
      ({ data, error } = await this.client.from("kitchen_meal_feedback")
        .upsert(rows.map(({ scores: _s, ...r }) => r), { onConflict: "id", ignoreDuplicates: true }).select("id"));
    }
    if (error) fail("import dinner feedback", error);
    return (data ?? []).length;
  }

  async listProfiles(): Promise<MemoryLoad<MemberProfile>> {
    const [profiles, family] = await Promise.all([
      this.client.from("kitchen_member_profiles").select("user_id,avoids,likes,notes,updated_at"),
      this.client.from("elk_family_members").select("user_id,display_name"),
    ]);
    if (profiles.error) {
      if (isMissingTable(profiles.error)) return { status: "not-set-up" };
      fail("load food notes", profiles.error);
    }
    const names = new Map(((family.data ?? []) as { user_id: string; display_name: string | null }[])
      .map((m) => [m.user_id, m.display_name || "Someone"]));
    return {
      status: "ready",
      items: (profiles.data as ProfileRow[]).map((p) => ({
        key: p.user_id, name: names.get(p.user_id) ?? "Someone", avoids: p.avoids, likes: p.likes, notes: p.notes,
        updatedAt: p.updated_at, mine: p.user_id === this.userId,
      })),
    };
  }

  async saveMyProfile(input: ProfileInput): Promise<MemberProfile> {
    const { data, error } = await this.client.from("kitchen_member_profiles")
      .upsert({ user_id: this.userId, avoids: input.avoids, likes: input.likes, notes: input.notes }, { onConflict: "user_id" })
      .select("user_id,avoids,likes,notes,updated_at").single();
    if (error) fail("save your food notes", error);
    const p = data as ProfileRow;
    return { key: p.user_id, name: input.name, avoids: p.avoids, likes: p.likes, notes: p.notes, updatedAt: p.updated_at, mine: true };
  }

  async exportAll(): Promise<ExportBundle> {
    const [feedback, profiles] = await Promise.all([this.listFeedback(), this.listProfiles()]);
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
      ...(feedback.status === "ready" ? { mealFeedback: feedback.items } : {}),
      ...(profiles.status === "ready" ? { memberProfiles: profiles.items } : {}),
    };
  }
}

class MissingColumn extends Error {}
