// Putting the finish into Kitchen's records (M635): the recipes of the sausages
// that were made, the closed cooking sessions, the completed day and a cooking
// entry for each sausage. Nothing is deleted or overwritten; a recipe that is
// already in the book is used as it is, and a missing one is added with its
// ingredients blank rather than invented.

import type { Recipe, RecipeInput } from "../../types/recipe";
import type { SausagePlan } from "../../types/sausage";
import type { SessionDrafts } from "../cooking/drafts";
import { finish as finishSession } from "../cooking/session";
import { blankDetails } from "../meat";
import type { RecipeStore } from "../recipeStorage";
import { dayOf } from "./day";
import { completeDay, linkEntry, madeEntryInput, madeOf, withTitles, type MadeInput } from "./finish";
import type { PlanStore } from "./preferences";
import type { Tasting } from "./tasting";
import { findExisting } from "./today";

export type Pick = { recipeId?: string; title: string; count?: number | null };

const bareRecipe = (title: string): RecipeInput => ({
  title, authorName: "", ingredients: "", instructions: "", tags: ["sausage"], suggestedTags: [], approxCalories: null, kind: "sausage", category: "Sausage", photos: [],
  notes: "Made on Sausage Day, 7 November 2026. Added afterwards: no card or amounts were recorded while cooking. Add the ingredients when you remember them.",
  details: blankDetails(),
});

export async function finishSausageDay(store: RecipeStore, plans: PlanStore, drafts: SessionDrafts, plan: SausagePlan, picks: Pick[], now: string, by: string): Promise<SausagePlan> {
  if (dayOf(plan).completion) return plan;
  if (!picks.length) throw new Error("Pick at least one sausage that was made.");
  const library = (await store.listRecipes()) as Recipe[];
  const made: MadeInput[] = [];
  for (const p of picks) {
    const have = (p.recipeId ? library.find((r) => r.id === p.recipeId) : null) ?? findExisting(library, bareRecipe(p.title));
    const recipe = have ?? (await store.createRecipe(bareRecipe(p.title.trim())));
    if (!made.some((m) => m.recipe.id === recipe.id)) made.push({ recipe, count: p.count });
  }
  // Close the cooking sessions that belong to this day. They keep every event, timer, photo and note.
  const ids = new Set(Object.values(plan.sessions));
  const closed: string[] = [];
  for (const s of drafts.list()) {
    if ((ids.has(s.id) || (s.plan && s.plan.planId === plan.id)) && !s.endedAt) { drafts.put(finishSession(s, now)); closed.push(s.id); }
  }
  let next = withTitles(completeDay(plan, made, now, by, closed), [...library, ...made.map((m) => m.recipe)]);
  plans.put(next);
  for (const m of madeOf(next)) {
    if (m.entryId) continue;
    const entry = await store.addCookingEntry(m.recipeId, madeEntryInput(next, m, by));
    next = linkEntry(next, m.recipeId, entry.id);
    plans.put(next);
  }
  return next;
}

// A made sausage's cooking entry, made now if finishing didn't get that far.
export async function ensureEntry(store: RecipeStore, plans: PlanStore, plan: SausagePlan, recipeId: string, by: string): Promise<{ plan: SausagePlan; entryId: string }> {
  const m = madeOf(plan).find((x) => x.recipeId === recipeId);
  if (!m) throw new Error("That sausage isn't on this Sausage Day.");
  if (m.entryId) return { plan, entryId: m.entryId };
  const entry = await store.addCookingEntry(recipeId, madeEntryInput(plan, m, by));
  const next = linkEntry(plan, recipeId, entry.id);
  plans.put(next);
  return { plan: next, entryId: entry.id };
}

// Gives the overall rating, comment, "what to change" and photos of a tasting card to Kitchen's dinner
// feedback (so existing ratings, family views and suggestions see it). Needs an overall rating.
// The person's earlier feedback on this dinner is changed, not duplicated.
export async function mirrorToFeedback(store: RecipeStore, entryId: string, t: Tasting): Promise<void> {
  if (t.scores.overall == null) return;
  const fb = await store.listFeedback();
  if (fb.status !== "ready") return;
  const mine = fb.items.find((f) => f.entryId === entryId && (store.mode === "family" ? f.mine : f.authorName.trim().toLowerCase() === t.author.trim().toLowerCase()));
  await store.saveFeedback(entryId, { authorName: t.author, rating: t.scores.overall, comment: t.notes, improvement: t.change, makeAgain: t.makeAgain, photos: t.photos }, mine ?? null);
}
