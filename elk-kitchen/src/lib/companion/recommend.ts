// "What should we cook?" over the family's own recipes, grounded in what the
// family recorded and what ELK Pantry shows. Plain rules, not AI.
//
// Every reason says where it came from:
//   pantry  ELK Pantry shows it (with Pantry's own count, place, best-before)
//   said    the person said so just now (never treated as stock)
//   family  someone recorded it (a rating, "make it again", a favourite, food notes)
//   recipe  read off the recipe itself (its tags, its ingredient list)
//   caution something to check (an avoided ingredient, made recently, not again)
//   missing Pantry shows none left / Pantry doesn't know
// Nothing is invented: no quantities beyond Pantry's, no tastes nobody recorded.

import type { RecipeSummary } from "../../types/recipe";
import type { MemberProfile } from "../../types/feedback";
import type { PantryItem } from "../pantry";
import { checkRecipe, mentions, type LineCheck, type RecipePantryCheck } from "../pantryCheck";
import { avoidList, type RecipeTaste } from "../familyMemory";
import type { Ask, Diet } from "./ask";
import { daysBetween, leftovers, stockLabel, useSoon, whenLabel, type SoonItem } from "./pantryView";

export type ReasonSource = "pantry" | "said" | "family" | "recipe" | "caution" | "missing";
export type Reason = { source: ReasonSource; text: string };

export type Suggestion = {
  recipe: RecipeSummary;
  score: number;
  reasons: Reason[];
  check: RecipePantryCheck | null;
  // Ingredient lines Pantry shows none left of — candidates for the shopping list.
  missing: LineCheck[];
  // Lines Pantry has no record of (ask the person; never assumed missing).
  unknown: LineCheck[];
};

export type Grounding = {
  recipes: RecipeSummary[];
  // null = ELK Pantry isn't connected here (Kitchen then can't see stock at all).
  pantry: PantryItem[] | null;
  taste: Map<string, RecipeTaste>;
  profiles: MemberProfile[];
  today: string;
};

export type Answer = {
  reply: string;
  suggestions: Suggestion[];
  // Everything that passed the rules, best first (what an AI pass may choose from).
  ranked: Suggestion[];
  soon: SoonItem[];
  leftovers: PantryItem[];
  // Rules relaxed because nothing fit them all.
  loosened: string[];
  pantryConnected: boolean;
};

const MEAT = ["chicken", "beef", "pork", "lamb", "turkey", "bacon", "ham", "sausage", "steak", "mince", "ground beef", "venison", "elk", "duck", "fish", "salmon", "tuna", "shrimp", "prawn", "anchovy", "chorizo", "pepperoni", "prosciutto", "jerky", "gelatin", "fish sauce"];
const ANIMAL = [...MEAT, "egg", "eggs", "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "honey", "mayonnaise", "parmesan", "cheddar", "mozzarella", "feta"];
const GLUTEN = ["flour", "bread", "pasta", "noodle", "noodles", "spaghetti", "couscous", "barley", "breadcrumbs", "panko", "tortilla", "wheat", "soy sauce", "crackers", "pastry", "lasagne", "lasagna", "macaroni"];
const DAIRY = ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "parmesan", "cheddar", "mozzarella", "feta", "ghee", "sour cream"];
const DIET_WORDS: Record<Diet, string[]> = { vegetarian: MEAT, vegan: ANIMAL, "gluten-free": GLUTEN, "dairy-free": DAIRY };

const QUICK_TAG = /\b(quick|fast|easy|weeknight|\d{1,2}[- ]?min(ute)?s?|one[- ]pot|sheet[- ]pan|no[- ]cook)\b/i;
const MEAL_TAG: Record<string, RegExp> = {
  dinner: /\b(dinner|main|supper|mains?|weeknight)\b/i,
  lunch: /\b(lunch|salad|sandwich|soup|bowl)\b/i,
  breakfast: /\b(breakfast|brunch|pancakes?|eggs?|oats|porridge)\b/i,
};

const lines = (r: RecipeSummary) => r.ingredients.split("\n").map((l) => l.replace(/^[-•*·]\s*/, "").trim()).filter((l) => l && !/:$/.test(l));
const tagText = (r: RecipeSummary) => [...r.tags, r.category, r.kind].join(" ");
const hasWord = (r: RecipeSummary, w: string) => lines(r).some((l) => mentions(l, w)) || mentions(r.title, w);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Filter = { label: string; keep: (r: RecipeSummary) => boolean };

function score(r: RecipeSummary, ask: Ask, g: Grounding, soon: SoonItem[], left: PantryItem[]): Suggestion {
  const reasons: Reason[] = [];
  let s = 0;
  const check = g.pantry ? checkRecipe(r.ingredients, g.pantry) : null;
  const missing = check ? check.lines.filter((l) => l.status.state === "missing") : [];
  const unknown = check ? check.lines.filter((l) => l.status.state === "unknown") : [];

  // ── Pantry (confirmed in Inventory) ──
  if (check && check.total > 0) {
    const ratio = check.have / check.total;
    s += ratio * 3 * (ask.fromPantry ? 2 : 1) - missing.length * 0.6;
    if (check.have === check.total) reasons.push({ source: "pantry", text: `Pantry shows every ingredient (${check.total}) — it counts packages, not amounts` });
    else if (check.have > 0) reasons.push({ source: "pantry", text: `Pantry shows ${check.have} of ${check.total} ingredients` });
  }
  for (const so of soon) {
    const hit = check?.lines.find((l) => l.status.state === "have" && l.status.item.name === so.item.name);
    if (hit) {
      s += so.daysLeft <= 1 ? 4 : 3;
      reasons.push({ source: "pantry", text: `Uses your ${so.item.name.toLowerCase()} — ${whenLabel(so.daysLeft)} (Pantry: ${stockLabel(so.item)})` });
    }
  }
  for (const lf of left) {
    if (lines(r).some((l) => mentions(l, lf.name) || mentions(lf.name, l)) || lf.name.trim().toLowerCase() === r.title.trim().toLowerCase()) {
      s += 3;
      reasons.push({ source: "pantry", text: `Pantry has ${lf.name} (${stockLabel(lf)})` });
    }
  }
  // ── What the person asked to use / said they have ──
  for (const u of ask.use) {
    if (hasWord(r, u)) {
      s += 5;
      const inPantry = g.pantry?.find((p) => p.onHand > 0 && (mentions(p.name, u)));
      reasons.push(inPantry
        ? { source: "pantry", text: `Uses ${u} — Pantry has ${inPantry.name} (${stockLabel(inPantry)})` }
        : { source: "said", text: `Uses ${u}, which you mentioned (not in Pantry)` });
    }
  }
  const saidHits = ask.said.filter((w) => hasWord(r, w));
  if (saidHits.length) {
    s += saidHits.length * 1.5;
    reasons.push({ source: "said", text: `You said you have ${list(saidHits)}` });
  }

  // ── What the family recorded ──
  const t = g.taste.get(r.id);
  const weight = ask.familyLikes ? 3 : 1; // "the family will like": what they recorded leads
  if (t?.average != null) {
    s += (t.average - 6) * 0.8 * weight;
    const top = t.ratings.slice(0, 3).map((x) => `${x.name} ${x.rating}`).join(", ");
    reasons.push({ source: "family", text: `Rated ${t.average}/10 on average by ${t.ratings.length} ${t.ratings.length === 1 ? "person" : "people"} (${top})` });
  }
  if (t?.wouldMakeAgain.length) {
    s += t.wouldMakeAgain.length * 0.8 * weight;
    reasons.push({ source: "family", text: `${list(t.wouldMakeAgain)} said they'd have it again` });
  }
  if (t?.wouldNot.length) {
    s -= 2.5 * t.wouldNot.length;
    reasons.push({ source: "caution", text: `${list(t.wouldNot)} said not again` });
  }
  if (t?.improvements[0]) reasons.push({ source: "family", text: `Last note to self: “${t.improvements[0].text}” — ${t.improvements[0].name}` });
  if (r.favourite) {
    s += 1.5 * weight;
    reasons.push({ source: "family", text: "You marked it a favourite" });
  }
  if (r.timesCooked > 0 && r.lastCookedOn) {
    const ago = daysBetween(r.lastCookedOn, g.today);
    if (ago >= 0 && ago <= 3) { s -= 3; reasons.push({ source: "caution", text: `Made ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}` }); }
    else if (ago > 45 && (t?.average ?? 0) >= 7) { s += 1; reasons.push({ source: "family", text: `Not made since ${fmtDate(r.lastCookedOn)}` }); }
  }

  // ── Food notes: each person's own words ──
  for (const p of g.profiles) {
    const hits = avoidList(p).filter((w) => hasWord(r, w));
    if (hits.length) {
      s -= 5;
      reasons.push({ source: "caution", text: `${p.name || "Someone"} avoids ${list(hits)} (their food notes) — the recipe lists it` });
    }
  }

  // ── The recipe itself ──
  if (ask.quick || ask.minutes) {
    if (QUICK_TAG.test(tagText(r))) { s += 2; reasons.push({ source: "recipe", text: `Tagged ${r.tags.find((x) => QUICK_TAG.test(x)) ?? "quick"}` }); }
    else reasons.push({ source: "recipe", text: "Its cooking time isn't recorded" });
  }
  if (ask.meal && MEAL_TAG[ask.meal].test(`${tagText(r)} ${r.title}`)) s += 1;

  if (check) {
    if (missing.length) reasons.push({ source: "missing", text: `Pantry shows none left of ${list(missing.map((m) => m.name.toLowerCase()).slice(0, 4))}` });
    if (unknown.length) reasons.push({ source: "missing", text: `Pantry doesn't know about ${list(unknown.map((m) => m.name.toLowerCase()).slice(0, 4))}${unknown.length > 4 ? "…" : ""}` });
  }
  return { recipe: r, score: Math.round(s * 10) / 10, reasons, check, missing, unknown };
}

export function recommend(ask: Ask, g: Grounding): Answer {
  const pantryConnected = g.pantry != null;
  const soon = g.pantry ? useSoon(g.pantry, g.today) : [];
  const left = g.pantry ? leftovers(g.pantry, g.recipes.map((r) => r.title)) : [];
  const pool = g.recipes.filter((r) => !r.removedAt);

  // Firm rules, loosened one at a time (and said so) when nothing fits.
  const filters: Filter[] = [
    ...ask.diet.map((d): Filter => ({ label: d, keep: (r) => !DIET_WORDS[d].some((w) => hasWord(r, w)) })),
    ...ask.avoid.map((a): Filter => ({ label: `no ${a}`, keep: (r) => !hasWord(r, a) })),
    ...ask.use.map((u): Filter => ({ label: `uses ${u}`, keep: (r) => hasWord(r, u) })),
  ];
  let kept = pool;
  const loosened: string[] = [];
  for (let n = filters.length; n >= 0; n--) {
    const active = filters.slice(0, n);
    kept = pool.filter((r) => active.every((f) => f.keep(r)));
    if (kept.length > 0 || n === 0) { loosened.push(...filters.slice(n).map((f) => f.label)); break; }
  }

  const ranked = kept.map((r) => score(r, ask, g, soon, left))
    .sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
  const suggestions = (ask.kind === "going-off" ? ranked.filter((x) => x.reasons.some((r) => r.source === "pantry" && /^Uses your/.test(r.text))) : ranked)
    .slice(0, ask.count);

  return { reply: replyFor(ask, suggestions, soon, left, loosened, pantryConnected, pool.length), suggestions, ranked, soon, leftovers: left, loosened, pantryConnected };
}

function replyFor(ask: Ask, sug: Suggestion[], soon: SoonItem[], left: PantryItem[], loosened: string[], pantry: boolean, total: number): string {
  const parts: string[] = [];
  if (total === 0) return "There are no recipes in the family book yet. Add one (or photograph a recipe card) and I can start suggesting.";
  if (ask.kind === "going-off") {
    if (!pantry) return "ELK Pantry isn't connected here, so I can't see best-before dates. Tell me what needs using and I'll look for recipes with it.";
    if (soon.length === 0) parts.push("Pantry shows nothing with a best-before date in the next 4 days.");
    else parts.push(`Pantry shows ${soon.length} thing${soon.length === 1 ? "" : "s"} to use soon: ${list(soon.slice(0, 4).map((x) => `${x.item.name} (${whenLabel(x.daysLeft)})`))}.`);
    parts.push(sug.length ? `${sug.length === 1 ? "This recipe uses" : "These recipes use"} ${soon.length === 1 ? "it" : "some of them"}.` : soon.length ? "None of the family's recipes list those, as far as I can tell from the ingredient lists." : "");
    return parts.filter(Boolean).join(" ");
  }
  if (!pantry) parts.push("ELK Pantry isn't connected here, so I'm going on the family's recipes and ratings, and what you tell me.");
  else if (soon.length && !ask.use.length) parts.push(`Pantry says ${soon[0].item.name.toLowerCase()} needs using (${whenLabel(soon[0].daysLeft)}).`);
  if (ask.leftover && pantry && left.length === 0 && !ask.use.length) parts.push("Pantry doesn't list any leftovers, so these are just good options.");
  if (loosened.length) parts.push(`Nothing fit everything, so these leave out: ${loosened.join(", ")}.`);
  parts.push(sug.length === 0 ? "I couldn't find a family recipe that fits." : `Here ${sug.length === 1 ? "is one idea" : `are ${sug.length} ideas`} from the family's recipes.`);
  return parts.join(" ");
}
