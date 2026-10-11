// Nutrition with provenance. Every value says where it came from; a value
// nobody knows is shown as "not known yet", never filled in (doctrine §6).
//
// Today the only nutrition in Kitchen is a recipe's `approxCalories`: one
// number, typed in or imported, source not recorded (doctrine C2). Samples
// have none at all, because no nutrition source has been chosen (Q2).

import type { Recipe } from "../../types/recipe";
import type { Provenance } from "./types";

export type NutrientKey = "calories" | "protein" | "carbs" | "fat" | "fibre";

export const NUTRIENTS: { key: NutrientKey; label: string; unit: string }[] = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbohydrates", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "fibre", label: "Fibre", unit: "g" },
];

export type NutrientValue = {
  amount: number;
  provenance: Extract<Provenance, "entered" | "verified" | "estimated">;
  source: string;        // shown to the person: "Entered in the recipe", "USDA FoodData Central", …
};

export type Nutrition = {
  perServing: Partial<Record<NutrientKey, NutrientValue>>;
  // Whether "per serving" is actually known; a typed calorie number has no
  // stated serving size.
  servingKnown: boolean;
};

export const PROVENANCE_LABEL: Record<NutrientValue["provenance"], { short: string; long: string }> = {
  verified: { short: "Verified", long: "From a named nutrition database, matched to each ingredient." },
  estimated: { short: "Estimate", long: "Calculated or matched by AI. Shown with ~ and never treated as exact." },
  entered: { short: "Typed in", long: "Someone entered this on the recipe. Where it came from wasn't recorded." },
};

export function nutritionForSaved(recipe: Pick<Recipe, "approxCalories">): Nutrition {
  return {
    perServing: recipe.approxCalories != null
      ? { calories: { amount: recipe.approxCalories, provenance: "entered", source: "Entered on the recipe (“approx”)" } }
      : {},
    servingKnown: false,
  };
}

export function nutritionForSample(): Nutrition {
  return { perServing: {}, servingKnown: true };
}

export function formatNutrient(v: NutrientValue, unit: string): string {
  const n = unit === "kcal" ? Math.round(v.amount) : Math.round(v.amount * 10) / 10;
  return `${v.provenance === "verified" ? "" : "~"}${n} ${unit}`;
}
