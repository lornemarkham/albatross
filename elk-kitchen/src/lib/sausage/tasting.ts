// Tasting cards for the sausages that were made (M635). Each person rates a
// sausage on their own, 1–10, and can save part of it and come back. Changing a
// card keeps what it said before.
//
// Kept on this device under its own key. Only the overall rating (with the
// comment, "change" and photos) is also given to Kitchen's dinner feedback, so
// the existing ratings, family view and AI suggestions see it. The seasoning /
// texture / juiciness scores need a shared-database column before they can be
// shared between phones; until then they are this phone's, and the page says so.

import type { PhotoRef } from "../../types/recipe";
import type { MakeAgain } from "../../types/feedback";
import type { MadeSausage, SausagePlan } from "../../types/sausage";
import { newId } from "../recipeModel";
import { dayOf } from "./day";

export const TASTINGS_KEY = "elk-kitchen-tastings-v1";
type KV = Pick<Storage, "getItem" | "setItem">;

export type Scores = { overall: number | null; seasoning: number | null; texture: number | null; juiciness: number | null };
export const SCORE_KEYS: { key: keyof Scores; label: string }[] = [
  { key: "overall", label: "Overall taste" }, { key: "seasoning", label: "Seasoning" }, { key: "texture", label: "Texture" }, { key: "juiciness", label: "Juiciness" },
];

export type TastingRevision = { version: number; at: string; scores: Scores; makeAgain: MakeAgain | null; change: string; notes: string };

export type Tasting = {
  id: string;
  planId: string;
  recipeId: string;
  author: string;
  scores: Scores;
  makeAgain: MakeAgain | null;
  change: string;
  notes: string;
  photos: PhotoRef[];
  status: "partial" | "complete";
  version: number;
  history: TastingRevision[];
  createdAt: string;
  updatedAt: string;
};

export type TastingInput = Pick<Tasting, "author" | "scores" | "makeAgain" | "change" | "notes" | "photos">;

const score = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);
const cleanScores = (s: Partial<Scores> | undefined): Scores => ({ overall: score(s?.overall), seasoning: score(s?.seasoning), texture: score(s?.texture), juiciness: score(s?.juiciness) });

export const isComplete = (t: Pick<Tasting, "scores" | "makeAgain">) => Object.values(t.scores).every((v) => v != null) && t.makeAgain != null;
export const blankScores = (): Scores => ({ overall: null, seasoning: null, texture: null, juiciness: null });

function normalize(raw: unknown): Tasting | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<Tasting>;
  if (typeof t.id !== "string" || typeof t.planId !== "string" || typeof t.recipeId !== "string" || typeof t.author !== "string") return null;
  const scores = cleanScores(t.scores);
  const makeAgain = t.makeAgain === "yes" || t.makeAgain === "maybe" || t.makeAgain === "no" ? t.makeAgain : null;
  return {
    id: t.id, planId: t.planId, recipeId: t.recipeId, author: t.author, scores, makeAgain, change: t.change ?? "", notes: t.notes ?? "",
    photos: Array.isArray(t.photos) ? t.photos : [], status: isComplete({ scores, makeAgain }) ? "complete" : "partial",
    version: typeof t.version === "number" ? t.version : 1, history: Array.isArray(t.history) ? t.history : [],
    createdAt: t.createdAt ?? "", updatedAt: t.updatedAt ?? t.createdAt ?? "",
  };
}

export class TastingStore {
  private storage: KV;
  private now: () => string;
  constructor(storage: KV, now: () => string = () => new Date().toISOString()) { this.storage = storage; this.now = now; }

  list(): Tasting[] {
    try {
      const v = JSON.parse(this.storage.getItem(TASTINGS_KEY) ?? "[]");
      return Array.isArray(v) ? v.map(normalize).filter((x): x is Tasting => !!x) : [];
    } catch {
      return [];
    }
  }
  forSausage(planId: string, recipeId: string): Tasting[] { return this.list().filter((t) => t.planId === planId && t.recipeId === recipeId); }
  forRecipe(recipeId: string): Tasting[] { return this.list().filter((t) => t.recipeId === recipeId); }

  private write(list: Tasting[]) {
    const previous = this.storage.getItem(TASTINGS_KEY);
    if (previous) { try { JSON.parse(previous); } catch { this.storage.setItem(`${TASTINGS_KEY}-unreadable-${this.now()}`, previous); } }
    this.storage.setItem(TASTINGS_KEY, JSON.stringify(list));
  }

  // Adds a person's card, or (with `base`) changes it; a card changed by someone else first is refused.
  save(planId: string, recipeId: string, input: TastingInput, base: Tasting | null): Tasting {
    const author = input.author.trim().slice(0, 60);
    if (!author) throw new Error("Say who is rating.");
    const all = this.list();
    const now = this.now();
    const fields = { scores: cleanScores(input.scores), makeAgain: input.makeAgain, change: input.change.trim(), notes: input.notes.trim(), photos: input.photos };
    const status = isComplete(fields) ? ("complete" as const) : ("partial" as const);
    if (base) {
      const i = all.findIndex((t) => t.id === base.id);
      if (i < 0) throw new Error("That tasting card isn't on this device any more.");
      const cur = all[i];
      if (cur.version !== base.version) throw new Error("This card was changed first — reload to see it.");
      const next: Tasting = {
        ...cur, ...fields, status, version: cur.version + 1, updatedAt: now,
        history: [...cur.history, { version: cur.version, at: cur.updatedAt, scores: cur.scores, makeAgain: cur.makeAgain, change: cur.change, notes: cur.notes }],
      };
      all[i] = next;
      this.write(all);
      return next;
    }
    if (all.some((t) => t.planId === planId && t.recipeId === recipeId && t.author.toLowerCase() === author.toLowerCase())) {
      throw new Error(`${author} already has a card for this sausage — change that one.`);
    }
    const t: Tasting = { id: newId(), planId, recipeId, author, ...fields, status, version: 1, history: [], createdAt: now, updatedAt: now };
    this.write([...all, t]);
    return t;
  }
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);

export type FamilyView = {
  people: { name: string; scores: Scores; makeAgain: MakeAgain | null; status: "partial" | "complete" | "rating-only" }[];
  // Averages are over the people who gave that score: nobody's missing score counts as zero.
  average: Scores;
  raters: number;
};

// Per-person cards plus the family average. `others` are overall ratings given elsewhere in
// Kitchen's dinner feedback (name, rating) for people with no card here; never invented.
export function familyView(tastings: Tasting[], others: { name: string; rating: number | null; makeAgain: MakeAgain | null }[] = []): FamilyView {
  const people: FamilyView["people"] = tastings.map((t) => ({ name: t.author, scores: t.scores, makeAgain: t.makeAgain, status: t.status }));
  const have = new Set(tastings.map((t) => t.author.trim().toLowerCase()));
  for (const o of others) {
    if (o.rating == null || have.has(o.name.trim().toLowerCase())) continue;
    have.add(o.name.trim().toLowerCase());
    people.push({ name: o.name || "Someone", scores: { ...blankScores(), overall: o.rating >= 1 && o.rating <= 10 ? o.rating : null }, makeAgain: o.makeAgain, status: "rating-only" });
  }
  const col = (k: keyof Scores) => avg(people.map((p) => p.scores[k]).filter((v): v is number => v != null));
  return { people, average: { overall: col("overall"), seasoning: col("seasoning"), texture: col("texture"), juiciness: col("juiciness") }, raters: people.filter((p) => p.scores.overall != null).length };
}

export type Stage = "planning" | "cooking" | "completed" | "tasting" | "rated";
export const STAGES: Stage[] = ["planning", "cooking", "completed", "tasting", "rated"];

// Planning → Cooking → Completed → Tasting → Rated. Rated = every sausage made has a finished card.
export function dayStage(plan: SausagePlan, tastings: Tasting[]): Stage {
  const c = dayOf(plan).completion;
  if (!c) return plan.status === "approved" || dayOf(plan).seed ? "cooking" : "planning";
  const mine = tastings.filter((t) => t.planId === plan.id);
  if (!mine.length) return "completed";
  return c.made.every((m) => mine.some((t) => t.recipeId === m.recipeId && t.status === "complete")) ? "rated" : "tasting";
}

export type SausageState = "awaiting" | "partial" | "rated";
export function sausageState(m: Pick<MadeSausage, "recipeId">, planId: string, tastings: Tasting[]): SausageState {
  const mine = tastings.filter((t) => t.planId === planId && t.recipeId === m.recipeId);
  if (!mine.length) return "awaiting";
  return mine.some((t) => t.status === "complete") ? "rated" : "partial";
}
