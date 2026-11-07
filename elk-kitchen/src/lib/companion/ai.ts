// The optional AI layer over Kitchen's own suggestions (docs/decisions/0001,
// PROPOSED). The model never sees anything but facts Kitchen already has, and
// it can only *choose and explain* among the family's recipes, or float an
// idea that is clearly labelled as AI's and never saved. Anything it says
// about stock is ignored: Pantry facts on the page always come from Pantry.
//
// Shared by the browser (building the request) and api/companion.ts (the
// prompt, the response schema and the checks on what comes back).

import type { Answer } from "./recommend";
import type { Ask } from "./ask";

export const AI_MAX_RECIPES = 40;

export type AiRequest = {
  question: string;
  heard: string[];
  // The family's recipes Kitchen ranked, best first, with the facts it found.
  recipes: { id: string; title: string; ingredients: string[]; facts: string[] }[];
  useSoon: string[];
  leftovers: string[];
  foodNotes: string[];
  pantryConnected: boolean;
};

export type AiPick = { recipeId: string; why: string };
export type AiIdea = { title: string; why: string; uses: string[]; alsoNeeds: string[] };
export type AiReply = { reply: string; picks: AiPick[]; ideas: AiIdea[]; followUps: string[] };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function aiRequestFrom(ask: Ask, answer: Answer, ranked: Answer["suggestions"], foodNotes: string[], heard: string[]): AiRequest {
  return {
    question: cut(ask.text, 500),
    heard,
    recipes: ranked.slice(0, AI_MAX_RECIPES).map((s) => ({
      id: s.recipe.id,
      title: cut(s.recipe.title, 120),
      ingredients: s.recipe.ingredients.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30).map((l) => cut(l, 80)),
      facts: s.reasons.map((r) => cut(`[${r.source}] ${r.text}`, 200)).slice(0, 10),
    })),
    useSoon: answer.soon.map((x) => `${x.item.name} (best before ${x.bestBefore})`).slice(0, 15),
    leftovers: answer.leftovers.map((p) => p.name).slice(0, 15),
    foodNotes: foodNotes.slice(0, 12).map((n) => cut(n, 200)),
    pantryConnected: answer.pantryConnected,
  };
}

export const AI_SYSTEM_PROMPT = `You are ELK Kitchen, a warm, practical family cooking companion. You help one household decide what to cook from ITS OWN recipes and food.

You are given: the person's question, the family's recipes (id, title, ingredient lines) each with FACTS Kitchen already verified, what Pantry says needs using soon, leftovers Pantry lists, and family members' own food notes.

Facts are tagged: [pantry] = ELK Pantry shows it; [said] = the person said it just now (NOT confirmed stock); [family] = a family member recorded it (ratings, "make it again", favourites); [caution] = something to check; [missing] = Pantry shows none or doesn't know.

Rules:
- Choose up to 3 of the given recipes that best answer the question, by id. Never invent a recipe id.
- "why" is one or two short, friendly sentences grounded ONLY in the given facts and the question. Never state a quantity, count, weight or date that isn't in the facts. Never claim the household has an ingredient unless a [pantry] fact says so; say "you mentioned" for [said].
- Never invent preferences, ratings or reactions. Only repeat what [family] facts say. If you infer something ("this might suit a cold night"), word it as a suggestion.
- Respect [caution] facts: don't pick a recipe that lists something a family member avoids unless you say so plainly.
- You may add up to 2 "ideas" that are NOT in the family's recipes, only if the given recipes don't answer the question well. They must use ingredients from [pantry] or [said] facts; list what else they'd need in alsoNeeds. Keep them simple and real dishes.
- "reply" is one or two sentences answering the question directly.
- "followUps" are up to 3 short things the person might ask next.
- Not a medical or allergy authority: never promise something is safe for an allergy.`;

export const AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    picks: { type: "array", items: { type: "object", properties: { recipeId: { type: "string" }, why: { type: "string" } }, required: ["recipeId", "why"], additionalProperties: false } },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, why: { type: "string" }, uses: { type: "array", items: { type: "string" } }, alsoNeeds: { type: "array", items: { type: "string" } } },
        required: ["title", "why", "uses", "alsoNeeds"], additionalProperties: false,
      },
    },
    followUps: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "picks", "ideas", "followUps"],
  additionalProperties: false,
} as const;

// Validate a request body arriving at the server (it comes from a browser).
export function parseAiRequest(v: unknown): AiRequest | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const strs = (x: unknown, n: number, len: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, n).map((s) => cut(s, len)) : []);
  if (typeof o.question !== "string" || !o.question.trim() || !Array.isArray(o.recipes)) return null;
  const recipes = o.recipes.slice(0, AI_MAX_RECIPES).flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    return typeof x.id === "string" && typeof x.title === "string"
      ? [{ id: cut(x.id, 140), title: cut(x.title, 120), ingredients: strs(x.ingredients, 30, 80), facts: strs(x.facts, 10, 200) }] : [];
  });
  return {
    question: cut(o.question, 500), heard: strs(o.heard, 12, 60), recipes,
    useSoon: strs(o.useSoon, 15, 120), leftovers: strs(o.leftovers, 15, 120), foodNotes: strs(o.foodNotes, 12, 200),
    pantryConnected: o.pantryConnected === true,
  };
}

// What the model sent back, kept only where it stays inside the rules we can check.
export function checkAiReply(raw: unknown, req: AiRequest): AiReply {
  const o = (raw ?? {}) as Record<string, unknown>;
  const ids = new Set(req.recipes.map((r) => r.id));
  const str = (x: unknown, n: number) => (typeof x === "string" ? cut(x.trim(), n) : "");
  const seen = new Set<string>();
  const picks = (Array.isArray(o.picks) ? o.picks : []).flatMap((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    const id = str(x.recipeId, 140);
    if (!ids.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ recipeId: id, why: str(x.why, 400) }];
  }).slice(0, 3);
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => cut(s.trim(), 60)).filter(Boolean).slice(0, 12) : []);
  const ideas = (Array.isArray(o.ideas) ? o.ideas : []).flatMap((i) => {
    const x = (i ?? {}) as Record<string, unknown>;
    const title = str(x.title, 100);
    return title ? [{ title, why: str(x.why, 400), uses: list(x.uses), alsoNeeds: list(x.alsoNeeds) }] : [];
  }).slice(0, 2);
  return { reply: str(o.reply, 500), picks, ideas, followUps: list(o.followUps).slice(0, 3) };
}

export type AiResult = { ok: true; reply: AiReply } | { ok: false; error: string; off?: boolean };

// Browser side: ask the family-only endpoint with the person's own sign-in token.
export async function askAi(req: AiRequest, token: string, fetchImpl: typeof fetch = fetch): Promise<AiResult> {
  try {
    const res = await fetchImpl("/api/companion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; reply?: unknown };
    if (res.status === 503) return { ok: false, off: true, error: body.error ?? "Kitchen's AI isn't switched on yet." };
    if (!res.ok) return { ok: false, error: body.error ?? `AI request failed (${res.status}).` };
    return { ok: true, reply: checkAiReply(body.reply, req) };
  } catch {
    return { ok: false, error: "Couldn't reach Kitchen's AI. Kitchen's own suggestions above still stand." };
  }
}
