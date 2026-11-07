// Sausage day: cook several recipes from the meat you bought.
//
// A plan is Kitchen's own working record, kept on this device. It never
// changes a recipe: the original stays as written, and what was adapted for
// today (which meat, how much, the seasonings for the real weight) is kept on
// the plan and, once approved, copied into each cook's session and batch.
// Stock stays with ELK Pantry.

export type Purchase = {
  id: string;
  name: string;
  weightG: number | null; // as bought (label weight); null = not given
  price: number | null; // what was paid for this package
  currency: string;
  purchasedOn: string | null;
  bestBefore: string | null;
  boneIn: boolean | null; // null = not said
  skinOn: boolean | null;
  usableG: number | null; // weighed after trimming / boning; replaces the estimate
  fatPercent: number | null; // typed by the person; replaces the cut's typical figure
};

// How much of each seasoning goes in per kilogram of meat.
export type Seasoning = {
  name: string;
  raw: string; // the recipe's own line, word for word
  basis: "percent" | "per-kg" | "scaled" | "volume" | "count" | "none";
  gPerKg: number | null;
  perKg: { value: number; unit: string } | null; // volume or count amounts, scaled as written
  from: "seasoning" | "ingredients";
  cure: boolean;
};

export type SausageKind = "fresh" | "smoked" | "cured" | "fermented";

export type Preferences = {
  grind: "" | "coarse" | "medium" | "fine";
  plate: string; // e.g. "large plate (10 mm)"
  seasoningsInGrams: boolean;
  goals: string; // "reproduce and improve old recipes"
};

// The approved adaptation for one recipe, copied into its cooking session.
export type BatchPlan = {
  planId: string;
  planTitle: string;
  recipeId: string;
  recipeTitle: string;
  recipeVersion: number;
  approvedAt: string;
  approvedBy: string;
  meats: { name: string; plannedG: number; fatPercent: number; fatEstimated: boolean; measured: boolean; costPerKg: number | null }[];
  plannedMeatG: number;
  fatPercent: number | null;
  fatTarget: number | null;
  seasonings: Seasoning[];
  substitutions: string[];
  safety: string[];
  kind: SausageKind;
  poultry: boolean;
  meatCost: number | null;
  currency: string;
  prefs: Preferences;
};

export type BatchResult = { finishedG: number | null; count: number | null; servings: number | null };

export type SausagePlan = {
  format: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  purchases: Purchase[];
  recipeIds: string[];
  // grams of usable meat: alloc[recipeId][purchaseId]
  alloc: Record<string, Record<string, number>>;
  status: "draft" | "approved";
  approvedAt: string | null;
  approvedBy: string;
  // Needed items the cook ticked as "have it".
  have: string[];
  results: Record<string, BatchResult>;
  // The cooking session started for each recipe.
  sessions: Record<string, string>;
  snapshots: Record<string, BatchPlan>;
};
