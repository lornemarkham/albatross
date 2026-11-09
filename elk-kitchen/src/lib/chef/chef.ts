// Kitchen's chef conversation, the rule-based half. This half always answers,
// with or without AI, online or not:
//
//   1. Understand: what was said (mentioned.ts), the occasion, time, diet, "no X".
//   2. Ground: what Inventory shows, what Kitchen recently made, what was said
//      (knowledge.ts), and what each family member recorded (familyTaste.ts).
//   3. Suggest: the family's own recipes that fit (companion/recommend.ts) and
//      Kitchen's dish ideas built from what's there (ideas.ts), each with what's
//      missing.
//
// The AI half (chef/ai.ts) is sent this same grounding and may only add to it.

import type { MealFeedback, MemberProfile } from "../../types/feedback";
import type { RecipeSummary } from "../../types/recipe";
import type { PantryItem } from "../pantry";
import { parseAsk, type Ask } from "../companion/ask";
import { recommend, type Suggestion } from "../companion/recommend";
import { tasteByRecipe } from "../familyMemory";
import { mentions } from "../pantryCheck";
import { buildKnowledge, sameFood, type Knowledge, type RecentFood } from "./knowledge";
import { parseMentions, parseOccasion, type Mentioned, type Occasion } from "./mentioned";
import { kitchenIdeas, type Idea, type Meal } from "./ideas";
import type { HouseholdTaste } from "./familyTaste";

export type ChefTurn = { role: "you" | "kitchen"; text: string };

export type ChefInput = {
  text: string;
  // Foods mentioned earlier in this conversation (newest wins) and ones picked from the lists.
  earlier: Mentioned[];
  picked: Mentioned[];
  recipes: RecipeSummary[];
  pantry: PantryItem[] | null;
  recent: RecentFood[];
  feedback: MealFeedback[];
  profiles: MemberProfile[];
  taste: HouseholdTaste;
  today: string;
};

export type ChefAnswer = {
  ask: Ask;
  occasion: Occasion | null;
  snack: boolean;
  mentioned: Mentioned[];
  knowledge: Knowledge;
  // What Kitchen understood each food to be, and how it knows.
  understood: { name: string; how: string; source: "inventory" | "recent" | "said" }[];
  reply: string;
  ideas: Idea[];
  family: Suggestion[];
  // The family's recipes that could be dishes here, best first (what the AI may pick from).
  familyPool: Suggestion[];
  // Said "I have…" but Inventory has no record: offered to Inventory, only if the person confirms.
  offerToInventory: Mentioned[];
  cautions: string[];
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lc = (s: string) => s.toLowerCase();

export function mergeMentions(earlier: Mentioned[], now: Mentioned[]): Mentioned[] {
  const out = new Map<string, Mentioned>();
  for (const m of [...earlier, ...now]) out.set(lc(m.name), m);
  return [...out.values()];
}

const SNACK_TAG = /\b(snack|appeti[sz]er|dip|game ?day|party|finger|platter|bites?|nachos?|wings?)\b/i;

export function chef(input: ChefInput): ChefAnswer {
  const said = parseMentions(input.text);
  const mentioned = mergeMentions([...input.earlier, ...input.picked], said);
  const { occasion, snack } = parseOccasion(input.text);
  const base = parseAsk(input.text);
  const ask: Ask = {
    ...base,
    said: [...new Set([...mentioned.filter((m) => m.intent !== "use").map((m) => m.name)])],
    use: [...new Set([...base.use, ...mentioned.filter((m) => m.intent === "use").map((m) => m.name)])],
  };
  const knowledge = buildKnowledge({ pantry: input.pantry, recent: input.recent, said: mentioned, today: input.today, recipeTitles: input.recipes.map((r) => r.title) });

  // ── What Kitchen understood ──
  const understood: ChefAnswer["understood"] = [];
  for (const m of mentioned) {
    const recent = input.recent.find((r) => mentions(r.title, m.name) || mentions(m.name, r.title));
    const inv = knowledge.have.find((h) => h.source === "inventory" && sameFood(h.name, m.name));
    if (recent) understood.push({ name: recent.title, source: "recent", how: `made ${recent.daysAgo === 0 ? "today" : recent.daysAgo === 1 ? "yesterday" : `${recent.daysAgo} days ago`} — ${recent.from === "sausage-day" ? "Sausage Day record" : "Kitchen's cooking history"}${recent.inPantry ? ` · Pantry: ${recent.inPantry.onHand} ${recent.inPantry.unit}` : ""}` });
    else if (inv) understood.push({ name: inv.name, source: "inventory", how: `${inv.evidence}${m.intent === "use" ? " · you want it used" : ""}` });
    else understood.push({ name: m.name, source: "said", how: `you ${m.intent === "made" ? `said you made it${m.when ? ` ${m.when}` : ""}` : m.intent === "use" ? "want it used" : "said you have it"}${m.amount ? ` (${m.amount})` : ""} — not in Inventory` });
  }

  // ── Kitchen's ideas from what's here ──
  const meal: Meal | null = snack ? "snack" : base.meal;
  const ideas = kitchenIdeas(knowledge, { meal, occasion, snack, quick: base.quick, avoid: [...base.avoid] }, base.count);
  const cautions: string[] = [];
  for (const idea of ideas) idea.familyNotes = familyNotesFor(idea, input.taste);

  // ── The family's own recipes that fit ──
  // A recipe that *made* the food being used ("Bratwurst" when using bratwurst) isn't a dish idea.
  const producedIt = new Set(input.recent.filter((r) => mentioned.some((m) => mentions(r.title, m.name) || mentions(m.name, r.title))).map((r) => r.recipeId));
  const taste = tasteByRecipe(input.feedback);
  const rec = recommend(ask, { recipes: input.recipes, pantry: input.pantry, taste, profiles: input.profiles, today: input.today });
  // Sausage and jerky recipes make ingredients, not a plate.
  const familyPool = rec.ranked.filter((s) => !producedIt.has(s.recipe.id) && s.recipe.kind !== "sausage" && s.recipe.kind !== "jerky");
  const family = familyPool.filter((s) => {
    const usesSomething = s.reasons.some((r) => (r.source === "said" || (r.source === "pantry" && /^Uses/.test(r.text))));
    if (snack || occasion) return usesSomething && (SNACK_TAG.test(`${s.recipe.title} ${s.recipe.tags.join(" ")} ${s.recipe.category}`) || s.score >= 6);
    return usesSomething || s.score >= 4;
  }).slice(0, 2);

  for (const s of input.taste.split) {
    if (mentioned.some((m) => mentions(s.title, m.name) || mentions(m.name, s.title))) cautions.push(`${s.title} split the family: ${list(s.loved)} loved it; ${list(s.not)} didn't. Worth making something they can each adjust.`);
  }
  if (knowledge.expired.length) cautions.push(`Past best-before in Pantry: ${list(knowledge.expired.slice(0, 4).map((h) => h.name))}. Kitchen won't plan around these — check them before using.`);

  const offerToInventory = knowledge.pantryConnected
    ? mentioned.filter((m) => !knowledge.have.some((h) => h.source === "inventory" && mentions(h.name, m.name)))
    : [];

  return { ask, occasion, snack, mentioned, knowledge, understood, reply: replyFor(understood, ideas, family, knowledge, occasion, snack), ideas, family, familyPool, offerToInventory, cautions };
}

function familyNotesFor(idea: Idea, taste: HouseholdTaste): string[] {
  const out: string[] = [];
  const names = idea.ingredients.filter((i) => i.status === "have" || i.status === "need").map((i) => lc(i.name));
  const all = idea.ingredients.map((i) => lc(i.name));
  for (const p of taste.people) {
    const hits = p.avoids.filter((a) => all.some((n) => n.includes(a) || a.includes(n)));
    if (hits.length) out.push(`⚠ ${p.name} avoids ${list(hits)} (their food notes) — keep it off their share.`);
    for (const l of p.leanings) {
      if (names.some((n) => mentions(l.recipeTitle, n) || mentions(n, l.recipeTitle))) out.push(`${p.name} on ${l.recipeTitle}: “${l.quote}” — ${l.direction === "less" ? "go easy on" : "be generous with"} the ${l.about} here.`);
      else if (l.about === "heat" && l.direction === "less" && all.some((n) => /pepper|jalape|hot sauce|salsa|chil/.test(n))) out.push(`${p.name} has asked for less heat before (“${l.quote}”) — keep the jalapeños on the side.`);
    }
    const fav = p.favourites.find((f) => names.some((n) => mentions(f.title, n) || mentions(n, f.title)));
    if (fav) out.push(`${p.name} rated ${fav.title} ${fav.rating != null ? `${fav.rating}/10` : "a favourite"}.`);
  }
  return [...new Set(out)].slice(0, 4);
}

function replyFor(understood: ChefAnswer["understood"], ideas: Idea[], family: Suggestion[], k: Knowledge, occasion: Occasion | null, snack: boolean): string {
  const parts: string[] = [];
  const recent = understood.filter((u) => u.source === "recent").map((u) => u.name);
  const said = understood.filter((u) => u.source === "said").map((u) => lc(u.name));
  const inv = understood.filter((u) => u.source === "inventory").map((u) => lc(u.name));
  const bits = [
    recent.length ? `the ${list(recent.map(lc))} you made` : "",
    said.length ? `the ${list(said)} you mentioned` : "",
    inv.length ? `the ${list(inv)} Inventory shows` : "",
  ].filter(Boolean);
  if (bits.length) parts.push(`Working with ${list(bits)}.`);
  const extra = [...new Set(ideas.flatMap((i) => i.ingredients.filter((x) => x.status === "have" && x.source === "inventory").map((x) => lc(x.name))))].filter((n) => !inv.includes(n));
  if (extra.length) parts.push(`Inventory also has ${list(extra.slice(0, 4))}, so I've used ${extra.length === 1 ? "it" : "them"}.`);
  if (!k.pantryConnected) parts.push("Inventory isn't connected here, so I only know what you've told me and what Kitchen recorded.");
  const total = ideas.length + family.length;
  const what = snack || occasion ? `${occasion ? `${occasion} ` : ""}snack ${total === 1 ? "idea" : "ideas"}` : total === 1 ? "idea" : "ideas";
  if (ideas.length + family.length === 0) parts.push("Nothing I know fits well yet. Tell me a few more things you have, or pick some from the lists.");
  else parts.push(`Here ${ideas.length + family.length === 1 ? "is one" : `are ${ideas.length + family.length}`} ${what}${family.length ? `, including ${family.length === 1 ? "one" : family.length} from the family's recipes` : ""}.`);
  const needs = [...new Set(ideas.flatMap((i) => i.missing))];
  if (needs.length) parts.push(`Some need a thing or two you don't have (${list(needs.slice(0, 4))}). I can add those to the shopping list.`);
  else if (ideas.length) {
    const extras = [...new Set(ideas.flatMap((i) => i.niceToHave))];
    parts.push(`You have what these need${extras.length ? `; nice extras if you want them: ${list(extras.slice(0, 4))}` : ""}.`);
  }
  return parts.join(" ");
}
