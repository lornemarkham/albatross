// Ranking ideas for an invitation ("Quick and easy", "Use what we have"…)
// with a reason for every suggestion (doctrine §4). Plain rules, no AI.
//
// Reasons must come from something real: the sample's own fields, the family's
// recipe history, Pantry evidence, or what the person tapped. They never
// claim a taste or a reaction nobody recorded.

import type { RecipeSummary } from "../../types/recipe";
import { upcomingHolidays, seasonOf, whenLabel } from "./context";
import { saidWords } from "./haveChips";
import { fibreSources } from "./nutrition";
import { answerKey, daysBetween, pantryFit, type PantryFit } from "./pantryMatch";
import { checkRecipe } from "../../lib/pantryCheck";

// "Pantry confirms 6 of 9 ingredients" for a free-text family recipe; null when it confirms none.
function pantryReason(ingredients: string, pantry: Parameters<typeof checkRecipe>[1]): string | null {
  if (pantry.length === 0) return null;
  const c = checkRecipe(ingredients, pantry);
  return c.have > 0 ? `Pantry confirms ${c.have} of ${c.total} ingredients` : null;
}
import type { Answers, Moment, Mood, PantryItem, SampleIdea } from "./types";

export type IdeaKey = "tonight" | "pantry" | "protein" | "healthy" | "quick" | "bbq" | "favourites" | "surprise";
export type HealthyAngle = "veg" | "protein" | "beans";

export type Invitation = { key: IdeaKey; title: string; subtitle: string; emoji: string; palette: [string, string] };

export const INVITATIONS: Invitation[] = [
  { key: "tonight", title: "What should we cook tonight?", subtitle: "A few good ideas for right now", emoji: "🍽️", palette: ["#f6bd60", "#e76f51"] },
  { key: "pantry", title: "Use what we have", subtitle: "Start from the cupboard", emoji: "🫙", palette: ["#e9c46a", "#a3b18a"] },
  { key: "protein", title: "High-protein meals", subtitle: "Hearty and filling", emoji: "💪", palette: ["#f4a261", "#b5651d"] },
  { key: "healthy", title: "Something healthy", subtitle: "You choose what that means", emoji: "🥦", palette: ["#b7e4c7", "#52b788"] },
  { key: "quick", title: "Quick and easy", subtitle: "On the table in about 30", emoji: "⏱️", palette: ["#ffe5a0", "#f4a259"] },
  { key: "bbq", title: "Fire up the BBQ", subtitle: "Smoke, char and sunshine", emoji: "🔥", palette: ["#ff9f68", "#c0392b"] },
  { key: "favourites", title: "Family favourites", subtitle: "The ones you come back to", emoji: "⭐", palette: ["#ffd6a5", "#d4a373"] },
  { key: "surprise", title: "Surprise me", subtitle: "Something a little different", emoji: "🎲", palette: ["#cdb4db", "#8e7dbe"] },
];

export type SampleSuggestion = { idea: SampleIdea; fit: PantryFit; reasons: string[]; score: number };
export type SavedSuggestion = { recipe: RecipeSummary; reasons: string[] };
export type Shelf = { samples: SampleSuggestion[]; saved: SavedSuggestion[]; note: string | null };

type Ctx = {
  samples: SampleIdea[];
  saved: RecipeSummary[];
  pantry: PantryItem[];
  answers: Answers;
  moment: Moment;
  angle?: HealthyAngle;
  seed?: number;
};

const has = (s: SampleIdea, m: Mood) => s.moods.includes(m);

export function vegCount(s: SampleIdea): number {
  return s.ingredients.filter((i) => i.veg).length;
}

export function proteinNames(s: SampleIdea): string[] {
  return s.ingredients.filter((i) => i.protein).map((i) => i.name);
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

// What makes a sample right for this invitation (and the reason to say so).
const FITS: Record<Exclude<IdeaKey, "tonight" | "pantry" | "favourites" | "surprise">, (s: SampleIdea, angle?: HealthyAngle) => string | null> = {
  protein: (s) => has(s, "protein") ? `Built around ${proteinNames(s).slice(0, 2).join(" and ")}` : null,
  healthy: (s, angle = "veg") => {
    if (angle === "protein") return has(s, "protein") ? `Built around ${proteinNames(s).slice(0, 2).join(" and ")}` : null;
    if (angle === "beans") {
      const b = s.ingredients.find((i) => /bean|lentil|chickpea/i.test(i.name));
      return b ? `Made with ${b.name}` : null;
    }
    const n = vegCount(s);
    return n >= 3 ? `${n} kinds of vegetables` : null;
  },
  quick: (s) => s.minutes <= 30 ? `About ${s.minutes} minutes` : null,
  bbq: (s) => s.equipment.includes("bbq") ? "Made on the BBQ" : null,
};

// Signals from the moment and the Pantry. Each adds to the score and, when
// it applies, says why.
function contextReasons(s: SampleIdea, fit: PantryFit, moment: Moment): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (fit.useSoon.length) {
    score += 3;
    const u = fit.useSoon[0];
    reasons.push(`Uses your ${u.name} (best before ${shortDate(u.bestBefore)})`);
  }
  if (fit.total > 0 && fit.have === fit.total) { score += 3; reasons.push("You have everything for this"); }
  else if (fit.have >= 2) score += fit.have / fit.total * 2;

  if (moment.weather === "hot") {
    if (has(s, "fresh") || has(s, "no-cook") || s.equipment.includes("bbq")) { score += 4; reasons.push("Light and fresh for a hot day"); }
    if (has(s, "comfort") || s.equipment.includes("oven")) score -= 3;
  }
  if (moment.weather === "cold" || moment.weather === "rainy") {
    if (has(s, "comfort")) { score += 4; reasons.push(moment.weather === "cold" ? "Warming on a chilly day" : "Cozy for a rainy day"); }
    if (has(s, "no-cook")) score -= 1;
  }
  if (moment.minutes !== null) {
    if (s.minutes <= moment.minutes) { score += 1; reasons.push(`Fits your ${moment.minutes} minutes`); }
    else score -= 4;
  }
  if (moment.equipment.length && s.equipment.some((e) => moment.equipment.includes(e))) score += 1;
  if (moment.kids && has(s, "kids")) { score += 2; reasons.push("Mild and family-friendly"); }

  const season = seasonOf(moment.today);
  if ((season === "autumn" || season === "winter") && has(s, "comfort")) score += 0.5;
  if (season === "summer" && (has(s, "fresh") || s.equipment.includes("bbq"))) score += 0.5;

  const feast = upcomingHolidays(moment.today).find((h) => /Thanksgiving|Christmas/.test(h.name));
  if (feast && has(s, "feast")) { score += 1; reasons.push(`${feast.name} is ${whenLabel(feast.inDays, feast.date)}`); }

  return { score, reasons };
}

// When nothing about the moment applies, still say something true about the
// dish itself rather than nothing (or something made up).
export function describe(s: SampleIdea): string {
  if (s.minutes <= 30) return `About ${s.minutes} minutes`;
  if (has(s, "make-ahead")) return "Makes plenty — good for leftovers";
  if (vegCount(s) >= 3) return `${vegCount(s)} kinds of vegetables`;
  if (proteinNames(s).length) return `Built around ${proteinNames(s)[0]}`;
  return `About ${s.minutes} minutes`;
}

// Seeded shuffle so "Surprise me" can re-roll without being untestable.
function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SAVED_WORDS: Partial<Record<IdeaKey, RegExp>> = {
  quick: /\b(quick|easy|weeknight|fast|15 ?min|20 ?min|30 ?min)\b/i,
  bbq: /\b(bbq|barbecue|grill|grilled|smoker)\b/i,
  protein: /\b(protein|chicken|beef|turkey|pork|tofu|eggs?|fish|salmon|lentils?|beans?)\b/i,
  healthy: /\b(salad|vegetables?|veg|veggie|greens|healthy|kale|spinach)\b/i,
};

function savedFor(key: IdeaKey, ctx: Ctx): SavedSuggestion[] {
  const out: SavedSuggestion[] = [];
  const today = ctx.moment.today;
  for (const r of ctx.saved) {
    const reasons: string[] = [];
    // Don't offer tonight what the family recorded cooking in the last few days.
    if ((key === "tonight" || key === "surprise") && cookedRecently(r, today)) continue;
    if (key === "favourites" || key === "tonight") {
      if (r.favourite) reasons.push("★ You marked it a favourite");
      if (r.timesCooked >= 2) reasons.push(`Cooked ${r.timesCooked} times${r.lastCookedOn ? ` · last ${shortDate(r.lastCookedOn)}` : ""}`);
      if (reasons.length && r.lastCookedOn && daysBetween(r.lastCookedOn, today) >= 30) reasons.push(`Not made since ${shortDate(r.lastCookedOn)}`);
    }
    if (key === "pantry") {
      const p = pantryReason(r.ingredients, ctx.pantry);
      if (p) reasons.push(p);
    }
    const words = SAVED_WORDS[key];
    if (words) {
      const tag = r.tags.find((t) => words.test(t));
      const hit = tag ? null : `${r.title}\n${r.ingredients}`.match(words);
      if (tag) reasons.push(`Tagged “${tag}”`);
      else if (hit) reasons.push(`Mentions ${hit[0].toLowerCase()}`);
    }
    if (reasons.length) out.push({ recipe: r, reasons });
  }
  const fresh = ctx.saved.filter((r) => !cookedRecently(r, today));
  if (key === "surprise" && fresh.length) {
    const r = shuffled(fresh, ctx.seed ?? 1)[0];
    out.push({ recipe: r, reasons: [r.timesCooked === 0 ? "Saved but nobody has recorded cooking it yet" : `Last cooked ${r.lastCookedOn ? shortDate(r.lastCookedOn) : "a while ago"}`] });
  }
  return out.slice(0, 4);
}

export function shelfFor(key: IdeaKey, ctx: Ctx): Shelf {
  const saved = savedFor(key, ctx);
  let note: string | null = null;

  if (key === "favourites") {
    if (!saved.length) note = "Favourites appear here once someone taps ☆ on a recipe or records cooking it more than once. Kitchen won't guess what you like.";
    return { samples: [], saved, note };
  }

  let pool: SampleSuggestion[] = ctx.samples.map((idea) => {
    const fit = pantryFit(idea.ingredients, ctx.pantry, ctx.answers, ctx.moment.today);
    const c = contextReasons(idea, fit, ctx.moment);
    return { idea, fit, reasons: c.reasons, score: c.score };
  });

  if (key in FITS) {
    const fitFn = FITS[key as keyof typeof FITS];
    pool = pool.flatMap((s) => {
      const why = fitFn(s.idea, ctx.angle);
      return why ? [{ ...s, reasons: [why, ...s.reasons], score: s.score + 2 }] : [];
    });
  }
  if (key === "pantry") {
    // Worth suggesting if most of it is on hand, or it uses something up.
    pool = pool
      .filter((s) => s.fit.have / Math.max(1, s.fit.total) >= 0.5 || s.fit.useSoon.length > 0)
      .map((s) => {
        const onHand = s.fit.statuses.filter((x) => x.status.state === "have").map((x) => x.ingredient.name);
        return {
          ...s,
          score: s.score + (s.fit.have / Math.max(1, s.fit.total)) * 4 - s.fit.out * 2,
          reasons: s.reasons.some((r) => r.startsWith("You have everything")) ? s.reasons : [`On hand: ${onHand.slice(0, 3).join(", ")}`, ...s.reasons],
        };
      });
    if (!ctx.pantry.length) note = "Pantry isn't connected, so Kitchen can't see your cupboard. Tell it what you have in the box below — “I have black beans and chicken”.";
  }
  if (key === "tonight") pool = pool.filter((s) => s.idea.course === "main");
  if (key === "surprise") {
    // A few proper dinners — not snacks or sides — that suit the moment.
    const dinners = pool.filter((s) => s.idea.course === "main" && s.score > -3);
    const pick = shuffled(dinners, ctx.seed ?? 1).slice(0, 3);
    return { samples: pick.map((s) => (s.reasons.length ? s : { ...s, reasons: [describe(s.idea)] })), saved: saved.slice(0, 1), note };
  }

  const samples = pool
    .sort((a, b) => b.score - a.score || a.idea.minutes - b.idea.minutes)
    .slice(0, 4)
    .map((s) => (s.reasons.length ? s : { ...s, reasons: [describe(s.idea)] }));
  return { samples, saved, note };
}

// Reasons for one idea, for its own page.
export function reasonsFor(idea: SampleIdea, pantry: PantryItem[], answers: Answers, moment: Moment): { fit: PantryFit; reasons: string[] } {
  const fit = pantryFit(idea.ingredients, pantry, answers, moment.today);
  const { reasons } = contextReasons(idea, fit, moment);
  return { fit, reasons: reasons.length ? reasons : [describe(idea)] };
}

export const RECENT_DAYS = 3;

// Whole-word mention of `word` in free text ("rice" in "2 cups rice", not "price").
function mentions(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function cookedRecently(r: RecipeSummary, today: string): boolean {
  if (!r.lastCookedOn) return false;
  const d = daysBetween(r.lastCookedOn, today);
  return d >= 0 && d < RECENT_DAYS;
}

export function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// "Use what we have": ideas ranked by how much of them the person has said
// (or Pantry shows) is in the kitchen. Only ideas that use at least one of
// those things appear, and the reason names them.
export function haveShelf(ctx: Ctx): Shelf {
  const words = saidWords(ctx.answers);
  const samples = ctx.samples
    .map((idea) => {
      const fit = pantryFit(idea.ingredients, ctx.pantry, ctx.answers, ctx.moment.today);
      const c = contextReasons(idea, fit, ctx.moment);
      const onHand = fit.statuses.flatMap(({ ingredient, status }) => {
        if (status.state !== "have") return [];
        const a = ctx.answers[answerKey(ingredient)];
        return [typeof a === "object" ? a.said : ingredient.name];
      });
      const uses = [...new Set(onHand)];
      const reasons = [
        ...(fit.total > 0 && fit.have === fit.total ? [] : uses.length ? [`Uses your ${list(uses.slice(0, 3))}`] : []),
        ...c.reasons,
      ];
      const score = fit.have * 2 + (fit.have / Math.max(1, fit.total)) * 4 - fit.out * 2 + c.score + (idea.course === "main" ? 1 : 0);
      return { idea, fit, reasons, score };
    })
    .filter((s) => s.fit.have > 0)
    .sort((a, b) => b.score - a.score || a.idea.minutes - b.idea.minutes)
    .slice(0, 4);

  const saved: SavedSuggestion[] = [];
  for (const r of ctx.saved) {
    const text = r.ingredients.toLowerCase();
    const mentioned = words.filter((w) => mentions(text, w));
    const p = pantryReason(r.ingredients, ctx.pantry);
    const reasons = [
      ...(mentioned.length ? [`Your recipe mentions ${list(mentioned.slice(0, 3))}`] : []),
      ...(p ? [p] : []),
    ];
    if (reasons.length) saved.push({ recipe: r, reasons });
  }
  return { samples, saved: saved.slice(0, 4), note: null };
}

// "I'm in the mood for…": a few taps narrow the ideas. Meal, "with …", BBQ
// and the time the person gave are firm; feelings and goals only rank. If
// nothing fits everything, the firm rules loosen one at a time and Kitchen
// says which.
export type Meal = "dinner" | "lunch" | "snack" | "side";
export type Feel = "comfort" | "fresh" | "bbq";
export type Goal = "protein" | "veg" | "fibre";
export type WithIngredient = "chicken" | "turkey" | "beans" | "pasta" | "potatoes" | "cheese";
export type MoodFilters = { meal: Meal | null; feel: Feel | null; goal: Goal | null; with: WithIngredient | null };
export const NO_MOOD: MoodFilters = { meal: null, feel: null, goal: null, with: null };

export const WITH_RX: Record<WithIngredient, RegExp> = {
  chicken: /\bchicken (thigh|breast)/i,
  turkey: /\bturkey\b/i,
  beans: /\b(beans?|lentils?|chickpeas?)\b/i,
  pasta: /\bpasta\b/i,
  potatoes: /\bpotato/i,
  cheese: /\b(cheese|cheddar|feta|parmesan)\b/i,
};
const WITH_SAVED_RX: Record<WithIngredient, RegExp> = { ...WITH_RX, chicken: /\bchicken\b(?! stock| broth)/i };

export type MoodShelf = Shelf & { loosened: string[] };

export function moodShelf(f: MoodFilters, ctx: Ctx): MoodShelf {
  type Rule = { label: string; ok: (s: SampleIdea) => boolean };
  const rules: Rule[] = [];
  if (f.with) rules.push({ label: `with ${f.with}`, ok: (s) => s.ingredients.some((i) => WITH_RX[f.with!].test(i.name)) });
  if (f.feel === "bbq") rules.push({ label: "on the BBQ", ok: (s) => s.equipment.includes("bbq") });
  if (ctx.moment.minutes !== null) rules.push({ label: `in ${ctx.moment.minutes} minutes`, ok: (s) => s.minutes <= ctx.moment.minutes! });
  if (f.meal) rules.push({ label: f.meal === "side" ? "a side dish" : f.meal === "snack" ? "a snack" : `for ${f.meal}`, ok: (s) => (f.meal === "snack" ? s.course === "snack" : f.meal === "side" ? s.course === "side" : s.course === "main") });

  // Loosen from the least important (with) to the most (meal).
  let active = rules;
  const loosened: string[] = [];
  let pool = ctx.samples.filter((s) => active.every((r) => r.ok(s)));
  while (!pool.length && active.length) {
    loosened.push(active[0].label);
    active = active.slice(1);
    pool = ctx.samples.filter((s) => active.every((r) => r.ok(s)));
  }

  const samples = pool.map((idea) => {
    const fit = pantryFit(idea.ingredients, ctx.pantry, ctx.answers, ctx.moment.today);
    const c = contextReasons(idea, fit, ctx.moment);
    const why: string[] = [];
    // With no meal chosen, lean towards dinner — it's the question being asked.
    let score = c.score + (!f.meal && idea.course === "main" ? 1.5 : 0);
    if (f.with && WITH_RX[f.with].test(idea.ingredients.map((i) => i.name).join("|"))) {
      why.push(`Made with ${idea.ingredients.find((i) => WITH_RX[f.with!].test(i.name))!.name}`);
    }
    if (f.feel === "comfort" && has(idea, "comfort")) { score += 4; why.push("Warm and comforting"); }
    if (f.feel === "fresh" && (has(idea, "fresh") || has(idea, "no-cook"))) { score += 4; why.push("Fresh and light"); }
    if (f.feel === "bbq") why.push("Made on the BBQ");
    if (f.goal === "protein" && has(idea, "protein")) { score += 4; why.push(`Built around ${proteinNames(idea).slice(0, 2).join(" and ")}`); }
    if (f.goal === "veg") { const n = vegCount(idea); score += n; if (n >= 3) why.push(`${n} kinds of vegetables`); }
    if (f.goal === "fibre") { const fib = fibreSources(idea.ingredients); score += fib.length * 3; if (fib.length) why.push(`Fibre from ${list(fib.slice(0, 2))}`); }
    const reasons = [...why, ...c.reasons.filter((r) => !why.includes(r))];
    return { idea, fit, reasons: reasons.length ? reasons : [describe(idea)], score };
  }).sort((a, b) => b.score - a.score || a.idea.minutes - b.idea.minutes).slice(0, 4);

  const saved: SavedSuggestion[] = [];
  const goalWords = f.goal === "protein" ? SAVED_WORDS.protein : f.goal === "veg" ? SAVED_WORDS.healthy : null;
  for (const r of ctx.saved) {
    const hay = `${r.title}\n${r.ingredients}\n${r.tags.join(" ")}`;
    const reasons: string[] = [];
    if (f.with) { const m = hay.match(WITH_SAVED_RX[f.with]); if (m) reasons.push(`Mentions ${m[0].toLowerCase()}`); else continue; }
    if (f.feel === "bbq") { const m = hay.match(SAVED_WORDS.bbq!); if (m) reasons.push(`Mentions ${m[0].toLowerCase()}`); else continue; }
    if (goalWords) { const m = hay.match(goalWords); if (m && !reasons.includes(`Mentions ${m[0].toLowerCase()}`)) reasons.push(`Mentions ${m[0].toLowerCase()}`); }
    if (r.favourite) reasons.push("★ You marked it a favourite");
    if (reasons.length) saved.push({ recipe: r, reasons });
  }
  return { samples, saved: saved.slice(0, 2), note: null, loosened };
}
