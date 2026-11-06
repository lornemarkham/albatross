// Turning a cooking session into the batch record (and, for a cook that
// started without a recipe, a first recipe). Deterministic: every line comes
// from something said, typed or tapped, and the person reviews and edits all
// of it before saving. Nothing here changes a measurement.
import type { CookingEntryInput, MeatDetails, PhotoRef, Recipe, RecipeInput } from "../../types/recipe";
import type { CookingSession, SessionEvent, SessionIngredient } from "../../types/cooking";
import { blankDetails } from "../meat";
import { TEMP_LABEL, durationText, grams, qtyText, quantityAt, tempText, toC } from "./parse";

export const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/(es|s)$/, "");

// How an ingredient's amount got where it is, in words.
export function ingredientStory(i: SessionIngredient): string {
  const said = i.history.filter((h) => h.why !== "removed");
  if (said.length <= 1) return "";
  return said.map((h) => `${h.why === "said" ? "said" : h.why === "added-more" ? "added more →" : h.why === "edited" ? "edited →" : "corrected →"} ${qtyText(h.qty)}`).join(", ");
}

export function ingredientLines(s: CookingSession): string[] {
  return s.ingredients.filter((i) => !i.removed).map((i) => {
    const story = ingredientStory(i);
    return `${i.name} — ${qtyText(i.qty)}${story ? ` (${story})` : ""}`;
  });
}

// Recipe ingredient names, roughly: the words after any leading quantity.
function recipeNames(recipe: Recipe | null): string[] {
  if (!recipe) return [];
  const fromSeasoning = recipe.details.seasoning.split("\n").map((l) => l.replace(/[\s:=-]*\d+(?:[.,]\d+)?\s*%\s*$/, "").trim());
  const fromLines = recipe.ingredients.split("\n").map((l) => {
    const t = l.trim().replace(/^[-•*]\s*/, "");
    return quantityAt(t)?.rest ?? t;
  });
  return [...fromSeasoning, ...fromLines, recipe.details.meatType].map(norm).filter(Boolean);
}

export function notInRecipe(s: CookingSession, recipe: Recipe | null): string[] {
  const names = recipeNames(recipe);
  if (!recipe) return [];
  return s.ingredients.filter((i) => !i.removed).map((i) => i.name).filter((n) => {
    const k = norm(n);
    return !names.some((r) => r === k || r.includes(k) || k.includes(r));
  });
}

const notes = (s: CookingSession, category: string) =>
  s.events.filter((e): e is Extract<SessionEvent, { kind: "note" }> => e.kind === "note" && e.category === category);

export function timeline(s: CookingSession): string[] {
  const out: string[] = [];
  for (const e of s.events) {
    if (e.kind === "temperature") out.push(`${timeOf(e.at)} ${TEMP_LABEL[e.what]} ${tempText(e.value, e.unit)}`);
    if (e.kind === "timer" && e.action === "started") out.push(`${timeOf(e.at)} Timer ${durationText(e.seconds)} (${e.label})`);
    if (e.kind === "timer" && e.action === "done") out.push(`${timeOf(e.at)} Timer done (${e.label})`);
  }
  return out;
}

export type BatchDraft = Omit<CookingEntryInput, "session">;

// The batch table's text limits (kitchen.sql). The full detail is always in
// the session saved alongside, so a summary that's too long is shortened
// with a pointer rather than refused.
const LIMIT = { ingredientsUsed: 20000, other: 10000 };
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const note = "\n… (shortened — everything is in the cooking journal)";
  return text.slice(0, max - note.length) + note;
}

export function batchFromSession(s: CookingSession, recipe: Recipe | null): BatchDraft {
  const lines = ingredientLines(s);
  const extra = notInRecipe(s, recipe);
  const photos: PhotoRef[] = s.events.flatMap((e) => (e.kind === "media" && e.media.type === "photo" ? [{ id: e.media.id, caption: e.media.caption, addedAt: e.media.addedAt }] : []));
  const internal = s.events.filter((e): e is Extract<SessionEvent, { kind: "temperature" }> => e.kind === "temperature" && e.what === "internal");
  const lastInternal = internal[internal.length - 1];
  const details: MeatDetails = recipe && recipe.kind !== "general"
    ? { ...recipe.details, internalTempC: lastInternal ? Math.round(toC(lastInternal.value, lastInternal.unit) * 10) / 10 : null, finishedWeightG: null }
    : blankDetails();
  const meat = recipe && recipe.kind !== "general" && recipe.details.meatType.trim() ? findMeat(s, recipe.details.meatType) : null;
  if (meat?.qty) { const g = grams(meat.qty); if (g != null) details.meatWeightG = Math.round(g); }
  const start = timeOf(s.startedAt), end = s.endedAt ? timeOf(s.endedAt) : "";
  return {
    cookedOn: dateOf(s.startedAt),
    cookName: s.cookName,
    ingredientsUsed: clip(lines.join("\n"), LIMIT.ingredientsUsed),
    substitutions: extra.length ? `Not in the written recipe: ${extra.join(", ")}` : "",
    familyReaction: "",
    improveNextTime: clip(notes(s, "next-time").map((n) => n.text).join("\n"), LIMIT.other),
    notes: clip([
      `Cooking session ${start}${end ? `–${end}` : ""}, ${s.transcript.length} thing${s.transcript.length === 1 ? "" : "s"} said or typed.`,
      ...notes(s, "observation").map((n) => `${timeOf(n.at)} ${n.text}`),
    ].join("\n"), LIMIT.other),
    rating: null,
    photos,
    equipment: clip(notes(s, "equipment").map((n) => n.text).join("\n"), LIMIT.other),
    timesAndTemps: clip(timeline(s).join("\n"), LIMIT.other),
    yieldNote: "",
    tastingNotes: clip(notes(s, "tasting").map((n) => n.text).join("\n"), LIMIT.other),
    details,
  };
}

function findMeat(s: CookingSession, meatType: string): SessionIngredient | null {
  const k = norm(meatType);
  return s.ingredients.find((i) => !i.removed && (norm(i.name).includes(k) || k.includes(norm(i.name)))) ?? null;
}

// A cook that started without a recipe becomes one: what was used, and what
// was learned. The person edits it before it's saved.
export function recipeFromSession(s: CookingSession, title: string): RecipeInput {
  return {
    title: title.trim() || s.recipeTitle,
    authorName: s.cookName,
    ingredients: s.ingredients.filter((i) => !i.removed).map((i) => `${qtyText(i.qty)} ${i.name}`).join("\n"),
    instructions: "",
    notes: [...notes(s, "observation"), ...notes(s, "next-time")].map((n) => n.text).join("\n"),
    tags: [],
    suggestedTags: [],
    approxCalories: null,
    kind: "general",
    category: "",
    photos: [],
    details: blankDetails(),
  };
}

// Everything the session holds that's a stored file, for backups.
export const sessionMediaIds = (s: CookingSession | null | undefined) =>
  (s?.events ?? []).flatMap((e) => (e.kind === "media" ? [e.media.id] : []));

// The shared table keeps a batch's extras in one JSON column with a size cap
// (kitchen.sql v4: 1 000 000 characters). Leave room for the rest of the record.
export const SESSION_MAX_CHARS = 950_000;
export const sessionSize = (s: CookingSession) => JSON.stringify(s).length;
