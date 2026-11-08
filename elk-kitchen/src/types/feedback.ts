import type { PhotoRef } from "./recipe";

export type MakeAgain = "yes" | "maybe" | "no";

// Optional detail beside the overall rating, each 0–10 and each person's own.
// A score nobody gave stays null; it never counts as zero.
export type FeedbackScores = { flavour: number | null; seasoning: number | null; texture: number | null; juiciness: number | null };
export const SCORE_FIELDS: { key: keyof FeedbackScores; label: string }[] = [
  { key: "flavour", label: "Flavour" }, { key: "seasoning", label: "Seasoning" }, { key: "texture", label: "Texture" }, { key: "juiciness", label: "Juiciness" },
];
export const blankFeedbackScores = (): FeedbackScores => ({ flavour: null, seasoning: null, texture: null, juiciness: null });

// One person's say about one dinner (a cooking entry). Everyone who ate keeps
// their own; nobody edits anyone else's. Every edit keeps what was said before.
export type MealFeedback = {
  id: string;
  entryId: string;
  recipeId: string;
  // Shared mode: the name on the ELK family list (set by the database).
  // This device: the name typed when it was given.
  authorName: string;
  rating: number | null; // 0–10
  scores: FeedbackScores;
  comment: string;
  improvement: string;
  makeAgain: MakeAgain | null;
  photos: PhotoRef[];
  // Shared mode only: the detail scores couldn't be stored (the shared database
  // doesn't have kitchen.sql v6 yet). The overall rating and words were saved.
  scoresNotSaved?: boolean;
  // app = given in shared Kitchen; device-import = typed on a phone, brought in
  // from its backup (read-only); this-device = on this phone only.
  source: "app" | "device-import" | "this-device";
  version: number;
  history: FeedbackRevision[];
  createdAt: string;
  updatedAt: string;
  // The current person may change it.
  mine: boolean;
};

export type FeedbackRevision = {
  version: number;
  at: string;
  rating: number | null;
  scores?: FeedbackScores;
  comment: string;
  improvement: string;
  makeAgain: MakeAgain | null;
};

export type FeedbackInput = Pick<MealFeedback, "rating" | "comment" | "improvement" | "makeAgain" | "photos"> & {
  scores?: FeedbackScores;
  // Used on this device only (there's no sign-in to say who's speaking).
  authorName: string;
};

// Each person's own food notes. Written only by that person; never inferred.
export type MemberProfile = {
  // Shared: the user id. This device: the typed name, lower-cased.
  key: string;
  name: string;
  avoids: string;
  likes: string;
  notes: string;
  updatedAt: string;
  mine: boolean;
};

export type ProfileInput = Pick<MemberProfile, "name" | "avoids" | "likes" | "notes">;

// The v5 tables may not be in the shared database yet (kitchen.sql v4 only).
export type MemoryLoad<T> = { status: "ready"; items: T[] } | { status: "not-set-up" };
