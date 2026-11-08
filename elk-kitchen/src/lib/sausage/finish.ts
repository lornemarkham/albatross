// Finishing Sausage Day (M635). The cook was too busy to keep Kitchen up to
// date, so the day is closed afterwards from what the cook says was made.
//
// Closing keeps everything: the log, photos, timers, measurements, notes and
// cooking sessions are not touched. Ingredients are reconstructed only from
// what was actually recorded, and each line says how sure it is. A quantity
// nobody recorded stays blank; Kitchen never fills it in. The reconstruction is
// kept as `original` and every later correction is its own entry.

import type { CookingEntryInput, Recipe } from "../../types/recipe";
import type { Certainty, IngredientLine, MadeSausage, SausagePlan } from "../../types/sausage";
import { newId } from "../recipeModel";
import { dayOf, endDayTimer, exactKg, logEvent, recipePlanOf } from "./day";

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  known: "said by the cook",
  planned: "planned, not confirmed as used",
  card: "from the recipe card, not confirmed",
  estimate: "estimate",
  unknown: "amount not recorded",
};

const line = (name: string, amount: string, certainty: Certainty, source: string): IngredientLine => ({ id: newId(), name, amount, certainty, source });

const AMOUNT = /^(\d[\d.,/–-]*\s*(?:lbs?|kg|g|oz|ml|l|cups?|tsp|tbsp)?)\s+(.+)$/i;

// "5 lb pork tenderloin" → amount "5 lb", name "pork tenderloin". "Salt: 72 g" → "Salt", "72 g".
function cardLine(raw: string, source: string): IngredientLine | null {
  const t = raw.trim();
  if (!t) return null;
  const colon = t.match(/^([^:]+):\s*(.*)$/);
  if (colon) return line(colon[1].trim(), colon[2].trim(), colon[2].trim() ? "card" : "unknown", colon[2].trim() ? source : `${source} (no amount on the card)`);
  const m = t.match(AMOUNT);
  return m ? line(m[2].trim(), m[1].trim(), "card", source) : line(t, "", "unknown", `${source} (no amount on the card)`);
}

// What the cook said about this sausage, word for word, from the day's log.
function mentions(plan: SausagePlan, recipe: Recipe): string[] {
  const word = recipe.title.split(/\s+/)[0].toLowerCase();
  return dayOf(plan).log.filter((e) => e.recipeId === recipe.id || (word.length > 3 && e.text.toLowerCase().includes(word))).map((e) => e.text);
}

export function reconcile(plan: SausagePlan, recipe: Recipe, madeCount: number): IngredientLine[] {
  const inPlan = plan.recipeIds.includes(recipe.id) && Object.values(plan.alloc[recipe.id] ?? {}).some((g) => g > 0);
  if (inPlan) {
    const rp = recipePlanOf(plan, recipe);
    const shared = plan.recipeIds.length > madeCount;
    const why = shared ? "; the plan covered more recipes than were made and the real amounts weren't recorded" : "";
    const out: IngredientLine[] = rp.meats.map((m) => line(m.purchase.name, exactKg(m.g), "planned", `Approved plan, ${m.measured ? "from the weighed meat" : "meat weight estimated"}${why}`));
    for (const x of rp.seasonings.filter((s) => s.included)) {
      out.push(x.text
        ? line(x.s.name, x.text, "planned", `Scaled to the planned meat${x.tweak ? ` (${x.tweak.reason})` : ""}; not confirmed as weighed`)
        : line(x.s.name, "", "unknown", "No amount on the card"));
    }
    return out;
  }
  const source = "Recipe card";
  const out = [...recipe.ingredients.split("\n"), ...recipe.details.seasoning.split("\n")].map((l) => cardLine(l, source)).filter((x): x is IngredientLine => !!x);
  return out.length ? out : [line("Ingredients", "", "unknown", "Not recorded during the cook")];
}

export type MadeInput = { recipe: Recipe; count?: number | null; finishedG?: number | null };

// Closes the day: every named sausage is "made — awaiting tasting"; nothing is tasted or rated.
// The plan's other recipes are listed as not made and stay in the library.
export function completeDay(plan: SausagePlan, made: MadeInput[], now: string, by: string, closedSessionIds: string[] = []): SausagePlan {
  const d = dayOf(plan);
  if (d.completion) return plan;
  const madeOn = d.seed ?? now.slice(0, 10);
  const sausages: MadeSausage[] = made.map(({ recipe, count, finishedG }) => {
    const ingredients = reconcile(plan, recipe, made.length);
    const said = mentions(plan, recipe);
    const res = plan.results[recipe.id];
    return {
      recipeId: recipe.id, title: recipe.title, status: "made-awaiting-tasting", madeOn,
      count: count ?? res?.count ?? null, finishedG: finishedG ?? res?.finishedG ?? null,
      ingredients, original: ingredients, corrections: [],
      note: said.length ? `Recorded during the cook: ${said.join(" / ")}` : "Recorded after the cook. Nothing about this sausage was noted while cooking.",
      entryId: d.entries[recipe.id] ?? null,
    };
  });
  let next: SausagePlan = plan;
  for (const t of d.timers.filter((x) => !x.done && !x.cancelled)) next = endDayTimer(next, t.id, "cancelled", now);
  const madeIds = new Set(made.map((m) => m.recipe.id));
  const notMade = plan.recipeIds.filter((id) => !madeIds.has(id)).map((id) => ({ recipeId: id, title: id }));
  next = {
    ...next, updatedAt: now,
    day: { ...dayOf(next), awaiting: null, finishedAt: now, completion: { completedAt: now, completedBy: by, made: sausages, notMade, closedSessionIds } },
  };
  return logEvent(next, now, "celebrate", `Sausage Day completed${by ? ` by ${by}` : ""}: ${sausages.map((s) => s.title).join(", ")} — made, awaiting tasting.`, null);
}

// Fills the readable titles of the not-made recipes once the library is loaded.
export function withTitles(plan: SausagePlan, recipes: Recipe[]): SausagePlan {
  const c = dayOf(plan).completion;
  if (!c) return plan;
  return { ...plan, day: { ...dayOf(plan), completion: { ...c, notMade: c.notMade.map((n) => ({ ...n, title: recipes.find((r) => r.id === n.recipeId)?.title ?? n.title })) } } };
}

export function madeOf(plan: SausagePlan): MadeSausage[] {
  return dayOf(plan).completion?.made ?? [];
}

// The cook corrects an ingredient list. The reconstruction (`original`) is kept and the change is logged.
export function correctIngredients(plan: SausagePlan, recipeId: string, lines: IngredientLine[], by: string, now: string): SausagePlan {
  const d = dayOf(plan);
  const c = d.completion;
  const m = c?.made.find((x) => x.recipeId === recipeId);
  if (!c || !m) return plan;
  const after = lines.filter((l) => l.name.trim() || l.amount.trim()).map((l) => ({ ...l, name: l.name.trim(), amount: l.amount.trim() }));
  const made = c.made.map((x) => (x.recipeId === recipeId ? { ...x, ingredients: after, corrections: [...x.corrections, { at: now, by, before: x.ingredients, after }] } : x));
  const next: SausagePlan = { ...plan, updatedAt: now, day: { ...d, completion: { ...c, made } } };
  return logEvent(next, now, "note", `Ingredients for ${m.title} corrected${by ? ` by ${by}` : ""}.`, recipeId);
}

export function linkEntry(plan: SausagePlan, recipeId: string, entryId: string): SausagePlan {
  const d = dayOf(plan);
  const c = d.completion;
  if (!c) return plan;
  return { ...plan, day: { ...d, entries: { ...d.entries, [recipeId]: entryId }, completion: { ...c, made: c.made.map((x) => (x.recipeId === recipeId ? { ...x, entryId } : x)) } } };
}

export const lineText = (l: IngredientLine) => `${l.name}${l.amount ? `: ${l.amount}` : ""}${l.certainty === "known" ? "" : ` [${CERTAINTY_LABEL[l.certainty]}]`}`;

// The made sausage as a Kitchen cooking entry, so it has a place in cooking history and can be rated.
export function madeEntryInput(plan: SausagePlan, m: MadeSausage, by: string): CookingEntryInput {
  const d = dayOf(plan);
  const photos = d.photos.filter((x) => x.recipeId === m.recipeId).map((x) => ({ id: x.id, caption: x.caption || x.phase, addedAt: x.addedAt }));
  return {
    cookedOn: m.madeOn, cookName: by, ingredientsUsed: m.ingredients.map(lineText).join("\n"), substitutions: "", familyReaction: "", improveNextTime: "",
    notes: [`Made on ${plan.title}. Reconstructed afterwards: amounts marked as planned, from the card or not recorded were not measured during the cook.`, m.note].join("\n"),
    rating: null, photos, equipment: d.equipment.join("; "), timesAndTemps: "",
    yieldNote: [m.count ? `${m.count} sausages` : "", m.finishedG ? `${exactKg(m.finishedG)} finished` : ""].filter(Boolean).join(" · "),
    tastingNotes: "", details: { meatType: "", meatWeightG: null, fatPercent: null, seasoning: "", marinade: "", grinderPlate: "", casing: "", smokeTempC: null, cookTempC: null, internalTempC: null, finishedWeightG: m.finishedG },
    session: null,
  };
}
