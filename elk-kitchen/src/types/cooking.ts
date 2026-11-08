import type { BatchPlan } from "./sausage";

// A cooking session: what happened while someone cooked, as it happened.
// Kitchen owns it. It is saved inside the batch (cooking entry) it produces,
// so it shares that record's storage, backups and family-only rules.
//
// The transcript is the original: what was heard or typed, never edited.
// Everything else (ingredients, notes, temperatures) is derived from it and
// can be corrected, but every change is kept as its own event.

export type Qty = { value: number; unit: string }; // unit: "g", "kg", "lb", "oz", "ml", "l", "tsp", "tbsp", "cup", "%" or a free word ("cloves")

export type TranscriptLine = {
  id: string;
  at: string; // ISO time
  text: string; // exactly as heard or typed
  source: "voice" | "typed";
  // What Kitchen understood, in words ("Added salt 40 g"), for review.
  understood: string;
};

export type IngredientChange = {
  at: string;
  qty: Qty | null;
  why: "said" | "corrected" | "edited" | "added-more" | "removed";
  lineId: string | null; // the transcript line that caused it, if spoken/typed
};

export type SessionIngredient = {
  id: string;
  name: string;
  qty: Qty | null;
  removed: boolean;
  history: IngredientChange[];
};

export type NoteCategory = "observation" | "next-time" | "tasting" | "equipment" | "substitution";

export type TempUnit = "C" | "F";
export type TempWhat = "internal" | "smoker" | "oven" | "water" | "grill" | "fridge" | "other";

export type MediaRef = {
  id: string; // key in the photo/media store
  type: "photo" | "video" | "voice";
  mime: string;
  caption: string;
  addedAt: string;
  finished: boolean; // a photo/clip of the finished product
};

export type SessionEvent =
  | { id: string; at: string; kind: "ingredient"; ingredientId: string; name: string; action: IngredientChange["why"]; before: Qty | null; after: Qty | null; lineId: string | null }
  | { id: string; at: string; kind: "note"; category: NoteCategory; text: string; lineId: string | null }
  | { id: string; at: string; kind: "temperature"; what: TempWhat; value: number; unit: TempUnit; lineId: string | null }
  | { id: string; at: string; kind: "timer"; timerId: string; label: string; seconds: number; action: "started" | "done" | "cancelled" }
  | { id: string; at: string; kind: "media"; media: MediaRef }
  | { id: string; at: string; kind: "pantry"; action: PantryAction }
  | { id: string; at: string; kind: "started" | "finished" };

export type Timer = { id: string; label: string; seconds: number; endsAt: string; done: boolean; cancelled: boolean };

// A spoken instruction Kitchen wasn't sure about. Nothing is applied until
// the person says yes (or taps Yes).
export type Pending = {
  id: string;
  lineId: string;
  question: string;
  // What happens on "yes". On "no", nothing.
  onYes: PendingAction;
  // Optional alternative on "no" (e.g. the other temperature unit).
  onNo: PendingAction | null;
};

export type PendingAction =
  | { kind: "set-ingredient"; ingredientId: string | null; name: string; qty: Qty; why: IngredientChange["why"] }
  | { kind: "temperature"; what: TempWhat; value: number; unit: TempUnit }
  | { kind: "none"; reply: string };

// A stock change made in ELK Inventory through its own pantry_* functions,
// after the person confirmed it. Kitchen keeps only this receipt; Inventory
// keeps the stock, lots and movements.
export type PantryAction = {
  requestId: string; // also Inventory's movement batch id (pass to pantry_undo)
  kind: "used" | "received";
  itemId: string;
  itemName: string;
  lotId: string | null;
  lotLabel: string; // e.g. "Freezer · best before 2026-12-01"
  quantity: number;
  unit: string;
  at: string;
  bestBefore: string | null;
  location: string;
  undone: boolean;
  undoBatchId: string | null;
};

export type CookDraft = {
  origin: "ai" | "kitchen-idea";
  title: string;
  // What the person asked, word for word.
  question: string;
  // Amounts are the idea's, for the dish — not Pantry quantities.
  ingredients: { name: string; amount: string; status: "have" | "need" | "optional" | "basic"; evidence: string }[];
  steps: string[];
  safety: string[];
  why: string[];
  model: string;
  createdAt: string;
};

export type CookingSession = {
  format: 1;
  id: string;
  recipeId: string | null; // null: a new cook that isn't a recipe yet
  recipeTitle: string;
  cookName: string;
  startedAt: string;
  endedAt: string | null;
  transcript: TranscriptLine[];
  events: SessionEvent[];
  ingredients: SessionIngredient[];
  timers: Timer[];
  pending: Pending[];
  stepIndex: number;
  // The ingredient "that" refers to in "change that to 35 grams".
  lastIngredientId: string | null;
  lastReply: string;
  // After "make a note for next time" with nothing else: the next thing said is the note.
  awaitingNote: NoteCategory | null;
  // Set once the session has been saved as a batch.
  savedEntryId: string | null;
  // Sausage day: the approved adaptation this cook follows (the recipe itself is unchanged).
  plan?: BatchPlan | null;
  // Cooking an idea from Kitchen's chef that isn't a family recipe yet (an AI-generated
  // recipe, or one of Kitchen's own idea templates). Kept exactly as suggested; it
  // becomes a recipe only when the cook saves it on the review screen.
  draft?: CookDraft | null;
  // "Finished grinding the pork", "now grinding the chicken", in order.
  stageLog?: { at: string; stage: string; subject: string; action: "started" | "finished" }[];
};
