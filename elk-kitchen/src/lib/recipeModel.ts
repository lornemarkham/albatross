import type { CookingEntry, LegacyRecipe, PhotoRef, Recipe, RecipeKind } from "../types/recipe";
import { blankDetails, normalizeDetails } from "./meat";
import type { ExportedPhoto } from "./photos";
import { normalizeSession } from "./cooking/drafts";
import type { MealFeedback, MemberProfile } from "../types/feedback";
import { normalizeFeedback } from "./familyMemory";

// ── Legacy (browser-only) recipes ────────────────────────────────────────────

export function normalizeLegacyRecipe(raw: unknown): LegacyRecipe {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    title: String(r.title ?? ""),
    author: String(r.author ?? ""),
    dateCooked: String(r.dateCooked ?? ""),
    ingredients: String(r.ingredients ?? ""),
    notes: String(r.notes ?? ""),
    changes: String(r.changes ?? ""),
    improveNextTime: String(r.improveNextTime ?? ""),
    approxCalories: Number(r.approxCalories) || 0,
    rating: Number(r.rating) || 0,
    tags: Array.isArray(r.tags) ? r.tags.map(String).filter(Boolean) : [],
    suggestedTags: Array.isArray(r.suggestedTags) ? r.suggestedTags.map(String).filter(Boolean) : undefined,
  };
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// The old record mixed "the recipe" with "the one time it was cooked". Split
// it: the recipe keeps title/ingredients/notes/tags, and the cooking details
// become its first cooking entry. The whole original rides along in `legacy`.
// Ids are kept (and the entry id derived from it) so importing twice is a no-op.
export function legacyToRecipe(raw: unknown, now: string): { recipe: Recipe; entries: CookingEntry[] } {
  const l = normalizeLegacyRecipe(raw);
  const recipe: Recipe = {
    id: l.id,
    title: l.title,
    authorName: l.author,
    ingredients: l.ingredients,
    instructions: "",
    notes: l.notes,
    tags: l.tags,
    suggestedTags: l.suggestedTags ?? [],
    approxCalories: l.approxCalories > 0 ? Math.round(l.approxCalories) : null,
    kind: "general",
    category: "",
    photos: [],
    details: blankDetails(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    legacy: raw,
  };
  const cooked = l.dateCooked || l.changes || l.improveNextTime || l.rating > 0;
  const entries: CookingEntry[] = cooked
    ? [{
        id: legacyEntryId(l.id),
        recipeId: l.id,
        cookedOn: isIsoDate(l.dateCooked) ? l.dateCooked : "",
        cookName: l.author,
        ingredientsUsed: "",
        substitutions: l.changes,
        familyReaction: "",
        improveNextTime: l.improveNextTime,
        notes: "",
        rating: l.rating > 0 ? Math.min(10, l.rating) : null,
        photos: [],
        equipment: "",
        timesAndTemps: "",
        yieldNote: "",
        tastingNotes: "",
        details: blankDetails(),
        createdAt: now,
        mine: true,
      }]
    : [];
  return { recipe, entries };
}

export const legacyEntryId = (recipeId: string) => `${recipeId}~first-cook`;

// ── Export / import file ─────────────────────────────────────────────────────

export const EXPORT_APP = "elk-kitchen";
export const EXPORT_FORMAT = 2;

export type ExportBundle = {
  app: typeof EXPORT_APP;
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  source: "family" | "this-device";
  recipes: Recipe[];
  cookingEntries: CookingEntry[];
  favouriteRecipeIds: string[];
  // Whatever the old app had stored in this browser, untouched.
  legacyBrowserRecipes?: unknown[];
  // The pictures themselves, so a backup is complete on its own.
  photos?: ExportedPhoto[];
  // Photos a record points to that couldn't be found when exporting.
  missingPhotoIds?: string[];
  // Each person's feedback on dinners, and their food notes (added later;
  // older files simply don't have them).
  mealFeedback?: MealFeedback[];
  memberProfiles?: MemberProfile[];
};

export type ImportData = {
  recipes: Recipe[];
  entries: CookingEntry[];
  favouriteRecipeIds: string[];
  photos: ExportedPhoto[];
  mealFeedback?: MealFeedback[];
};

export function exportFileName(bundle: ExportBundle): string {
  const stamp = bundle.exportedAt.slice(0, 16).replace(/[:T]/g, "-");
  return `elk-kitchen-${bundle.source}-${stamp}.json`;
}

// Accepts an ELK Kitchen export, or the old app's raw localStorage array.
export function parseImportFile(text: string, now: string): ImportData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (Array.isArray(parsed)) return fromLegacyArray(parsed, now);

  const b = parsed as Partial<ExportBundle> | null;
  if (!b || b.app !== EXPORT_APP || !Array.isArray(b.recipes)) {
    throw new Error("That file isn't an ELK Kitchen export.");
  }
  if (b.format !== EXPORT_FORMAT) {
    throw new Error(`This export is format ${String(b.format)}; this version of ELK Kitchen reads format ${EXPORT_FORMAT}.`);
  }
  const recipes = b.recipes.map((r) => normalizeRecipe(r, now)).filter((r) => r.id && r.title.trim());
  const ids = new Set(recipes.map((r) => r.id));
  const entries = (Array.isArray(b.cookingEntries) ? b.cookingEntries : [])
    .map((e) => normalizeEntry(e, now))
    .filter((e) => e.id && ids.has(e.recipeId));
  const data: ImportData = {
    recipes,
    entries,
    favouriteRecipeIds: (Array.isArray(b.favouriteRecipeIds) ? b.favouriteRecipeIds : []).map(String),
    photos: (Array.isArray(b.photos) ? b.photos : []).filter(
      (p): p is ExportedPhoto => !!p && typeof p.id === "string" && typeof p.data === "string" && typeof p.mime === "string"),
    mealFeedback: (Array.isArray(b.mealFeedback) ? b.mealFeedback : []).map(normalizeFeedback)
      .filter((f): f is MealFeedback => !!f && ids.has(f.recipeId)),
  };
  // Legacy records carried inside the export that never made it into `recipes`.
  if (Array.isArray(b.legacyBrowserRecipes)) {
    const legacy = fromLegacyArray(b.legacyBrowserRecipes, now);
    for (const r of legacy.recipes) {
      if (!ids.has(r.id)) {
        ids.add(r.id);
        data.recipes.push(r);
        data.entries.push(...legacy.entries.filter((e) => e.recipeId === r.id));
      }
    }
  }
  return data;
}

function fromLegacyArray(items: unknown[], now: string): ImportData {
  const out: ImportData = { recipes: [], entries: [], favouriteRecipeIds: [], photos: [] };
  for (const raw of items) {
    const { recipe, entries } = legacyToRecipe(raw, now);
    if (!recipe.id || !recipe.title.trim()) continue;
    out.recipes.push(recipe);
    out.entries.push(...entries);
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strList = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function normalizePhotos(v: unknown, now: string): PhotoRef[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return typeof o.id === "string" && o.id ? [{ id: o.id, caption: str(o.caption), addedAt: str(o.addedAt) || now }] : [];
  });
}

export function normalizeRecipe(raw: unknown, now: string): Recipe {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    title: str(r.title),
    authorName: str(r.authorName),
    ingredients: str(r.ingredients),
    instructions: str(r.instructions),
    notes: str(r.notes),
    tags: strList(r.tags),
    suggestedTags: strList(r.suggestedTags),
    approxCalories: numOrNull(r.approxCalories),
    kind: (["general", "jerky", "sausage"] as RecipeKind[]).includes(r.kind as RecipeKind) ? (r.kind as RecipeKind) : "general",
    category: str(r.category),
    photos: normalizePhotos(r.photos, now),
    details: normalizeDetails(r.details),
    version: typeof r.version === "number" ? r.version : 1,
    createdAt: str(r.createdAt) || now,
    updatedAt: str(r.updatedAt) || now,
    ...(r.legacy !== undefined ? { legacy: r.legacy } : {}),
  };
}

export function normalizeEntry(raw: unknown, now: string): CookingEntry {
  const e = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(e.id),
    recipeId: str(e.recipeId),
    cookedOn: isIsoDate(str(e.cookedOn)) ? str(e.cookedOn) : "",
    cookName: str(e.cookName),
    ingredientsUsed: str(e.ingredientsUsed),
    substitutions: str(e.substitutions),
    familyReaction: str(e.familyReaction),
    improveNextTime: str(e.improveNextTime),
    notes: str(e.notes),
    rating: numOrNull(e.rating),
    photos: normalizePhotos(e.photos, now),
    equipment: str(e.equipment),
    timesAndTemps: str(e.timesAndTemps),
    yieldNote: str(e.yieldNote),
    tastingNotes: str(e.tastingNotes),
    details: normalizeDetails(e.details),
    session: normalizeSession(e.session),
    createdAt: str(e.createdAt) || now,
    mine: true,
  };
}

// ── Import planning (duplicate prevention) ───────────────────────────────────

export type ExistingKeys = {
  recipeIds: Set<string>;
  entryIds: Set<string>;
  // normalized title → id of the recipe already using it
  titles: Map<string, string>;
};

export type ImportItem = {
  recipe: Recipe;
  // Entries not already present (by id). Only these are sent.
  newEntries: CookingEntry[];
  // new           not here yet → imported
  // already-here  same id already here → recipe untouched; only missing entries added
  // same-title    different id, same title → probably a copy; skipped unless chosen
  status: "new" | "already-here" | "same-title";
  sameTitleAs?: string;
  selected: boolean;
};

export const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

export function planImport(data: ImportData, existing: ExistingKeys): ImportItem[] {
  const seen = new Set<string>();
  const items: ImportItem[] = [];
  for (const recipe of data.recipes) {
    if (seen.has(recipe.id)) continue; // a file listing one id twice imports it once
    seen.add(recipe.id);
    const newEntries = data.entries.filter((e) => e.recipeId === recipe.id && !existing.entryIds.has(e.id));
    if (existing.recipeIds.has(recipe.id)) {
      items.push({ recipe, newEntries, status: "already-here", selected: newEntries.length > 0 });
      continue;
    }
    const sameTitleAs = existing.titles.get(normTitle(recipe.title));
    if (sameTitleAs) {
      items.push({ recipe, newEntries, status: "same-title", sameTitleAs, selected: false });
    } else {
      items.push({ recipe, newEntries, status: "new", selected: true });
    }
  }
  return items;
}

export type ImportResult = {
  recipesAdded: number;
  entriesAdded: number;
  // Items the store refused; everything else was still imported.
  failed: { title: string; error: string }[];
};

// ── Forms ────────────────────────────────────────────────────────────────────

export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const t of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function todayIso(d = new Date()): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function parseOptionalNumber(raw: string, min: number, max: number, label: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
