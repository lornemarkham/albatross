// The reusable recipe: what you plan to make.
export type Recipe = {
  id: string;
  title: string;
  authorName: string;
  ingredients: string;
  instructions: string;
  notes: string;
  tags: string[];
  suggestedTags: string[];
  approxCalories: number | null;
  // Bumped on every save; an edit must name the version it started from.
  version: number;
  createdAt: string;
  updatedAt: string;
  // The original browser-only record, kept verbatim when imported.
  legacy?: unknown;
  // Set when someone used "Delete": hidden from the book, kept, and restorable.
  removedAt?: string | null;
};

// One occasion someone made a recipe: what actually happened.
export type CookingEntry = {
  id: string;
  recipeId: string;
  cookedOn: string; // YYYY-MM-DD, or "" when unknown
  cookName: string;
  ingredientsUsed: string;
  substitutions: string;
  familyReaction: string;
  improveNextTime: string;
  notes: string;
  rating: number | null;
  createdAt: string;
  // True when the current person recorded it (and so may remove it).
  mine: boolean;
};

export type RecipeInput = Pick<
  Recipe,
  "title" | "authorName" | "ingredients" | "instructions" | "notes" | "tags" | "suggestedTags" | "approxCalories"
>;

export type CookingEntryInput = Omit<CookingEntry, "id" | "recipeId" | "createdAt" | "mine">;

export type RecipeSummary = Recipe & {
  lastCookedOn: string;
  timesCooked: number;
  favourite: boolean;
};

export type RecipeDetail = {
  recipe: Recipe;
  entries: CookingEntry[];
  favourite: boolean;
  // Names of family members who marked it a favourite (shared mode only).
  favouriteOf: string[];
};

// ELK Kitchen before shared storage: one object mixed the recipe with a
// single cooking occasion. Only ever read (from localStorage or an export).
export type LegacyRecipe = {
  id: string;
  title: string;
  author: string;
  dateCooked: string;
  ingredients: string;
  notes: string;
  changes: string;
  improveNextTime: string;
  approxCalories: number;
  rating: number;
  tags: string[];
  suggestedTags?: string[];
};
