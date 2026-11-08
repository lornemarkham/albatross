// What the family has said about its dinners, in a form suggestions can use.
// Only recorded words and numbers: nothing here guesses a taste (doctrine §4).

import type { FeedbackRevision, FeedbackScores, MakeAgain, MealFeedback, MemberProfile } from "../types/feedback";
import { normalizePhotos } from "./recipeModel";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const rating = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : null;
};
const makeAgain = (v: unknown): MakeAgain | null => (v === "yes" || v === "maybe" || v === "no" ? v : null);
export function scoresOf(v: unknown): FeedbackScores {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { flavour: rating(o.flavour), seasoning: rating(o.seasoning), texture: rating(o.texture), juiciness: rating(o.juiciness) };
}
export const hasScores = (s: FeedbackScores | undefined) => !!s && Object.values(s).some((v) => v != null);

function revisions(v: unknown): FeedbackRevision[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      version: Number(o.version) || 0, at: str(o.at), rating: rating(o.rating), ...(o.scores ? { scores: scoresOf(o.scores) } : {}), comment: str(o.comment),
      improvement: str(o.improvement), makeAgain: makeAgain(o.make_again ?? o.makeAgain),
    };
  });
}

// From a backup file or this phone's storage; anything unreadable is dropped.
export function normalizeFeedback(v: unknown): MealFeedback | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = str(o.id), entryId = str(o.entryId), recipeId = str(o.recipeId);
  if (!id || !entryId || !recipeId) return null;
  return {
    id, entryId, recipeId,
    authorName: str(o.authorName).slice(0, 60),
    rating: rating(o.rating),
    scores: scoresOf(o.scores),
    comment: str(o.comment), improvement: str(o.improvement), makeAgain: makeAgain(o.makeAgain),
    photos: normalizePhotos(o.photos, ""),
    source: o.source === "app" || o.source === "device-import" ? o.source : "this-device",
    version: Number(o.version) || 1,
    history: revisions(o.history),
    createdAt: str(o.createdAt), updatedAt: str(o.updatedAt),
    mine: o.mine === true,
  };
}

export const revisionsOf = revisions;
export const ratingOf = rating;
export const makeAgainOf = makeAgain;

export function normalizeProfile(v: unknown): MemberProfile | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const name = str(o.name).trim().slice(0, 60);
  const key = str(o.key) || name.toLowerCase();
  if (!key) return null;
  return { key, name, avoids: str(o.avoids), likes: str(o.likes), notes: str(o.notes), updatedAt: str(o.updatedAt), mine: o.mine === true };
}

// ── What the family thinks of a recipe ──────────────────────────────────────
export type RecipeTaste = {
  recipeId: string;
  // Each person's latest rating of this recipe (one dinner each, most recent).
  ratings: { name: string; rating: number }[];
  average: number | null;
  wouldMakeAgain: string[];
  wouldNot: string[];
  improvements: { name: string; text: string; on: string }[];
  comments: { name: string; text: string; on: string }[];
  // How many dinners have feedback.
  dinners: number;
};

const who = (f: MealFeedback) => f.authorName.trim() || "Someone";

export function tasteByRecipe(feedback: MealFeedback[]): Map<string, RecipeTaste> {
  const byRecipe = new Map<string, MealFeedback[]>();
  for (const f of feedback) byRecipe.set(f.recipeId, [...(byRecipe.get(f.recipeId) ?? []), f]);
  const out = new Map<string, RecipeTaste>();
  for (const [recipeId, list] of byRecipe) {
    const newestFirst = [...list].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    const latest = new Map<string, MealFeedback>();
    for (const f of newestFirst) if (!latest.has(who(f).toLowerCase())) latest.set(who(f).toLowerCase(), f);
    const people = [...latest.values()];
    const ratings = people.filter((f) => f.rating != null).map((f) => ({ name: who(f), rating: f.rating as number }));
    out.set(recipeId, {
      recipeId,
      ratings,
      average: ratings.length ? Math.round((ratings.reduce((n, r) => n + r.rating, 0) / ratings.length) * 10) / 10 : null,
      wouldMakeAgain: people.filter((f) => f.makeAgain === "yes").map(who),
      wouldNot: people.filter((f) => f.makeAgain === "no").map(who),
      improvements: newestFirst.filter((f) => f.improvement.trim()).map((f) => ({ name: who(f), text: f.improvement.trim(), on: f.createdAt.slice(0, 10) })),
      comments: newestFirst.filter((f) => f.comment.trim()).map((f) => ({ name: who(f), text: f.comment.trim(), on: f.createdAt.slice(0, 10) })),
      dinners: new Set(list.map((f) => f.entryId)).size,
    });
  }
  return out;
}

// "mushrooms, nuts; very spicy" → ["mushrooms", "nuts", "very spicy"]
export const avoidList = (p: MemberProfile) =>
  p.avoids.split(/[,;\n]|\band\b/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1);
