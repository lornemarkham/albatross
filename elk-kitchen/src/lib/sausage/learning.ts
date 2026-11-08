// What Kitchen has learned about a recipe from tasting it (M635): shown when
// the cook makes it again. Everything here is read from what people said; the
// only suggestions are the cook's own "what would you change" answers and a
// plain nudge where a score was low. The recipe itself is never changed.

import type { MealFeedback } from "../../types/feedback";
import type { CookingEntry, PhotoRef, Recipe } from "../../types/recipe";
import type { IngredientLine, SausagePlan } from "../../types/sausage";
import { dayOf } from "./day";
import { SCORE_KEYS, familyView, type FamilyView, type Scores, type Tasting } from "./tasting";

export type MadeBefore = { planTitle: string; madeOn: string; ingredients: IngredientLine[]; corrected: boolean; note: string };

export type Learning = {
  family: FamilyView;
  tastings: number;
  madeBefore: MadeBefore[];
  improvements: { name: string; text: string }[];
  comments: { name: string; text: string }[];
  nudges: string[];
  photos: PhotoRef[];
};

const LOW = 6;

export function learningFor(recipe: Recipe, tastings: Tasting[], feedback: MealFeedback[], entries: CookingEntry[], plans: SausagePlan[]): Learning {
  const mine = tastings.filter((t) => t.recipeId === recipe.id);
  const entryIds = new Set(entries.map((e) => e.id));
  const fb = feedback.filter((f) => f.recipeId === recipe.id && entryIds.has(f.entryId));
  const family = familyView(mine, fb.map((f) => ({ name: f.authorName, rating: f.rating, makeAgain: f.makeAgain })));
  const madeBefore: MadeBefore[] = plans.flatMap((p) => (dayOf(p).completion?.made ?? []).filter((m) => m.recipeId === recipe.id).map((m) => ({
    planTitle: p.title, madeOn: m.madeOn, ingredients: m.ingredients, corrected: m.corrections.length > 0, note: m.note,
  })));
  const seen = new Set<string>();
  const improvements: Learning["improvements"] = [];
  const add = (name: string, text: string) => { const t = text.trim(); const k = `${name.toLowerCase()}|${t.toLowerCase()}`; if (t && !seen.has(k)) { seen.add(k); improvements.push({ name: name || "Someone", text: t }); } };
  for (const t of mine) add(t.author, t.change);
  for (const f of fb) add(f.authorName, f.improvement);
  for (const e of entries) add(e.cookName, e.improveNextTime);
  const cs = new Set<string>();
  const comments: Learning["comments"] = [];
  for (const [name, text] of [...mine.map((t) => [t.author, t.notes] as const), ...fb.map((f) => [f.authorName, f.comment] as const)]) {
    const k = `${name.toLowerCase()}|${text.trim().toLowerCase()}`;
    if (text.trim() && !cs.has(k)) { cs.add(k); comments.push({ name: name || "Someone", text: text.trim() }); }
  }
  const nudges = SCORE_KEYS.filter((s) => s.key !== "overall").flatMap((s) => {
    const v = family.average[s.key as keyof Scores];
    return v != null && v <= LOW ? [`${s.label} averaged ${v}/10 — worth a look next time.`] : [];
  });
  const photos = [...mine.flatMap((t) => t.photos), ...fb.flatMap((f) => f.photos), ...entries.flatMap((e) => e.photos)];
  return { family, tastings: mine.length, madeBefore, improvements, comments, nudges, photos: photos.filter((p, i) => photos.findIndex((q) => q.id === p.id) === i) };
}

export const hasLearning = (l: Learning) => l.tastings > 0 || l.family.raters > 0 || l.madeBefore.length > 0 || l.improvements.length > 0;
