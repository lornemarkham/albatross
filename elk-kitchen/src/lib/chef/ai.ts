// Kitchen's AI chef (docs/decisions/0002, PROPOSED; builds on 0001). A real
// cooking conversation over the household's own evidence:
//
//   - The browser sends what Kitchen's rules already know (chef.ts): every food
//     with its source and evidence, use-soon and past-date items, the family's
//     recipes (by id) with their facts, each person's recorded tastes, the
//     constraints heard, and the last few turns of the conversation.
//   - The model answers with picks among the family's recipes (by id) and up to
//     3 new recipes, each ingredient marked have / need.
//   - The server (and the browser again) keeps "have" only where Kitchen holds
//     evidence for that food. Anything else becomes "need". Unknown recipe ids
//     are dropped. Pantry counts on the page always come from Pantry, never
//     from the model. Generated recipes are labelled and saved only if a person
//     cooks one and saves it on the review screen.
//
// Shared by the browser and api/companion.ts.

import { mentions } from "../pantryCheck";
import type { ChefAnswer, ChefTurn } from "./chef";
import { safetyFor, type Idea, type IdeaIngredient } from "./ideas";

export const CHEF_MAX_HAVE = 80;
export const CHEF_MAX_RECIPES = 25;

export type ChefAiRequest = {
  mode: "chef";
  question: string;
  conversation: ChefTurn[];
  occasion: string | null;
  constraints: string[];
  // Every food Kitchen has evidence for. `source`: inventory | recent | said.
  have: { name: string; source: "inventory" | "recent" | "said"; evidence: string; useSoon: boolean }[];
  expired: string[];
  familyRecipes: { id: string; title: string; ingredients: string[]; facts: string[] }[];
  family: string[];
  kitchenIdeas: string[];
  pantryConnected: boolean;
};

export type ChefAiRecipe = {
  title: string; why: string; minutes: number; serves: string;
  ingredients: { name: string; amount: string; have: boolean }[];
  steps: string[]; tips: string[];
};
export type ChefAiReply = { reply: string; picks: { recipeId: string; why: string }[]; recipes: ChefAiRecipe[]; followUps: string[] };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const BASIC = /^(salt|pepper|black pepper|salt and pepper|water|ice|oil|olive oil|vegetable oil|cooking oil|canola oil|cooking spray)$/i;

export function chefRequestFrom(a: ChefAnswer, question: string, conversation: ChefTurn[], familyFacts: string[]): ChefAiRequest {
  const k = a.knowledge;
  const soon = new Set(k.useSoon.map((h) => h.name));
  const constraints = [
    ...a.ask.diet.map((d) => `diet: ${d}`),
    ...a.ask.avoid.map((x) => `no ${x}`),
    a.ask.minutes ? `about ${a.ask.minutes} minutes` : a.ask.quick ? "quick" : "",
    a.ask.people ? `for ${a.ask.people} people` : "",
    a.ask.meal ? a.ask.meal : "",
    a.snack ? "snacks / sharing food" : "",
  ].filter(Boolean);
  return {
    mode: "chef",
    question: cut(question, 600),
    conversation: conversation.slice(-6).map((t) => ({ role: t.role, text: cut(t.text, 600) })),
    occasion: a.occasion,
    constraints,
    have: k.have.filter((h) => !h.expired).slice(0, CHEF_MAX_HAVE).map((h) => ({ name: cut(h.name, 80), source: h.source, evidence: cut(h.evidence, 160), useSoon: soon.has(h.name) })),
    expired: k.expired.map((h) => cut(`${h.name} (${h.evidence})`, 160)).slice(0, 15),
    familyRecipes: [...a.family, ...a.familyPool].filter((s, i, xs) => xs.findIndex((x) => x.recipe.id === s.recipe.id) === i).slice(0, CHEF_MAX_RECIPES).map((s) => ({
      id: s.recipe.id, title: cut(s.recipe.title, 120),
      ingredients: s.recipe.ingredients.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 25).map((l) => cut(l, 80)),
      facts: s.reasons.map((r) => cut(`[${r.source}] ${r.text}`, 200)).slice(0, 8),
    })),
    family: familyFacts.slice(0, 30).map((f) => cut(f, 240)),
    kitchenIdeas: a.ideas.map((i) => i.title).slice(0, 6),
    pantryConnected: k.pantryConnected,
  };
}

export const CHEF_SYSTEM_PROMPT = `You are ELK Kitchen's chef: a warm, inventive, practical cook helping ONE family decide what to make from the food they actually have, then cook it.

You receive JSON: the person's latest message, the last few turns, the occasion, constraints, HAVE (every food Kitchen has evidence for, each with source and evidence), EXPIRED items, the family's own recipes (id, title, ingredients, facts), FAMILY (what named family members recorded: ratings, "not again", food notes, seasoning comments), and Kitchen's own rule-based idea titles.

Sources in HAVE: "inventory" = ELK Inventory shows it (its count is in the evidence). "recent" = Kitchen's cooking record says it was made recently (not a count of what's left). "said" = the person said so in this conversation (not confirmed stock).

Rules — follow all of them:
1. Answer what was asked. Suggest genuinely good, specific dishes that fit the occasion, time and constraints. Be creative; don't just repeat the family recipe that made an ingredient (e.g. if they made bratwurst, suggest dishes USING the bratwurst).
2. Up to 3 "picks" from the family's recipes, by exact id, only if they truly fit. Never invent an id.
3. Up to 3 new "recipes". Each ingredient has an amount for the dish and have=true ONLY if that food is in HAVE. Everything else has have=false. Never say the household has something that isn't in HAVE. Never state a stock count, weight or date that isn't in HAVE's evidence.
4. Never use EXPIRED items as ingredients.
5. Prefer foods marked useSoon and "recent" leftovers. Use as few missing ingredients as possible, and say what's missing in "why".
6. Respect FAMILY facts: don't build around something a named person avoids without saying so; use seasoning comments ("wants less salt") when relevant and name the person. Never invent ratings or preferences; word inferences as suggestions.
7. Food safety: homemade sausage is raw unless HAVE says it's cooked — cook to 71 °C / 160 °F (74 °C / 165 °F with poultry). Put it in "tips" when it applies. You are not an allergy or medical authority.
8. Steps: short, numbered-style sentences a home cook can follow by voice (no numbers needed). 3–8 steps.
9. "reply": 1–3 friendly sentences that directly answer, and mention what you're using. "followUps": up to 3 short next questions the person might ask.`;

const STR = { type: "string" } as const;
export const CHEF_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: STR,
    picks: { type: "array", items: { type: "object", properties: { recipeId: STR, why: STR }, required: ["recipeId", "why"], additionalProperties: false } },
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: STR, why: STR, minutes: { type: "number" }, serves: STR,
          ingredients: { type: "array", items: { type: "object", properties: { name: STR, amount: STR, have: { type: "boolean" } }, required: ["name", "amount", "have"], additionalProperties: false } },
          steps: { type: "array", items: STR }, tips: { type: "array", items: STR },
        },
        required: ["title", "why", "minutes", "serves", "ingredients", "steps", "tips"], additionalProperties: false,
      },
    },
    followUps: { type: "array", items: STR },
  },
  required: ["reply", "picks", "recipes", "followUps"],
  additionalProperties: false,
} as const;

// A request body arriving at the server comes from a browser: re-check every field.
export function parseChefRequest(v: unknown): ChefAiRequest | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.mode !== "chef" || typeof o.question !== "string" || !o.question.trim()) return null;
  const strs = (x: unknown, n: number, len: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, n).map((s) => cut(s, len)) : []);
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    mode: "chef",
    question: cut(o.question, 600),
    conversation: arr(o.conversation).slice(-6).flatMap((t) => {
      const x = (t ?? {}) as Record<string, unknown>;
      return (x.role === "you" || x.role === "kitchen") && typeof x.text === "string" ? [{ role: x.role, text: cut(x.text, 600) }] : [];
    }),
    occasion: typeof o.occasion === "string" ? cut(o.occasion, 40) : null,
    constraints: strs(o.constraints, 12, 80),
    have: arr(o.have).slice(0, CHEF_MAX_HAVE).flatMap((h) => {
      const x = (h ?? {}) as Record<string, unknown>;
      const source = x.source === "inventory" || x.source === "recent" || x.source === "said" ? x.source : null;
      return typeof x.name === "string" && x.name.trim() && source ? [{ name: cut(x.name, 80), source, evidence: typeof x.evidence === "string" ? cut(x.evidence, 160) : "", useSoon: x.useSoon === true }] : [];
    }),
    expired: strs(o.expired, 15, 160),
    familyRecipes: arr(o.familyRecipes).slice(0, CHEF_MAX_RECIPES).flatMap((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      return typeof x.id === "string" && typeof x.title === "string" ? [{ id: cut(x.id, 140), title: cut(x.title, 120), ingredients: strs(x.ingredients, 25, 80), facts: strs(x.facts, 8, 200) }] : [];
    }),
    family: strs(o.family, 30, 240),
    kitchenIdeas: strs(o.kitchenIdeas, 6, 100),
    pantryConnected: o.pantryConnected === true,
  };
}

// Words that describe how a food is prepared, not which food it is: "shredded cheese" is the
// household's cheese, but "cream cheese" is not.
const PREP = /\b(shredded|grated|sliced|diced|chopped|minced|crumbled|cubed|fresh|cooked|leftover|homemade|home-made|sharp|mild|old|aged|crushed|warm|cold|cooled|melted|softened|halved|quartered|thinly|finely|roughly|large|small|medium|bag of|of|the|your|some)\b/gi;
const bare = (s: string) => s.replace(/\(.*?\)/g, " ").replace(PREP, " ").replace(/\s+/g, " ").trim();

// Is there evidence for this food? One direction, like knowledge.findHave: the household's
// "Cheddar cheese" is cheese; their "cheese" is not cream cheese.
export function evidenceFor(name: string, req: Pick<ChefAiRequest, "have">): ChefAiRequest["have"][number] | null {
  const n = bare(name);
  if (!n) return null;
  return req.have.find((h) => bare(h.name).toLowerCase() === n.toLowerCase())
    ?? req.have.find((h) => mentions(h.name, n))
    ?? null;
}

// What the model sent back, kept only within rules Kitchen can check.
export function checkChefReply(raw: unknown, req: ChefAiRequest): ChefAiReply {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === "string" ? cut(x.trim(), n) : "");
  const strs = (x: unknown, n: number, len: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => cut(s.trim(), len)).filter(Boolean).slice(0, n) : []);
  const ids = new Set(req.familyRecipes.map((r) => r.id));
  const seen = new Set<string>();
  const picks = (Array.isArray(o.picks) ? o.picks : []).flatMap((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    const id = str(x.recipeId, 140);
    if (!ids.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ recipeId: id, why: str(x.why, 400) }];
  }).slice(0, 3);
  const expired = req.expired.map((e) => e.replace(/\s*\(.*$/, "").toLowerCase());
  const recipes = (Array.isArray(o.recipes) ? o.recipes : []).flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const title = str(x.title, 100);
    if (!title) return [];
    const ingredients = (Array.isArray(x.ingredients) ? x.ingredients : []).slice(0, 25).flatMap((i) => {
      const y = (i ?? {}) as Record<string, unknown>;
      const name = str(y.name, 80);
      if (!name) return [];
      // "have" survives only with evidence, and never for something past its date.
      const ev = evidenceFor(name, req);
      const have = y.have === true && !!ev && !expired.includes(ev.name.toLowerCase());
      return [{ name, amount: str(y.amount, 60), have }];
    });
    const minutes = typeof x.minutes === "number" && Number.isFinite(x.minutes) ? Math.max(1, Math.min(600, Math.round(x.minutes))) : 0;
    return [{ title, why: str(x.why, 500), minutes, serves: str(x.serves, 40), ingredients, steps: strs(x.steps, 12, 300), tips: strs(x.tips, 4, 300) }];
  }).slice(0, 3);
  return { reply: str(o.reply, 600), picks, recipes, followUps: strs(o.followUps, 3, 100) };
}

// A checked AI recipe as an Idea card, with Kitchen's own evidence on each ingredient.
export function ideaFromAi(r: ChefAiRecipe, req: ChefAiRequest, n: number): Idea {
  const ingredients: IdeaIngredient[] = r.ingredients.map((i) => {
    const ev = i.have ? evidenceFor(i.name, req) : null;
    if (ev) return { name: i.name, amount: i.amount, status: "have", evidence: ev.evidence || ev.source, source: ev.source };
    if (BASIC.test(i.name.trim())) return { name: i.name, amount: i.amount, status: "basic", evidence: "a kitchen basic — not checked", source: null };
    return { name: i.name, amount: i.amount, status: "need", evidence: req.pantryConnected ? "not in Inventory and you didn't mention it" : "you didn't mention it", source: null };
  });
  const safety = [...new Set([...safetyFor(ingredients), ...r.tips.filter((t) => /°|temperature|cook (it )?to|raw|safe/i.test(t))])];
  return {
    id: `ai:${n}:${r.title}`, kind: "ai-generated", title: r.title, why: r.why ? [r.why] : [], minutes: r.minutes || null, serves: r.serves,
    ingredients, steps: r.steps, safety, missing: ingredients.filter((i) => i.status === "need").map((i) => i.name), niceToHave: [],
    familyNotes: r.tips.filter((t) => !safety.includes(t)), score: 0,
  };
}

export type ChefAiResult = { ok: true; reply: ChefAiReply; model: string } | { ok: false; error: string; off?: boolean };

// Browser side: the family-only endpoint, with the person's own sign-in token.
export async function askChef(req: ChefAiRequest, token: string, fetchImpl: typeof fetch = fetch): Promise<ChefAiResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: "You're offline — Kitchen's own ideas above still work." };
  try {
    const res = await fetchImpl("/api/companion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; reply?: unknown; model?: string };
    if (res.status === 503) return { ok: false, off: true, error: body.error ?? "Kitchen's AI isn't switched on yet." };
    if (!res.ok) return { ok: false, error: body.error ?? `Kitchen's AI couldn't answer (${res.status}).` };
    return { ok: true, reply: checkChefReply(body.reply, req), model: body.model ?? "" };
  } catch {
    return { ok: false, error: "Couldn't reach Kitchen's AI. Kitchen's own ideas above still stand." };
  }
}
