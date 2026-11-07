// Sausage Day, 7 November 2026: what Lorne bought, the four handwritten
// recipes and where the cook stood when Kitchen was told (M632 brief). Kitchen
// fills this in once on each phone so nobody types it again.
//
// The recipes are copied from the cards as written. The handwritten notes are
// kept word for word, and no amount on a card is changed here: "a little less
// salt" is shown beside the salt as a choice for the cook, and the cayenne the
// smokies note mentions has no amount, so Kitchen asks.

import type { Recipe, RecipeInput } from "../../types/recipe";
import type { Preferences, Purchase, SausagePlan } from "../../types/sausage";
import type { RecipeStore } from "../recipeStorage";
import { blankDetails } from "../meat";
import { normTitle } from "../recipeModel";
import { newPlan } from "./plan";
import { blankDay, logEvent } from "./day";
import type { PlanStore } from "./preferences";

export const TODAY_SEED = "2026-11-07";
export const SEED_PLAN_ID = "sausage-day-2026-11-07";

const LB = 453.592;
const PROCESS = [
  "Grind once, coarse, through the large plate. Keep the meat cold.",
  "Weigh the usable ground meat.",
  "Weigh the seasonings in grams.",
  "Mix each batch separately.",
  "Add the cold liquids.",
  "Mix until a proper bind develops (sticky, holds together).",
  "Cook a small sample and taste it.",
  "Adjust the seasoning if needed.",
  "Stuff into prepared casings, then link.",
  "Weigh the finished sausages. Cook, or refrigerate / freeze.",
].map((s, i) => `${i + 1}. ${s}`).join("\n");

function card(title: string, ingredients: string[], seasoning: string[], totalLb: number, notes: string): RecipeInput {
  return {
    title, authorName: "", ingredients: ingredients.join("\n"), instructions: PROCESS, notes, tags: ["sausage"], suggestedTags: [], approxCalories: null,
    kind: "sausage", category: "Sausage", photos: [],
    details: { ...blankDetails(), meatType: "", meatWeightG: Math.round(totalLb * LB), seasoning: seasoning.join("\n") },
  };
}

const FROM_CARD = "Typed from the family's handwritten card for Sausage Day, 7 November 2026.";

export const SEED_RECIPES: RecipeInput[] = [
  card("Breakfast Sausage", ["5 lb pork tenderloin", "3 lb pork belly", "1 lb chicken thigh"], [
    "Salt: 72 g", "Black pepper: 18 g", "Sage, dried: 14 g", "Thyme: 6 g", "Garlic powder: 10 g", "Onion powder: 10 g",
    "Brown sugar: 18 g", "Red pepper flakes: 3 g", "Maple syrup (optional): 120 ml",
  ], 9, `Handwritten note: "A little less salt."\n\n${FROM_CARD} Total meat on the card: 9 lb.`),
  card("Dinner Sausage", ["2 lb pork tenderloin", "0.5 lb pork belly", "1 lb chicken thigh", "1 lb beef"], [
    "Salt: 36 g", "Black pepper: 10 g", "Smoked paprika: 12 g", "Garlic powder: 8 g", "Onion powder: 8 g", "Chili powder: 6 g",
    "Cumin: 4 g", "Brown sugar: 15 g", "Worcestershire sauce: 30 ml", "Cheddar cubes (optional)",
  ], 4.5, `${FROM_CARD} Total meat on the card: 4.5 lb.`),
  card("Bratwurst", ["3.5 lb pork", "1 lb pork belly"], [
    "Salt: 35 g", "Black pepper: 9 g", "Garlic powder: 6 g", "Onion powder: 6 g", "Nutmeg: 3 g", "Marjoram: 3 g",
    "Mace (optional): 1 g", "Beer: 1/2 cup",
  ], 4.5, `${FROM_CARD} Total meat on the card: 4.5 lb.`),
  card("Smokies", ["1.5 lb chicken thigh", "2.10 lb beef", "1.9 lb pork belly"], [
    "Salt: 44 g", "Black pepper: 11 g", "Smoked paprika: 14 g", "Garlic powder: 9 g", "Onion powder: 9 g", "Mustard powder: 5 g",
    "Brown sugar: 18 g", "Worcestershire sauce: 35 ml", "Chili powder: 6 g", "Ice water: 80–100 ml",
  ], 5.5, `Handwritten notes:\nCayenne can be used for additional heat.\nOriginal cook used both chili and cayenne.\nIce water: 80–100 ml.\nCheese added near the end.\n\n${FROM_CARD} Total meat on the card: 5.5 lb.`),
];

export function seedPurchases(): Purchase[] {
  const p = (id: string, name: string, weightG: number, price: number, boneIn: boolean | null, skinOn: boolean | null): Purchase => ({
    id, name, weightG, price, currency: "CAD", purchasedOn: TODAY_SEED, bestBefore: null, boneIn, skinOn, usableG: null, fatPercent: null,
  });
  return [
    p("p-butt-1", "Pork butt #1", 3705, 31.45, null, null),
    p("p-butt-2", "Pork butt #2", 4928, 41.84, null, null),
    p("p-beef", "Beef eye of round", 4248, 88.87, null, null),
    p("p-chicken", "Chicken thighs, bone-in, skin-on", 2620, 32.2, true, true),
  ];
}

export const SEED_PREFS: Preferences = { grind: "coarse", plate: "large plate", seasoningsInGrams: true, goals: "One coarse grind through the large plate. Reproduce the family's handwritten recipes." };

const SAME: Record<string, RegExp> = {
  "breakfast sausage": /\bbreakfast\b/i, "dinner sausage": /\bdinner\b/i, bratwurst: /\bbrat/i, smokies: /\bsmok/i,
};

// A recipe already in the book under the same name (typed in by hand earlier) is used as it is.
export function findExisting(recipes: Recipe[], input: RecipeInput): Recipe | null {
  const t = normTitle(input.title);
  return recipes.find((r) => normTitle(r.title) === t)
    ?? recipes.find((r) => r.kind === "sausage" && SAME[t]?.test(r.title))
    ?? null;
}

export function seedPlan(recipeIds: string[], now: string, by: string): SausagePlan {
  const base = newPlan(now, "Sausage Day — 7 November 2026");
  const purchases = seedPurchases();
  let plan: SausagePlan = {
    ...base, id: SEED_PLAN_ID, purchases, recipeIds,
    day: {
      ...blankDay(TODAY_SEED),
      meat: { "p-butt-1": "ground", "p-butt-2": "ground", "p-beef": "unknown", "p-chicken": "grinding" },
      equipment: ["Meat grinder — large plate, one coarse grind", "Gram scale", "Sausage stuffer"],
    },
  };
  plan = logEvent(plan, now, "meat", "Pork butt (both) ground once through the large plate — done.", null);
  plan = logEvent(plan, now, "meat", "Chicken going through the grinder.", null);
  plan = logEvent(plan, now, "note", `Sausage Day started${by ? ` by ${by}` : ""}: 15.501 kg of meat for $194.36, four family recipes.`, null);
  return plan;
}

let seeding: Promise<SausagePlan> | null = null;

// Puts today's recipes in the book (only those not already there) and starts the day. Runs once per phone.
export function ensureSausageDay(store: RecipeStore, plans: PlanStore, now: string, by: string): Promise<SausagePlan> {
  const have = plans.get(SEED_PLAN_ID);
  if (have) return Promise.resolve(have);
  seeding ??= (async () => {
    try {
      const recipes = await store.listRecipes();
      const ids: string[] = [];
      for (const input of SEED_RECIPES) {
        const r = findExisting(recipes, input) ?? (await store.createRecipe(input));
        ids.push(r.id);
      }
      const again = plans.get(SEED_PLAN_ID);
      if (again) return again;
      const plan = seedPlan(ids, now, by);
      plans.put(plan);
      return plan;
    } finally {
      seeding = null;
    }
  })();
  return seeding;
}
