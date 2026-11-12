// The kitchen screen's "today": everything on it comes from the family's
// recipes, their recorded feedback and cooking history, ELK Pantry (Inventory)
// and the plan board. Plain rules, no AI call: recommend() does the scoring
// (pantry match, food to use soon, family ratings, recently made, food notes)
// and this picks what the wall shows and says it in a few short words.
//
// Same honesty rules as the rest of Kitchen: Pantry counts packages, not
// amounts, so "Pantry shows 9 of 11" never becomes "you have enough"; a rating
// is quoted only when someone gave it.

import type { RecipeSummary } from "../../types/recipe";
import type { MealFeedback, MemberProfile } from "../../types/feedback";
import type { PantryItem } from "../pantry";
import type { HistoryItem } from "../cooking/history";
import { recommend, type Suggestion } from "../companion/recommend";
import { parseAsk } from "../companion/ask";
import { isLow, leftovers, useSoon, whenLabel, daysBetween, type SoonItem } from "../companion/pantryView";
import { tasteByRecipe, type RecipeTaste } from "../familyMemory";
import { ratingToStars } from "./stars";
import type { PlannedMeal } from "./mealPlan";

export type DinnerIdea = { suggestion: Suggestion; why: string[] };
export type Favourite = { recipe: RecipeSummary; stars: number | null; ratedBy: number; wantAgain: string[] };

export type KitchenToday = {
  pantryConnected: boolean;
  dinner: DinnerIdea[];
  planned: PlannedMeal[];
  // Food needing attention: best-before soon (or past) and leftovers.
  soon: SoonItem[];
  leftovers: PantryItem[];
  available: PantryItem[];
  low: PantryItem[];
  // Came into Pantry in the last week, newest first.
  recentlyAdded: PantryItem[];
  favourites: Favourite[];
  recentlyCooked: HistoryItem[];
  taste: Map<string, RecipeTaste>;
};

// Things you make to cook with (stock, dressings) and sausage/jerky batches aren't dinners.
export const isDinnerCandidate = (r: RecipeSummary) =>
  !r.removedAt && r.kind === "general" && !/\b(staples?|dressings?|sauces?|stocks?|condiments?)\b/i.test(r.category);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Up to three short reasons, most useful first.
export function shortWhy(s: Suggestion, taste: RecipeTaste | undefined, soon: SoonItem[], today: string): string[] {
  const out: string[] = [];
  for (const so of soon) {
    const used = s.check?.lines.some((l) => l.status.state === "have" && l.status.item.name === so.item.name);
    if (used) out.push(`Uses the ${so.item.name.toLowerCase()} that needs eating (${whenLabel(so.daysLeft)})`);
  }
  if (taste?.average != null) out.push(`Your family rated this ${ratingToStars(taste.average)} stars (${plural(taste.ratings.length, "rating")})`);
  if (taste?.wouldMakeAgain.length) out.push(`${nameList(taste.wouldMakeAgain)} want${taste.wouldMakeAgain.length === 1 ? "s" : ""} it again`);
  if (s.check && s.check.total > 0) {
    out.push(s.check.have === s.check.total
      ? `Pantry shows all ${s.check.total} ingredients`
      : `Pantry shows ${s.check.have} of ${s.check.total} ingredients`);
  }
  if (s.recipe.favourite) out.push("One of your favourites");
  if (s.recipe.lastCookedOn) {
    const ago = daysBetween(s.recipe.lastCookedOn, today);
    if (ago >= 0 && ago <= 3) out.push(`Made ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}`);
  }
  return out.slice(0, 3);
}

export function kitchenToday(input: {
  recipes: RecipeSummary[];
  feedback: MealFeedback[];
  profiles: MemberProfile[];
  history: HistoryItem[];
  pantry: PantryItem[] | null;
  planned: PlannedMeal[];
  today: string;
}): KitchenToday {
  const { recipes, feedback, profiles, history, pantry, planned, today } = input;
  const taste = tasteByRecipe(feedback);
  const dinners = recipes.filter(isDinnerCandidate);
  const answer = recommend(parseAsk("What should we cook tonight?"), { recipes: dinners, pantry, taste, profiles, today });
  const soon = answer.soon;
  // A dinner the family said "not again" about, or one with an avoided ingredient, isn't put on the wall.
  const dinner = answer.ranked
    .filter((s) => !s.reasons.some((r) => r.source === "caution" && /said not again|avoids/.test(r.text)))
    .slice(0, 3)
    .map((suggestion) => ({ suggestion, why: shortWhy(suggestion, taste.get(suggestion.recipe.id), soon, today) }));

  const inStock = (pantry ?? []).filter((p) => p.onHand > 0);
  const weekAgo = new Date(`${today}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const since = weekAgo.toISOString().slice(0, 10);

  const favourites: Favourite[] = recipes.filter((r) => !r.removedAt).map((recipe) => {
    const t = taste.get(recipe.id);
    return { recipe, stars: t?.average != null ? ratingToStars(t.average) : null, ratedBy: t?.ratings.length ?? 0, wantAgain: t?.wouldMakeAgain ?? [] };
  }).filter((f) => f.recipe.favourite || (f.stars ?? 0) >= 3.5 || f.wantAgain.length > 0)
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.wantAgain.length - a.wantAgain.length || b.recipe.timesCooked - a.recipe.timesCooked || a.recipe.title.localeCompare(b.recipe.title));

  return {
    pantryConnected: pantry != null,
    dinner,
    planned,
    soon: pantry ? useSoon(pantry, today) : [],
    leftovers: pantry ? leftovers(pantry, recipes.map((r) => r.title)) : [],
    available: [...inStock].sort((a, b) => a.name.localeCompare(b.name)),
    low: (pantry ?? []).filter(isLow).sort((a, b) => a.onHand - b.onHand || a.name.localeCompare(b.name)),
    recentlyAdded: inStock.filter((p) => p.lastReceivedOn && p.lastReceivedOn >= since)
      .sort((a, b) => (b.lastReceivedOn ?? "").localeCompare(a.lastReceivedOn ?? "") || a.name.localeCompare(b.name)),
    favourites: favourites.slice(0, 6),
    recentlyCooked: history.slice(0, 5),
    taste,
  };
}

// A recipe's family record as Kitchen shows it: average stars, everyone's
// own latest rating, how often it's been made and when last.
export type FamilyRecord = {
  stars: number | null;
  people: { name: string; stars: number; again: "yes" | "maybe" | "no" | null; comment: string }[];
  timesCooked: number;
  lastCookedOn: string;
  favourite: boolean;
};

export function familyRecord(recipe: Pick<RecipeSummary, "id">, entries: { cookedOn: string }[], feedback: MealFeedback[], favourite: boolean): FamilyRecord {
  const mine = feedback.filter((f) => f.recipeId === recipe.id);
  const t = tasteByRecipe(mine).get(recipe.id);
  const latest = new Map<string, MealFeedback>();
  for (const f of [...mine].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))) {
    const k = (f.authorName.trim() || "Someone").toLowerCase();
    if (!latest.has(k)) latest.set(k, f);
  }
  const people = [...latest.values()].filter((f) => f.rating != null)
    .map((f) => ({ name: f.authorName.trim() || "Someone", stars: ratingToStars(f.rating as number), again: f.makeAgain, comment: f.comment.trim() }))
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  const dates = entries.map((e) => e.cookedOn).filter(Boolean).sort();
  return { stars: t?.average != null ? ratingToStars(t.average) : null, people, timesCooked: entries.length, lastCookedOn: dates[dates.length - 1] ?? "", favourite };
}
