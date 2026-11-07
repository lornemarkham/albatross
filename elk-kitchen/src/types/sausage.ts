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
  // "Maple syrup (optional): 120 ml": the cook decides on the day.
  optional?: boolean;
  // "Ice water: 80–100 ml": the top of a written range, per kg like gPerKg / perKg.
  rangeHi?: number | null;
};

// A change the cook chose for today's batch. The recipe keeps its own amount;
// this is shown beside it. `percent` scales the recipe's amount (-10 = 10%
// less); `grams` is an exact amount the cook gave for this batch (e.g. the
// cayenne a note mentions without a quantity).
export type SeasoningTweak = { name: string; percent: number | null; grams: number | null; reason: string; by: string; at: string };

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
  tweaks?: SeasoningTweak[];
  // Optional seasonings left out today (lower-case names).
  excluded?: string[];
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
  // The live sausage day (M632). Absent on plans made before it.
  day?: SausageDay;
};

// ── The live sausage day ─────────────────────────────────────────────────────

export type MeatStatus = "unknown" | "grinding" | "ground" | "not-using";

// The day's steps, in order. "day" steps happen once; "batch" steps once per recipe.
export type DayStepKey =
  | "grind" | "weigh" | "allocate" | "approve"
  | "weigh-seasonings" | "mix" | "liquids" | "bind" | "sample" | "adjust" | "casings" | "stuff" | "link"
  | "finished-weight" | "store" | "photo" | "ratings";

export type DayEvent = {
  id: string;
  at: string;
  kind: "said" | "step" | "meat" | "weight" | "plan" | "adjust" | "photo" | "timer" | "result" | "note" | "celebrate";
  text: string;
  recipeId: string | null;
};

// What the assistant asked and is waiting on. Nothing is applied on a guess:
// "yes" applies `onYes`; anything else leaves it.
export type DayAwaiting =
  | { kind: "usable"; purchaseIds: string[]; label: string }
  | { kind: "divide" }
  | { kind: "approve" }
  | { kind: "tweak"; recipeId: string; tweak: SeasoningTweak }
  | { kind: "tweak-amount"; recipeId: string; name: string; reason: string }
  | { kind: "cayenne"; recipeId: string };

export type DayPhoto = { id: string; caption: string; addedAt: string; phase: "before" | "during" | "after"; recipeId: string | null };

export type DayTimer = { id: string; label: string; seconds: number; endsAt: string; done: boolean; cancelled: boolean };

export type SausageDay = {
  // Which pre-filled day this is (e.g. "2026-11-07"), or null for one started by hand.
  seed: string | null;
  meat: Record<string, MeatStatus>; // by purchase id
  equipment: string[];
  // How big a share of each original recipe to make (1 = as written). Null until chosen.
  scale: number | null;
  done: Record<string, DayStepKey[]>; // by recipe id ("" = day-level steps ticked by hand)
  tweaks: Record<string, SeasoningTweak[]>; // by recipe id
  optional: Record<string, Record<string, boolean>>; // recipe id → optional seasoning (lower-case) → used today
  storage: Record<string, "fridge" | "freezer" | "cooked" | "">;
  photos: DayPhoto[];
  timers: DayTimer[];
  log: DayEvent[];
  awaiting: DayAwaiting | null;
  // The Kitchen batch (cooking entry) each recipe was saved as.
  entries: Record<string, string>;
  lastReply: string;
  finishedAt: string | null;
};
