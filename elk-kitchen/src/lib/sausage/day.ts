// The live Sausage Day: one conversation for the whole cook, across every
// batch. "Chicken is done" → "Great! Let's weigh the chicken…"; "2.1 kilos"
// → the usable meat is updated; "yes" → the batches are divided.
//
// Plain rules, not AI: the same words always do the same thing, and every
// number can be explained. What was said is logged word for word. A change to
// the plan or to a recipe's seasoning is only made when the cook says it (or
// taps it), never on a guess. Recipes are never changed from here.

import type { CookingEntryInput, Recipe } from "../../types/recipe";
import type {
  DayAwaiting, DayEvent, DayPhoto, DayStepKey, DayTimer, MeatStatus, Preferences, Purchase, SausageDay, SausagePlan, SeasoningTweak,
} from "../../types/sausage";
import { newId } from "../recipeModel";
import { durationIn, durationText, quantityAt, grams, round, wordsToDigits } from "../cooking/parse";
import { cutOf, type Species } from "./cuts";
import {
  approve, costsFor, gramsText, money, planRecipe, seasoningsOf, tweakFor, usableOf, type RecipePlan,
} from "./plan";
import { fatComparison, recommend, substitutionNotes, todayFat } from "./allocate";
import { grindPhrase } from "./preferences";

// ── The record ───────────────────────────────────────────────────────────────

export function blankDay(seed: string | null = null): SausageDay {
  return {
    seed, meat: {}, equipment: [], scale: null, done: {}, tweaks: {}, optional: {}, storage: {}, photos: [], timers: [], log: [],
    awaiting: null, entries: {}, lastReply: "", finishedAt: null,
  };
}

const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeDay(raw: unknown): SausageDay | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Partial<SausageDay>;
  return {
    seed: typeof d.seed === "string" ? d.seed : null, meat: obj(d.meat, {}), equipment: arr(d.equipment),
    scale: typeof d.scale === "number" ? d.scale : null, done: obj(d.done, {}), tweaks: obj(d.tweaks, {}), optional: obj(d.optional, {}),
    storage: obj(d.storage, {}), photos: arr(d.photos), timers: arr(d.timers), log: arr(d.log), awaiting: d.awaiting ?? null,
    entries: obj(d.entries, {}), lastReply: typeof d.lastReply === "string" ? d.lastReply : "", finishedAt: d.finishedAt ?? null,
  };
}

export const dayOf = (p: SausagePlan): SausageDay => p.day ?? blankDay();
const withDay = (p: SausagePlan, f: (d: SausageDay) => SausageDay): SausagePlan => ({ ...p, day: f(dayOf(p)) });

export function logEvent(p: SausagePlan, at: string, kind: DayEvent["kind"], text: string, recipeId: string | null): SausagePlan {
  return withDay(p, (d) => ({ ...d, log: [...d.log, { id: newId(), at, kind, text, recipeId }] }));
}

// ── Steps ────────────────────────────────────────────────────────────────────

export type StepDef = { key: DayStepKey; n: number; label: string; scope: "day" | "batch" };
export const DAY_STEPS: StepDef[] = [
  { key: "grind", n: 1, label: "Finish grinding the meat", scope: "day" },
  { key: "weigh", n: 2, label: "Weigh the usable ground meat", scope: "day" },
  { key: "allocate", n: 3, label: "Divide the meat between the batches", scope: "day" },
  { key: "approve", n: 4, label: "Confirm the recipe changes", scope: "day" },
  { key: "weigh-seasonings", n: 5, label: "Weigh the seasonings", scope: "batch" },
  { key: "mix", n: 6, label: "Mix each batch", scope: "batch" },
  { key: "liquids", n: 7, label: "Add the cold liquids", scope: "batch" },
  { key: "bind", n: 8, label: "Mix until it binds", scope: "batch" },
  { key: "sample", n: 9, label: "Cook a taste-test sample", scope: "batch" },
  { key: "adjust", n: 10, label: "Adjust the seasoning", scope: "batch" },
  { key: "casings", n: 11, label: "Prepare the casings", scope: "day" },
  { key: "stuff", n: 12, label: "Stuff", scope: "batch" },
  { key: "link", n: 13, label: "Link", scope: "batch" },
  { key: "finished-weight", n: 14, label: "Weigh the finished sausages", scope: "batch" },
  { key: "store", n: 15, label: "Cook, fridge or freeze", scope: "batch" },
  { key: "photo", n: 16, label: "Photograph them", scope: "batch" },
  { key: "ratings", n: 17, label: "Family ratings", scope: "batch" },
];
export const stepDef = (k: DayStepKey) => DAY_STEPS.find((s) => s.key === k)!;
// The hands-on steps a later one implies ("stuffed" means it was mixed).
const CHAIN: DayStepKey[] = ["weigh-seasonings", "mix", "liquids", "bind", "sample", "adjust", "stuff", "link"];

export type Ctx = { recipes: Recipe[]; now: string; by: string; prefs: Preferences; ratings?: Record<string, number> };

// The plan's recipes, in the plan's order.
export const inPlanOrder = (p: SausagePlan, recipes: Recipe[]) => p.recipeIds.map((id) => recipes.find((r) => r.id === id)).filter((r): r is Recipe => !!r);

// Meat in use today (not set aside).
export const inUse = (p: SausagePlan) => p.purchases.filter((x) => dayOf(p).meat[x.id] !== "not-using");
const meatStatus = (p: SausagePlan, x: Purchase): MeatStatus => dayOf(p).meat[x.id] ?? "unknown";

const LIQUID = /\b(water|beer|sauce|syrup|milk|wine|stock|broth|juice)\b/i;
export function excludedOf(p: SausagePlan, recipe: Recipe): string[] {
  const chosen = dayOf(p).optional[recipe.id] ?? {};
  return seasoningsOf(recipe).filter((s) => s.optional && chosen[s.name.toLowerCase()] !== true).map((s) => s.name.toLowerCase());
}
export const recipePlanOf = (p: SausagePlan, r: Recipe): RecipePlan =>
  planRecipe(r, p.purchases, p.alloc[r.id] ?? {}, { tweaks: dayOf(p).tweaks[r.id], excluded: excludedOf(p, r) });

const hasLiquid = (rp: RecipePlan) => rp.seasonings.some((x) => x.included && (x.s.basis === "volume" || LIQUID.test(x.s.name)));

export type StepState = StepDef & { done: boolean; pending: string[]; skipped: string[] };

export function stepStates(p: SausagePlan, recipes: Recipe[], ratings: Record<string, number> = {}): StepState[] {
  const d = dayOf(p);
  const used = inUse(p);
  const chosen = recipes.filter((r) => p.recipeIds.includes(r.id));
  const manual = d.done[""] ?? [];
  return DAY_STEPS.map((def) => {
    if (def.scope === "day") {
      let done = manual.includes(def.key);
      if (def.key === "grind") done ||= used.length > 0 && used.every((x) => meatStatus(p, x) === "ground");
      if (def.key === "weigh") done ||= used.length > 0 && used.every((x) => x.usableG != null && x.usableG > 0);
      if (def.key === "allocate") done ||= chosen.length > 0 && chosen.every((r) => Object.values(p.alloc[r.id] ?? {}).some((g) => g > 0));
      if (def.key === "approve") done = p.status === "approved";
      return { ...def, done, pending: [], skipped: [] };
    }
    const pending: string[] = [];
    const skipped: string[] = [];
    for (const r of chosen) {
      const marks = d.done[r.id] ?? [];
      let ok = marks.includes(def.key);
      if (def.key === "liquids" && !hasLiquid(recipePlanOf(p, r))) { skipped.push(r.id); ok = true; }
      if (def.key === "finished-weight") ok ||= (p.results[r.id]?.finishedG ?? 0) > 0;
      if (def.key === "store") ok ||= !!d.storage[r.id];
      if (def.key === "photo") ok ||= d.photos.some((x) => x.recipeId === r.id && x.phase === "after");
      if (def.key === "ratings") ok ||= (ratings[r.id] ?? 0) > 0;
      if (!ok) pending.push(r.id);
    }
    return { ...def, done: chosen.length > 0 && pending.length === 0, pending, skipped };
  });
}

export function progressOf(states: StepState[], recipeCount: number) {
  let total = 0, done = 0;
  for (const s of states) {
    if (s.scope === "day") { total += 1; done += s.done ? 1 : 0; }
    else { total += recipeCount; done += recipeCount - s.pending.length; }
  }
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, current: states.find((s) => !s.done) ?? null };
}

// ── Names in what was said ───────────────────────────────────────────────────

const speciesWord = (sp: Species) => (sp === "poultry" ? "chicken" : sp === "fat" ? "pork fat" : sp);
const SPECIES_SAID: [RegExp, Species][] = [
  [/\b(chicken|thighs?|poultry)\b/, "poultry"],
  [/\b(pork|butts?|shoulder)\b/, "pork"],
  [/\b(beef|eye of round|eye round|round)\b/, "beef"],
];

export function meatIn(text: string, purchases: Purchase[]): { ids: string[]; label: string } | null {
  const t = text.toLowerCase();
  for (const [re, sp] of SPECIES_SAID) {
    if (!re.test(t)) continue;
    const of = purchases.filter((p) => { const s = cutOf(p.name).species; return (s === "fat" ? "pork" : s) === sp; });
    if (!of.length) return null;
    if (of.length > 1) {
      // "the first butt", "pork butt 2", "#1" — said apart from any weight.
      const u = t.replace(/\d+(?:[.,]\d+)?\s*(kg|kgs|kilos?|kilograms?|g|grams?|lbs?|pounds?)\b/g, " ");
      const n = /\b(first|1st)\b|#\s*1\b|\b(number|butt|package|pack) 1\b/.test(u) ? 0 : /\b(second|2nd)\b|#\s*2\b|\b(number|butt|package|pack) 2\b/.test(u) ? 1 : -1;
      if (n >= 0) return { ids: [of[n].id], label: of[n].name };
    }
    return { ids: of.map((p) => p.id), label: of.length > 1 ? `${speciesWord(sp)} (${of.map((p) => p.name).join(" + ")})` : speciesWord(sp) };
  }
  return null;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ""));
const NOT_A_NAME = new Set(["sausage", "sausag", "recipe", "batch"]);

export function recipesIn(text: string, recipes: Recipe[]): Recipe[] {
  if (/\b(all (of )?(the )?(batches|sausages|of them|four|recipes)|every (batch|one)|each batch|everything|all four)\b/i.test(text)) return recipes;
  const said = words(text);
  return recipes.filter((r) => words(r.title).filter((w) => !NOT_A_NAME.has(w)).some((tw) => said.some((w) => w.startsWith(tw) || tw.startsWith(w))));
}

function weightIn(t: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|kilograms?|g|grams?|lbs?|pounds?)\b/i.exec(t);
  if (!m) return null;
  const q = quantityAt(`${m[1]} ${m[2]}`);
  const g = q ? grams(q.qty) : null;
  return g != null && g > 0 ? Math.round(g) : null;
}
const percentIn = (t: string) => { const m = /(\d+(?:[.,]\d+)?)\s*(%|percent|per cent)/.exec(t); return m ? Number(m[1].replace(",", ".")) : null; };
const gramsSaid = (t: string) => { const m = /(\d+(?:[.,]\d+)?)\s*(g|grams?)\b/.exec(t); return m ? Number(m[1].replace(",", ".")) : null; };

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|ready|let'?s (do it|go)|go ahead|do it|sounds good|looks good|please|approve( it| anyway)?|lock it in|perfect|great)\b/;
// Only a plain "no" on its own: "no cayenne in the smokies" is an answer, not a refusal.
const NO = /^(no|nope|not yet|wait|hold on|cancel|never ?mind|no thanks?)$/;

// Weights to keep or say back: as precise as they were given ("3.95 kg", "520 g").
export const exactKg = (g: number) => (Math.abs(g) >= 1000 ? `${round(g / 1000)} kg` : `${Math.round(g)} g`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── Changes (used by voice and by taps alike) ────────────────────────────────

export function setMeatStatus(p: SausagePlan, ids: string[], status: MeatStatus): SausagePlan {
  return withDay(p, (d) => ({ ...d, meat: { ...d.meat, ...Object.fromEntries(ids.map((id) => [id, status])) } }));
}

// A weight for one or more packages weighed together is shared by their bought weights.
export function setUsable(p: SausagePlan, ids: string[], g: number): SausagePlan {
  const of = p.purchases.filter((x) => ids.includes(x.id));
  const bought = of.reduce((n, x) => n + (x.weightG ?? 0), 0);
  let given = 0;
  const share = new Map(of.map((x, i) => {
    const v = i === of.length - 1 ? g - given : Math.round(bought ? (g * (x.weightG ?? 0)) / bought : g / of.length);
    given += v;
    return [x.id, v];
  }));
  const next = { ...p, purchases: p.purchases.map((x) => (share.has(x.id) ? { ...x, usableG: share.get(x.id)! } : x)) };
  return p.status === "approved" ? { ...next, status: "draft" } : next;
}

export function applyRecommendation(p: SausagePlan, recipes: Recipe[], scale?: number): SausagePlan {
  const chosen = recipes.filter((r) => p.recipeIds.includes(r.id));
  const rec = recommend(p, chosen, scale);
  return withDay({ ...p, alloc: rec.alloc, status: "draft" }, (d) => ({ ...d, scale: rec.scale }));
}

export function setTweak(p: SausagePlan, recipeId: string, t: SeasoningTweak): SausagePlan {
  const next = withDay(p, (d) => ({ ...d, tweaks: { ...d.tweaks, [recipeId]: [...(d.tweaks[recipeId] ?? []).filter((x) => x.name.toLowerCase() !== t.name.toLowerCase()), t] } }));
  return p.status === "approved" ? { ...next, status: "draft" } : next;
}

export function setOptional(p: SausagePlan, recipeId: string, name: string, on: boolean): SausagePlan {
  const next = withDay(p, (d) => ({ ...d, optional: { ...d.optional, [recipeId]: { ...(d.optional[recipeId] ?? {}), [name.toLowerCase()]: on } } }));
  return p.status === "approved" ? { ...next, status: "draft" } : next;
}

// Ticking a hands-on step ticks the ones before it for that batch too.
export function markStep(p: SausagePlan, recipeId: string, key: DayStepKey, on = true): SausagePlan {
  return withDay(p, (d) => {
    const cur = new Set(d.done[recipeId] ?? []);
    const i = CHAIN.indexOf(key);
    const keys = on && i >= 0 && recipeId ? CHAIN.slice(0, i + 1) : [key];
    for (const k of keys) on ? cur.add(k) : cur.delete(k);
    return { ...d, done: { ...d.done, [recipeId]: [...cur] } };
  });
}

export function setStorage(p: SausagePlan, recipeId: string, how: SausageDay["storage"][string]): SausagePlan {
  return withDay(p, (d) => ({ ...d, storage: { ...d.storage, [recipeId]: how } }));
}

export function setResult(p: SausagePlan, recipeId: string, patch: Partial<{ finishedG: number | null; count: number | null; servings: number | null }>): SausagePlan {
  return { ...p, results: { ...p.results, [recipeId]: { ...(p.results[recipeId] ?? { finishedG: null, count: null, servings: null }), ...patch } } };
}

export function addDayPhoto(p: SausagePlan, photo: DayPhoto): SausagePlan {
  return withDay(p, (d) => ({ ...d, photos: [...d.photos, photo] }));
}

export function startDayTimer(p: SausagePlan, seconds: number, label: string, now: string): SausagePlan {
  const t: DayTimer = { id: newId(), label, seconds, endsAt: new Date(Date.parse(now) + seconds * 1000).toISOString(), done: false, cancelled: false };
  return logEvent(withDay(p, (d) => ({ ...d, timers: [...d.timers, t] })), now, "timer", `${label}: ${durationText(seconds)} timer started.`, null);
}
export function endDayTimer(p: SausagePlan, id: string, how: "done" | "cancelled", now: string): SausagePlan {
  const t = dayOf(p).timers.find((x) => x.id === id);
  if (!t || t.done || t.cancelled) return p;
  const next = withDay(p, (d) => ({ ...d, timers: d.timers.map((x) => (x.id === id ? { ...x, done: how === "done", cancelled: how === "cancelled" } : x)) }));
  return logEvent(next, now, "timer", `${t.label} timer ${how === "done" ? "finished" : "cancelled"}.`, null);
}
export const liveTimers = (p: SausagePlan) => dayOf(p).timers.filter((t) => !t.done && !t.cancelled);

export function approveDay(p: SausagePlan, recipes: Recipe[], prefs: Preferences, by: string, now: string): SausagePlan {
  const rps = recipes.filter((r) => p.recipeIds.includes(r.id)).map((r) => recipePlanOf(p, r));
  return approve(p, rps, prefs, by, now);
}

// ── Questions only the cook can answer ───────────────────────────────────────

export type Question = { recipeId: string; key: string; text: string; chips: string[] };

export function openQuestions(p: SausagePlan, recipes: Recipe[]): Question[] {
  const d = dayOf(p);
  const out: Question[] = [];
  for (const r of inPlanOrder(p, recipes)) {
    const tw = d.tweaks[r.id] ?? [];
    const short = r.title.replace(/\s+sausage$/i, "");
    if (/\bless salt\b/i.test(r.notes) && !tweakFor(tw, "salt")) {
      out.push({ recipeId: r.id, key: "salt", text: `${r.title}: the card's note says “a little less salt”. Keep the card's salt, or go 5, 10 or 15% less?`, chips: [`${short} keep the salt`, `${short} 5% less salt`, `${short} 10% less salt`, `${short} 15% less salt`] });
    }
    if (/\bcayenne\b/i.test(r.notes) && !tweakFor(tw, "cayenne")) {
      out.push({ recipeId: r.id, key: "cayenne", text: `${r.title}: the note says the original cook used cayenne too, but the card gives no amount. How many grams of cayenne, or none?`, chips: [`No cayenne in the ${short}`, `${short} 1 g cayenne`, `${short} 2 g cayenne`] });
    }
    const chosen = d.optional[r.id] ?? {};
    for (const s of seasoningsOf(r).filter((x) => x.optional && chosen[x.name.toLowerCase()] === undefined)) {
      out.push({ recipeId: r.id, key: `opt:${s.name.toLowerCase()}`, text: `${r.title}: ${s.name} is optional on the card. In or out today?`, chips: [`Add the ${s.name.toLowerCase()} to the ${short}`, `Skip the ${s.name.toLowerCase()}`] });
    }
  }
  return out;
}

// ── What to do next, as a chef would say it ──────────────────────────────────

export function nextAction(p: SausagePlan, recipes: Recipe[], ratings: Record<string, number> = {}): { text: string; chips: string[] } {
  const states = stepStates(p, recipes, ratings);
  const cur = progressOf(states, p.recipeIds.length).current;
  const titles = (ids: string[]) => list(ids.map((id) => recipes.find((r) => r.id === id)?.title ?? "a batch"));
  if (!cur) return { text: "Every batch is made, recorded and rated. That's Sausage Day done — well cooked!", chips: [] };
  const used = inUse(p);
  switch (cur.key) {
    case "grind": {
      const grinding = used.filter((x) => meatStatus(p, x) === "grinding");
      const unknown = used.filter((x) => meatStatus(p, x) === "unknown");
      const parts: string[] = [];
      const chips: string[] = [];
      if (grinding.length) { parts.push(`The ${list([...new Set(grinding.map(shortMeat))])} ${grinding.length > 1 ? "are" : "is"} going through the grinder — say “${shortMeat(grinding[0])} is done” when it's finished.`); chips.push(`${cap(shortMeat(grinding[0]))} is done`); }
      if (unknown.length) { parts.push(`Is the ${list(unknown.map(shortMeat))} ground yet?`); for (const u of unknown) chips.push(`${cap(shortMeat(u))} is done`, `Grinding the ${shortMeat(u)}`, `Not using the ${shortMeat(u)}`); }
      return { text: parts.join(" "), chips };
    }
    case "weigh": {
      const todo = used.filter((x) => !(x.usableG && x.usableG > 0));
      return { text: `Weigh the usable ground ${list(todo.map(shortMeat))} and tell me, like “the ${shortMeat(todo[0])} is ${kgSay(usableOf(todo[0]).g)}”. Until then I use estimates.`, chips: [`Divide the batches`] };
    }
    case "allocate": return { text: "Ready to divide the batches? I'll keep each card's meat ratios.", chips: ["Divide the batches"] };
    case "approve": {
      const q = openQuestions(p, recipes);
      if (q.length) return { text: `Before we lock it in: ${q[0].text}`, chips: q[0].chips };
      return { text: "Look over the split and seasonings, then say “approve” to lock in today's batches.", chips: ["Approve the plan"] };
    }
    case "casings": return { text: "Get the casings ready: rinse them inside and out with cool water and keep them wet. Say “casings are ready”.", chips: ["Casings are ready"] };
    case "photo": return { text: `Photo time! Take an “after” picture of the ${titles(cur.pending)}.`, chips: [] };
    case "ratings": return { text: `Taste-test time: have everyone rate the ${titles(cur.pending)}.`, chips: [] };
    case "finished-weight": return { text: `Weigh the finished ${titles(cur.pending)} and count the links — say “${short(recipes, cur.pending[0])} made 24 sausages, 4 kilos”.`, chips: [] };
    case "store": return { text: `Where are the ${titles(cur.pending)} going: cooked now, the fridge (1–2 days) or the freezer?`, chips: cur.pending.slice(0, 1).flatMap((id) => [`${cap(short(recipes, id))} in the freezer`, `${cap(short(recipes, id))} in the fridge`]) };
    default: {
      const id = cur.pending[0];
      const tip = STEP_TIP[cur.key] ?? "";
      return { text: `${cur.label}: ${titles(cur.pending)}.${tip ? ` ${tip}` : ""}`, chips: [`${cap(short(recipes, id))} ${SAID_DONE[cur.key] ?? "done"}`, ...(cur.pending.length > 1 ? [`All ${SAID_DONE[cur.key] ?? "done"}`] : [])] };
    }
  }
}

const SAID_DONE: Partial<Record<DayStepKey, string>> = {
  "weigh-seasonings": "seasonings weighed", mix: "is mixed", liquids: "liquids added", bind: "has a good bind", sample: "tasted", adjust: "tastes right", stuff: "is stuffed", link: "is linked",
};
const STEP_TIP: Partial<Record<DayStepKey, string>> = {
  "weigh-seasonings": "Amounts are on each batch's card, in grams.",
  mix: "One batch at a time, cold hands, cold bowl.",
  liquids: "Cold liquids only — they help the bind and keep the fat from smearing.",
  bind: "Mix until it turns sticky and a ball holds to your palm upside down — 1 to 3 minutes.",
  sample: "Fry a small patty and cook it right through before tasting. Keep the rest in the fridge.",
  adjust: "Happy with it? Or tell me a change, like “breakfast more pepper 10%”.",
  stuff: "Fill firmly with no air pockets; keep the casing wet.",
  link: "Twist alternate directions; prick any air bubbles with a clean pin.",
};
const shortMeat = (x: Purchase) => { const s = cutOf(x.name).species; return s === "poultry" ? "chicken" : s === "fat" ? "pork fat" : s === "other" ? x.name.toLowerCase() : s; };
const short = (recipes: Recipe[], id: string | undefined) => (recipes.find((r) => r.id === id)?.title ?? "it").replace(/\s+sausage$/i, "").toLowerCase();
const kgSay = (g: number | null) => (g ? `${Math.round(g / 100) / 10} kilos` : "2 kilos");

// ── Celebrations ─────────────────────────────────────────────────────────────

const CHEER: Partial<Record<DayStepKey, string>> = {
  grind: "All the meat is ground!", weigh: "All the meat is weighed.", allocate: "The batches are divided.", approve: "Plan locked in — let's season!",
  "weigh-seasonings": "Every batch's seasonings are weighed.", mix: "Every batch is mixed.", liquids: "Cold liquids are in, every batch.", bind: "Every batch has a good bind.",
  adjust: "Seasoning's right on every batch.", sample: "Every batch has been taste-tested.", casings: "Casings are ready.", stuff: "Everything's stuffed!",
  link: "Every batch is linked!", "finished-weight": "Every batch is weighed — the sausage counter's up to date.", photo: "Every batch has its photo.",
  ratings: "Every batch has been rated by the family!",
};

export function celebrate(before: SausagePlan, after: SausagePlan, recipes: Recipe[], now: string, ratings: Record<string, number> = {}): { plan: SausagePlan; cheer: string } {
  const was = new Set(stepStates(before, recipes, ratings).filter((s) => s.done).map((s) => s.key));
  const newly = stepStates(after, recipes, ratings).filter((s) => s.done && !was.has(s.key));
  let plan = after;
  const cheers = newly.map((s) => CHEER[s.key] ?? `${s.label} — done.`);
  for (const c of cheers) plan = logEvent(plan, now, "celebrate", c, null);
  return { plan, cheer: cheers.join(" ") };
}

// ── The conversation ─────────────────────────────────────────────────────────

export type Heard = { plan: SausagePlan; reply: string; chips: string[] };

export function hearDay(p0: SausagePlan, said: string, ctx: Ctx): Heard {
  const text = said.trim();
  let p = logEvent(p0, ctx.now, "said", text, null);
  if (!text) return { plan: p0, reply: "", chips: [] };
  const t = wordsToDigits(text.toLowerCase().replace(/[’']/g, "'")).replace(/(\d+)\s+point\s+(\d+)/g, "$1.$2").replace(/[!?]+$/, "").replace(/\.$/, "").trim();
  const recipes = inPlanOrder(p, ctx.recipes);
  const res = understand(p, t, { ...ctx, recipes });
  p = res.plan;
  const c = celebrate(p0, p, recipes, ctx.now, ctx.ratings);
  p = c.plan;
  let reply = [c.cheer, res.reply].filter(Boolean).join(" ");
  let chips = res.chips;
  if (res.addNext) {
    const n = nextAction(p, recipes, ctx.ratings);
    reply = `${reply} ${n.text}`.trim();
    chips = chips.length ? chips : n.chips;
  }
  p = withDay(p, (d) => ({ ...d, lastReply: reply }));
  return { plan: p, reply, chips };
}

type Inner = { plan: SausagePlan; reply: string; chips: string[]; addNext?: boolean };

function understand(p: SausagePlan, t: string, ctx: Ctx): Inner {
  const d = dayOf(p);
  const recipes = ctx.recipes;
  const aw = d.awaiting;
  const clear = (x: SausagePlan) => withDay(x, (dd) => ({ ...dd, awaiting: null }));
  const ask = (x: SausagePlan, a: DayAwaiting) => withDay(x, (dd) => ({ ...dd, awaiting: a }));
  const named = recipesIn(t, recipes);
  const meat = meatIn(t, p.purchases);
  const w = weightIn(t);

  // 1. Answers to what Kitchen just asked.
  if (aw && YES.test(t)) {
    if (aw.kind === "divide") return divide(clear(p), recipes, ctx.now);
    if (aw.kind === "approve") return doApprove(clear(p), ctx, true);
    if (aw.kind === "tweak") {
      const next = logEvent(setTweak(clear(p), aw.recipeId, aw.tweak), ctx.now, "adjust", tweakWords(aw.tweak, recipes, aw.recipeId), aw.recipeId);
      return { plan: next, reply: `Done: ${tweakWords(aw.tweak, recipes, aw.recipeId)} The card itself is unchanged.`, chips: [], addNext: true };
    }
  }
  if (aw && NO.test(t)) return { plan: clear(p), reply: "OK, I've left it as it was.", chips: [], addNext: true };
  if (aw?.kind === "usable" && w && !named.length) return weighed(clear(p), aw.purchaseIds, w, ctx.now);
  if (aw?.kind === "cayenne" && (gramsSaid(t) != null || /\b(none|no|zero|skip)\b/.test(t))) return cayenne(clear(p), aw.recipeId, gramsSaid(t) ?? 0, ctx, recipes);
  if (aw?.kind === "tweak-amount") {
    const pct = percentIn(t);
    if (pct != null || /\b(keep|as (it is|written)|no change|leave it)\b/.test(t)) {
      const less = /\bmore\b/.test(t) ? 1 : -1;
      const tw: SeasoningTweak = { name: aw.name, percent: pct == null ? 0 : less * pct, grams: null, reason: pct == null ? "kept the card's amount" : `${pct}% ${less < 0 ? "less" : "more"} (${aw.reason})`, by: ctx.by, at: ctx.now };
      const next = logEvent(setTweak(clear(p), aw.recipeId, tw), ctx.now, "adjust", tweakWords(tw, recipes, aw.recipeId), aw.recipeId);
      return { plan: next, reply: `${tweakWords(tw, recipes, aw.recipeId)} The card itself is unchanged.`, chips: [], addNext: true };
    }
  }

  // 2. Questions.
  if (/\b(what'?s next|what now|what do (i|we) do|where are we|next step|what should (i|we) do)\b/.test(t)) {
    return { plan: p, reply: nextAction(p, recipes, ctx.ratings).text, chips: nextAction(p, recipes, ctx.ratings).chips };
  }
  if (/\bhow much meat\b|\bwhat meat\b|\bmeat (do )?we have\b/.test(t)) return { plan: p, reply: meatSummary(p), chips: [] };
  if (/\b(temperature|temp|how hot|cook (them|it) to|safe to eat|internal)\b/.test(t)) {
    const rs = named.length ? named : recipes;
    return { plan: p, reply: rs.map((r) => `${r.title}: ${recipePlanOf(p, r).poultry ? "74 °C (165 °F) — it has chicken" : "71 °C (160 °F)"}`).join(". ") + ". Check the centre of the thickest one with a probe.", chips: [] };
  }
  if (/\b(cost|costs|spent|price)\b/.test(t)) return { plan: p, reply: costSummary(p, recipes), chips: [] };
  if (/\bhow many sausages\b|\bsausage count\b|\bcounter\b/.test(t)) return { plan: p, reply: countSummary(p, recipes), chips: [] };
  const howMuch = /how (?:much|many)\s+(?:grams of\s+)?(?:the\s+)?([a-z ,]+?)(?:\s+(?:do|does|should|goes|go|for|in|to)\b.*)?$/.exec(t);
  if (howMuch && !/\bmeat\b/.test(howMuch[1])) {
    const want = howMuch[1].replace(/\b(of|the|a|some)\b/g, " ").trim();
    const rs = named.length ? named : recipes;
    const hits = rs.flatMap((r) => recipePlanOf(p, r).seasonings.filter((x) => x.included && (x.s.name.toLowerCase().includes(want) || want.includes(x.s.name.toLowerCase()))).map((x) => `${r.title} ${x.s.name.toLowerCase()}: ${x.text || "no amount on the card"}${x.tweak && x.recipeText ? ` (card: ${x.recipeText})` : ""}`));
    if (hits.length) return { plan: p, reply: `${hits.join(". ")}.`, chips: [] };
  }

  // 3. Timers.
  if (/\btimer\b|\bremind me\b/.test(t)) {
    const secs = durationIn(t);
    if (secs) {
      const label = (/\bfor (?:the )?(.+?)(?:\s+timer)?$/.exec(t.replace(/\d+(?:\.\d+)?\s*(hours?|minutes?|mins?|seconds?)/g, ""))?.[1] ?? "").trim() || (named[0]?.title ?? "Sausage day");
      return { plan: startDayTimer(p, secs, cap(label), ctx.now), reply: `${durationText(secs)} timer started${label ? ` for ${label}` : ""}.`, chips: [] };
    }
  }

  // 4. Seasoning changes and the cook's decisions.
  if (/\bcayenne\b/.test(t)) {
    const r = named[0] ?? recipes.find((x) => /\bcayenne\b/i.test(x.notes));
    if (r) {
      const g = gramsSaid(t);
      if (g != null || /\b(no|none|skip|without)\b/.test(t)) return cayenne(p, r.id, g ?? 0, ctx, recipes);
      return { plan: ask(p, { kind: "cayenne", recipeId: r.id }), reply: `How many grams of cayenne in the ${r.title}? The card doesn't say, so I won't guess.`, chips: ["1 g", "2 g", "No cayenne"] };
    }
  }
  const opt = optionalIn(t, recipes, named);
  if (opt) {
    const next = logEvent(setOptional(p, opt.recipe.id, opt.name, opt.on), ctx.now, "adjust", `${opt.recipe.title}: ${opt.on ? "with" : "no"} ${opt.name.toLowerCase()} today.`, opt.recipe.id);
    const amt = opt.on ? recipePlanOf(next, opt.recipe).seasonings.find((x) => x.s.name.toLowerCase() === opt.name.toLowerCase())?.text : "";
    return { plan: next, reply: `${opt.recipe.title}: ${opt.on ? `${opt.name.toLowerCase()} in${amt ? ` — ${amt}` : " — the card gives no amount, so add what you like"}` : `no ${opt.name.toLowerCase()} today`}.`, chips: [], addNext: true };
  }
  const tw = /\b(less|more|reduce|cut back on|extra)\b\s*(?:the\s+)?([a-z ]+?)?(?:\s+by)?\s*(\d+(?:\.\d+)?\s*(?:%|percent|per cent))?$/.exec(t) ?? null;
  const tweakName = tw ? seasoningNamed(t, recipes, named) : null;
  if (tw && !tweakName && !named.length) {
    // "More pepper" with no batch named, and several batches have pepper: ask, don't pick one.
    const having = recipes.filter((r) => seasoningNamed(t, [r], [r]));
    if (having.length > 1) return { plan: p, reply: `Which batch — ${list(having.map((r) => r.title))}?`, chips: having.map((r) => `${cap(short(recipes, r.id))} ${t}`) };
  }
  if (tw && tweakName) {
    const r = tweakName.recipe;
    const pct = percentIn(t);
    const more = /\b(more|extra)\b/.test(t);
    if (/\bkeep\b/.test(t)) {
      const k: SeasoningTweak = { name: tweakName.name, percent: 0, grams: null, reason: "kept the card's amount", by: ctx.by, at: ctx.now };
      return { plan: logEvent(setTweak(p, r.id, k), ctx.now, "adjust", tweakWords(k, recipes, r.id), r.id), reply: tweakWords(k, recipes, r.id), chips: [], addNext: true };
    }
    const reason = /\bless salt\b/i.test(r.notes) && /salt/i.test(tweakName.name) && !more ? "the card's note: “a little less salt”" : "your call on the day";
    if (pct == null) {
      return { plan: ask(p, { kind: "tweak-amount", recipeId: r.id, name: tweakName.name, reason }), reply: `How much ${more ? "more" : "less"} ${tweakName.name.toLowerCase()} in the ${r.title}? 5, 10 or 15 percent?`, chips: [`5%`, `10%`, `15%`, "Keep the card's amount"] };
    }
    const k: SeasoningTweak = { name: tweakName.name, percent: (more ? 1 : -1) * pct, grams: null, reason: `${pct}% ${more ? "more" : "less"} (${reason})`, by: ctx.by, at: ctx.now };
    const next = logEvent(setTweak(p, r.id, k), ctx.now, "adjust", tweakWords(k, recipes, r.id), r.id);
    return { plan: next, reply: `${tweakWords(k, recipes, r.id)} The card itself is unchanged.`, chips: [], addNext: true };
  }
  if (/\bkeep (the )?(salt|card)/.test(t) && named[0]) {
    const k: SeasoningTweak = { name: "Salt", percent: 0, grams: null, reason: "kept the card's amount", by: ctx.by, at: ctx.now };
    return { plan: logEvent(setTweak(p, named[0].id, k), ctx.now, "adjust", tweakWords(k, recipes, named[0].id), named[0].id), reply: tweakWords(k, recipes, named[0].id), chips: [], addNext: true };
  }

  // 5. Results: "breakfast made 32 sausages, 4.1 kilos".
  if (named.length === 1 && /\b(made|makes|came out|finished|yield|links|sausages|smokies|brats|weighs|weigh|weighed|count)\b/.test(t) && !meat) {
    const n = /(\d+)\s*(sausages|links|pieces|smokies|brats|of them)\b/.exec(t);
    const count = n ? Number(n[1]) : null;
    if (count != null || w) {
      const r = named[0];
      let next = setResult(p, r.id, { ...(count != null ? { count } : {}), ...(w ? { finishedG: w } : {}) });
      const parts = [count != null ? `${count} sausages` : "", w ? `${exactKg(w)} finished` : ""].filter(Boolean).join(", ");
      next = logEvent(next, ctx.now, "result", `${r.title}: ${parts}.`, r.id);
      const c = costsFor(recipePlanOf(next, r), next.results[r.id]);
      const cost = c.perSausage != null ? ` That's ${money(c.perSausage)} of meat per sausage.` : c.perKg != null && c.perKgBasis === "finished" ? ` Meat cost ${money(c.perKg)} per finished kg.` : "";
      return { plan: next, reply: `Recorded: ${r.title}, ${parts}.${cost}`, chips: [], addNext: true };
    }
  }

  // 6. Storage.
  if (named.length && /\b(freezer|frozen|freeze|froze|fridge|refrigerat\w*|cooked them|cooking them|cook them now|eating them)\b/.test(t)) {
    const how = /\b(freezer|frozen|freeze|froze)\b/.test(t) ? "freezer" : /\b(fridge|refrigerat\w*)\b/.test(t) ? "fridge" : "cooked";
    let next = p;
    for (const r of named) next = logEvent(setStorage(next, r.id, how), ctx.now, "step", `${r.title}: ${how === "cooked" ? "cooked" : `into the ${how}`}.`, r.id);
    const temps = named.map((r) => `${r.title} ${recipePlanOf(p, r).poultry ? "74 °C" : "71 °C"}`).join(", ");
    const safe = how === "fridge" ? " Fresh sausage keeps 1–2 days in the fridge; freeze anything you won't cook by then." : how === "freezer" ? " Label each pack with the name and today's date." : ` Cook to the centre: ${temps}.`;
    const fresh = named.some((r) => /\bsmok/i.test(r.title)) ? " The smokies are raw fresh sausage — not shelf-stable or ready-to-eat." : "";
    return { plan: next, reply: `${list(named.map((r) => r.title))}: ${how === "cooked" ? "cooking now" : `into the ${how}`}.${safe}${fresh}`, chips: [], addNext: true };
  }

  // 7. Meat: ground, grinding, weighed, not using.
  if (meat) {
    const ids = meat.ids;
    if (w) return weighed(p, ids, w, ctx.now);
    if (/\b(not using|won'?t use|skip|leave out|save (it|the \w+) for later|keep (it|the \w+) for later|not today)\b/.test(t)) {
      const next = logEvent(setMeatStatus(p, ids, "not-using"), ctx.now, "meat", `${cap(meat.label)}: not using today.`, null);
      return { plan: next, reply: `OK, the ${meat.label} stays out of today's batches. I'll divide the rest.`, chips: [], addNext: true };
    }
    if (/\b(grinding|starting|start|going through|on now|in the grinder|next up)\b/.test(t) && !/\b(done|finished|ground)\b/.test(t)) {
      const next = logEvent(setMeatStatus(p, ids, "grinding"), ctx.now, "meat", `${cap(meat.label)} going through the grinder.`, null);
      const g = grindPhrase(ctx.prefs);
      return { plan: next, reply: `${cap(meat.label)} is in the grinder${g ? ` — ${g}` : ""}. Keep it cold; if the fat smears, stop and chill everything for 20–30 minutes.${/chicken/.test(meat.label) ? " Raw chicken: wash hands and tools after." : ""}`, chips: [`${cap(meat.label.split(" (")[0])} is done`] };
    }
    if (/\b(done|finished|ground|complete|completed|through|ready)\b/.test(t)) {
      let next = logEvent(setMeatStatus(p, ids, "ground"), ctx.now, "meat", `${cap(meat.label)} ground — done.`, null);
      next = ask(next, { kind: "usable", purchaseIds: ids, label: meat.label });
      const into = ` Back in the fridge with it as soon as it's weighed.`;
      return { plan: next, reply: `Great! Let's weigh the ${meat.label}. How much usable meat did we get?${into}`, chips: [] };
    }
  }

  // 8. Dividing, scaling, approving.
  if (/\b(divide|split|allocate|share out|plan the batches|recommend)\b/.test(t) || (/\bbatches\b/.test(t) && /\b(ready|go|do)\b/.test(t))) {
    const m = /\b(\d+(?:\.\d+)?)\s*(x|times)\b/.exec(t);
    return divide(p, recipes, ctx.now, m ? Number(m[1]) : /\b(as written|original amounts?|the cards?)\b/.test(t) ? 1 : /\b(all|max|most|bigger|as much)\b/.test(t) ? Infinity : undefined);
  }
  if (/\b(as written|original amounts?)\b/.test(t)) return divide(p, recipes, ctx.now, 1);
  if (/\b(use (all|as much)|bigger batches|max(imum)?)\b/.test(t)) return divide(p, recipes, ctx.now, Infinity);
  if (/\b(approve|lock (it )?in|confirm (the )?(plan|batches)|finali[sz]e)\b/.test(t)) return doApprove(p, ctx, /\banyway\b/.test(t));

  // 9. Batch steps.
  if (/\bcasings?\b/.test(t) && /\b(ready|soak|soaking|soaked|rinsed|prepared|prepped|done|flushed)\b/.test(t)) {
    const next = logEvent(markStep(p, "", "casings"), ctx.now, "step", "Casings ready.", null);
    return { plan: next, reply: "Casings ready — keep them wet until they go on the stuffer.", chips: [], addNext: true };
  }
  const step = stepSaid(t);
  if (step) {
    let targets = named;
    if (!targets.length) {
      const s = stepStates(p, recipes, ctx.ratings).find((x) => x.key === step);
      const pend = s?.pending ?? [];
      if (/\b(all|everything|every)\b/.test(t)) targets = recipes;
      else if (pend.length === 1) targets = recipes.filter((r) => r.id === pend[0]);
      else return { plan: p, reply: `Which batch — ${list(recipes.map((r) => r.title))}?`, chips: recipes.map((r) => `${cap(short(recipes, r.id))} ${SAID_DONE[step] ?? "done"}`) };
    }
    let next = p;
    for (const r of targets) next = logEvent(markStep(next, r.id, step), ctx.now, "step", `${r.title}: ${DONE_WORDS[step] ?? `${stepDef(step).label.toLowerCase()} — done`}.`, r.id);
    const tip = AFTER[step]?.(targets.map((r) => recipePlanOf(next, r))) ?? "";
    return { plan: next, reply: `${list(targets.map((r) => r.title))}: ${DONE_WORDS[step] ?? `${stepDef(step).label.toLowerCase()} — done`}.${tip ? ` ${tip}` : ""}`, chips: [], addNext: true };
  }

  // 10. Notes, and anything else (kept, never guessed at).
  const note = /^(?:note|tasting note|remember)[:\s,]+(.+)$/.exec(t);
  const body = note ? note[1] : t;
  const next = logEvent(p, ctx.now, "note", cap(body), named[0]?.id ?? null);
  return {
    plan: next, chips: [],
    reply: note ? `Noted${named[0] ? ` for the ${named[0].title}` : ""}.` : `I kept that as a note${named[0] ? ` on the ${named[0].title}` : ""}. You can say things like “chicken is done”, “the beef is 4.1 kilos”, “divide the batches”, “breakfast is mixed” or “what's next?”.`,
  };
}

const DONE_WORDS: Partial<Record<DayStepKey, string>> = {
  "weigh-seasonings": "seasonings weighed", mix: "mixed", liquids: "cold liquids in", bind: "good bind", sample: "tasted", adjust: "seasoning's right", stuff: "stuffed", link: "linked",
};

const AFTER: Partial<Record<DayStepKey, (rps: RecipePlan[]) => string>> = {
  "weigh-seasonings": () => "Mix each batch separately, with cold hands and a cold bowl.",
  mix: (rps) => (rps.some(hasLiquid) ? "Now the cold liquids." : "Mix on until it binds."),
  liquids: () => "Keep mixing until it's sticky and holds together.",
  bind: (rps) => `Fry a small sample and cook it through${rps.some((r) => r.poultry) ? " — 74 °C, there's chicken in it" : " to 71 °C"} — then taste.`,
  sample: () => "How does it taste? Tell me a change, like “more pepper 10%”, or say it tastes right.",
  adjust: () => "Stuffing's next. Back in the fridge until then.",
  stuff: () => "Link them next. Prick any air pockets with a clean pin.",
  link: () => "Weigh the finished sausages and count them.",
};

function stepSaid(t: string): DayStepKey | null {
  if (/\b(spices?|seasonings?)\b.*\b(weighed|measured|ready|out|done)\b|\bweighed (out )?(the )?(spices?|seasonings?)\b/.test(t)) return "weigh-seasonings";
  if (/\b(liquids?|water|beer|sauce|syrup|worcestershire)\b.*\b(in|added|done)\b|\badded (the )?(liquids?|water|beer|sauce|syrup)\b/.test(t)) return "liquids";
  if (/\b(bind|bound|sticky|tacky)\b/.test(t)) return "bind";
  if (/\b(tastes? (good|great|right|perfect|fine)|no changes?|seasoning'?s? (is )?(good|right|perfect)|adjusted)\b/.test(t)) return "adjust";
  if (/\b(tasted|taste[- ]?test(ed)?|test patty|sample|fried (a )?(patty|sample))\b/.test(t)) return "sample";
  if (/\b(linked|linking (is )?done|twisted)\b/.test(t)) return "link";
  if (/\b(stuffed|stuffing (is )?(done|finished))\b/.test(t)) return "stuff";
  if (/\b(mixed|mixing (is )?(done|finished)|seasoned)\b/.test(t)) return "mix";
  return null;
}

function optionalIn(t: string, recipes: Recipe[], named: Recipe[]): { recipe: Recipe; name: string; on: boolean } | null {
  const on = /\b(add|with|use|include|yes to|put in)\b/.test(t);
  const off = /\b(skip|no|leave out|without|not using|don'?t use|drop)\b/.test(t);
  if (!on && !off) return null;
  for (const r of named.length ? named : recipes) {
    for (const s of seasoningsOf(r).filter((x) => x.optional)) {
      const key = s.name.toLowerCase().split(/\s+/)[0].replace(/s$/, "");
      if (t.includes(key) || (key === "cheddar" && /\bchees/.test(t))) return { recipe: r, name: s.name, on: on && !off };
    }
  }
  return null;
}

const GENERIC = new Set(["powder", "sauce", "dried", "black", "brown", "flakes", "cubes", "water", "smoked", "red"]);
const said = (t: string, w: string) => new RegExp(`\\b${w.replace(/[^a-z ]/g, "")}s?\\b`).test(t);

// The seasoning a change is about, and its batch. Null when unclear (two batches have it and neither was named).
function seasoningNamed(t: string, recipes: Recipe[], named: Recipe[]): { recipe: Recipe; name: string } | null {
  const pool = named.length ? named : recipes;
  const find = (r: Recipe) => {
    const ss = seasoningsOf(r);
    return ss.find((s) => said(t, s.name.toLowerCase().replace(/,.*$/, "")))
      ?? ss.find((s) => s.name.toLowerCase().replace(/,.*$/, "").split(/\s+/).some((w) => w.length >= 4 && !GENERIC.has(w) && said(t, w)));
  };
  const hits = pool.map((r) => ({ recipe: r, s: find(r) })).filter((x) => x.s);
  if (hits.length !== 1 && !(named.length && hits.length)) return null;
  return { recipe: hits[0].recipe, name: hits[0].s!.name };
}

function tweakWords(tw: SeasoningTweak, recipes: Recipe[], recipeId: string): string {
  const r = recipes.find((x) => x.id === recipeId);
  const name = tw.name.toLowerCase();
  if (tw.grams != null) return `${r?.title ?? "Batch"}: ${tw.grams ? `${tw.grams} g ${name}` : `no ${name}`} today.`;
  if (!tw.percent) return `${r?.title ?? "Batch"}: keeping the card's ${name}.`;
  return `${r?.title ?? "Batch"}: ${Math.abs(tw.percent)}% ${tw.percent < 0 ? "less" : "more"} ${name} today.`;
}

function cayenne(p: SausagePlan, recipeId: string, g: number, ctx: Ctx, recipes: Recipe[]): Inner {
  const tw: SeasoningTweak = { name: "Cayenne", percent: null, grams: g, reason: g ? "the cook's amount for this batch (the card gives none)" : "none today", by: ctx.by, at: ctx.now };
  const next = logEvent(setTweak(p, recipeId, tw), ctx.now, "adjust", tweakWords(tw, recipes, recipeId), recipeId);
  return { plan: next, reply: `${tweakWords(tw, recipes, recipeId)}${g ? " I'll add it to the weigh-out list." : ""}`, chips: [], addNext: true };
}

function weighed(p: SausagePlan, ids: string[], g: number, now: string): Inner {
  const of = p.purchases.filter((x) => ids.includes(x.id));
  const bought = of.reduce((n, x) => n + (x.weightG ?? 0), 0);
  let next = setUsable(p, ids, g);
  next = setMeatStatus(next, ids.filter((id) => dayOf(next).meat[id] !== "ground" && dayOf(next).meat[id] !== "not-using"), "ground");
  const name = of.length > 1 ? `${speciesWord(cutOf(of[0].name).species === "fat" ? "pork" : cutOf(of[0].name).species)} (both packages together)` : of[0]?.name.toLowerCase() ?? "meat";
  const loss = bought ? bought - g : null;
  const what = of.some((x) => x.skinOn) ? "bone, skin and trim" : of.some((x) => x.boneIn) ? "bone and trim" : "trim";
  const lossText = loss != null && loss > 0 ? ` (${exactKg(loss)} of ${what} — ${Math.round((loss / bought) * 100)}% of the ${exactKg(bought)} bought)` : loss != null && loss < 0 ? ` — that's more than the ${exactKg(bought)} on the label; check the scale` : "";
  next = logEvent(next, now, "weight", `${cap(name)}: ${exactKg(g)} usable${lossText}.`, null);
  const left = inUse(next).filter((x) => !(x.usableG && x.usableG > 0));
  const names = left.map(shortMeat).filter((v, i, a) => a.indexOf(v) === i);
  const est = names.length ? ` ${cap(list(names))} ${names.length > 1 ? "aren't" : "isn't"} weighed yet, so I'll use estimates for ${names.length > 1 ? "those" : "it"} until you do.` : "";
  const wasApproved = p.status === "approved";
  if (wasApproved) {
    return { plan: next, reply: `Perfect. I've updated your available meat: ${name} ${exactKg(g)} usable${lossText}. The plan was approved with the old weights, so say “divide the batches” to redo it.`, chips: ["Divide the batches"] };
  }
  next = withDay(next, (d) => ({ ...d, awaiting: { kind: "divide" } }));
  return { plan: next, reply: `Perfect. I've updated your available meat: ${name} ${exactKg(g)} usable${lossText}.${est} Ready to divide the batches?`, chips: ["Yes, divide the batches", "Not yet"] };
}

function divide(p: SausagePlan, recipes: Recipe[], now: string, scale?: number): Inner {
  const rec = recommend(p, recipes, scale === Infinity ? undefined : scale);
  const s = scale === Infinity ? rec.maxScale : rec.scale;
  let next = applyRecommendation(p, recipes, s);
  if (!recipes.length) return { plan: p, reply: "There are no recipes in today's plan yet.", chips: [] };
  const rps = recipes.map((r) => recipePlanOf(next, r));
  const lines = rps.map((rp) => `${rp.recipe.title} ${exactKg(rp.meatG)}`);
  const left = recommend(next, recipes, s).leftover.filter((x) => x.g >= 50);
  const leftText = left.length ? ` Left over: ${list(left.map((x) => `${gramsText(x.g)} ${x.purchase.name.toLowerCase()}`))} — no need to use it all.` : "";
  const scaleText = s === 1 ? "as written on the cards" : `${Math.round(s * 100)}% of each card`;
  const why = rec.maxScale < 1 ? ` There isn't quite enough ${speciesWord(rec.limitedBy ?? "pork")} for the cards as written, so every batch is scaled down evenly.` : rec.maxScale > 1.05 && s === 1 ? ` There's enough for up to ${Math.round(rec.maxScale * 100)}% — say “use as much as we can” for bigger batches.` : "";
  const est = rec.estimated ? " Some meat isn't weighed yet, so this uses estimates." : "";
  next = logEvent(next, now, "plan", `Batches divided (${scaleText}): ${lines.join(", ")}.`, null);
  next = withDay(next, (d) => ({ ...d, awaiting: { kind: "approve" } }));
  const q = openQuestions(next, recipes);
  return {
    plan: next,
    reply: `Here's the split, keeping each card's meat ratios, ${scaleText}: ${list(lines)}.${why}${leftText}${est} Pork butt stands in for the tenderloin and belly. ${q.length ? `Before we lock it in: ${q[0].text}` : "Look it over — say “approve” to lock it in."}`,
    chips: q.length ? q[0].chips : ["Approve the plan"],
  };
}

function doApprove(p: SausagePlan, ctx: Ctx, anyway: boolean): Inner {
  const recipes = ctx.recipes;
  const hasAlloc = recipes.some((r) => Object.values(p.alloc[r.id] ?? {}).some((g) => g > 0));
  if (!hasAlloc) return divide(p, recipes, ctx.now);
  const q = openQuestions(p, recipes);
  if (q.length && !anyway) {
    return { plan: withDay(p, (d) => ({ ...d, awaiting: { kind: "approve" } })), reply: `Before I lock it in: ${q[0].text} (Or say “approve anyway” — optional extras I haven't heard about stay out.)`, chips: [...q[0].chips, "Approve anyway"] };
  }
  const next = logEvent(approveDay(p, recipes, ctx.prefs, ctx.by || "the cook", ctx.now), ctx.now, "plan", `Plan approved${ctx.by ? ` by ${ctx.by}` : ""}.`, null);
  return { plan: next, reply: "Each batch's seasonings are worked out for its meat — weigh them in grams from the batch cards.", chips: [], addNext: true };
}

// ── Summaries ────────────────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100) / 100;

export function meatTotals(p: SausagePlan) {
  const used = inUse(p);
  const bought = p.purchases.reduce((n, x) => n + (x.weightG ?? 0), 0);
  const paid = cents(p.purchases.reduce((n, x) => n + (x.price ?? 0), 0));
  const usable = used.reduce((n, x) => n + (usableOf(x).g ?? 0), 0);
  const weighedAll = used.length > 0 && used.every((x) => usableOf(x).measured);
  const lossG = p.purchases.reduce((n, x) => n + (x.usableG && x.weightG ? x.weightG - x.usableG : 0), 0);
  // What the trimmed-off weight cost (paid for at the bought price per kg).
  const lossCost = cents(p.purchases.reduce((n, x) => n + (x.usableG && x.weightG && x.price ? ((x.weightG - x.usableG) / x.weightG) * x.price : 0), 0));
  const planned = Object.values(p.alloc).reduce((n, a) => n + Object.values(a).reduce((m, g) => m + g, 0), 0);
  return { bought, paid, usable, weighedAll, lossG, lossCost, planned };
}

function meatSummary(p: SausagePlan): string {
  const parts = inUse(p).map((x) => { const u = usableOf(x); return `${x.name}: ${u.g ? `${gramsText(u.g)} ${u.measured ? "weighed" : "estimated"}` : "no weight"}`; });
  const t = meatTotals(p);
  return `${parts.join("; ")}. Usable in all: ${gramsText(t.usable)} from ${gramsText(t.bought)} bought.`;
}

function costSummary(p: SausagePlan, recipes: Recipe[]): string {
  const t = meatTotals(p);
  const per = recipes.map((r) => { const c = costsFor(recipePlanOf(p, r), p.results[r.id]); return `${r.title} ${money(c.meatCost)}${c.perSausage != null ? ` (${money(c.perSausage)} a sausage)` : c.perKg != null ? ` (${money(c.perKg)}/kg ${c.perKgBasis})` : ""}`; });
  return `Meat bought: ${money(t.paid)}. ${per.join("; ")}. Seasonings and casings aren't counted.`;
}

export function finishedCount(p: SausagePlan): number {
  return p.recipeIds.reduce((n, id) => n + (p.results[id]?.count ?? 0), 0);
}

function countSummary(p: SausagePlan, recipes: Recipe[]): string {
  const n = finishedCount(p);
  if (!n) return "No sausages counted yet — tell me, like “breakfast made 30 sausages”.";
  return `${n} sausages so far: ${recipes.filter((r) => p.results[r.id]?.count).map((r) => `${r.title} ${p.results[r.id]!.count}`).join(", ")}.`;
}

// ── Keeping the batch, and making it again ───────────────────────────────────

const DATE = (iso: string) => iso.slice(0, 10);

// The batch as a Kitchen cooking entry: what really went in, so it can be made again.
export function batchEntryInput(p: SausagePlan, recipe: Recipe, by: string, now: string): CookingEntryInput {
  const d = dayOf(p);
  const rp = recipePlanOf(p, recipe);
  const snap = p.snapshots[recipe.id];
  const res = p.results[recipe.id];
  const fat = todayFat(p, recipe.id);
  const meats = rp.meats.map((m) => `${m.purchase.name}: ${exactKg(m.g)}${m.measured ? "" : " (planned from an estimate)"}`);
  const seasoning = rp.seasonings.filter((x) => x.included).map((x) => `${x.s.name}: ${x.text || "no amount on the card"}${x.tweak ? ` (card: ${x.recipeText || "—"}; ${x.tweak.reason})` : ""}`);
  const left = rp.seasonings.filter((x) => !x.included).map((x) => x.s.name);
  const said = d.log.filter((e) => e.recipeId === recipe.id && (e.kind === "note" || e.kind === "adjust")).map((e) => e.text);
  const photos = d.photos.filter((x) => x.recipeId === recipe.id || (x.recipeId === null && x.phase === "before")).map((x) => ({ id: x.id, caption: x.caption || (x.phase === "before" ? "Before" : x.phase === "after" ? "Finished" : "During"), addedAt: x.addedAt }));
  const yieldParts = [res?.count ? `${res.count} sausages` : "", res?.finishedG ? `${exactKg(res.finishedG)} finished` : "", `${exactKg(rp.meatG)} raw meat`].filter(Boolean);
  const storage = d.storage[recipe.id];
  return {
    cookedOn: d.seed ?? DATE(now), cookName: by, ingredientsUsed: [...meats, "", ...seasoning].join("\n"),
    substitutions: [...substitutionNotes(recipe, p), ...(left.length ? [`Left out today: ${left.join(", ")}.`] : [])].join("\n"),
    familyReaction: "", improveNextTime: "",
    notes: [
      `${p.title}${d.scale != null ? ` — ${d.scale === 1 ? "made as written on the card" : `${Math.round(d.scale * 100)}% of the card`}` : ""}.`,
      fatComparison(recipe, p),
      ...(storage ? [`Then: ${storage === "cooked" ? "cooked" : `into the ${storage}`}.`] : []),
      `Safe internal temperature: ${rp.poultry ? "74 °C (165 °F) — contains chicken" : "71 °C (160 °F)"}.`,
      ...(/\bsmok/i.test(recipe.title) ? ["Fresh, raw sausage: not shelf-stable or ready-to-eat. Keep refrigerated or frozen and cook through."] : []),
      ...(snap ? [`Plan approved by ${snap.approvedBy || "the cook"} at ${snap.approvedAt.slice(11, 16)} UTC.`] : []),
    ].filter(Boolean).join("\n"),
    rating: null, photos, equipment: d.equipment.join("; "),
    timesAndTemps: "",
    yieldNote: yieldParts.join(" · "),
    tastingNotes: said.join("\n"),
    details: {
      meatType: [...new Set(rp.meats.map((m) => m.purchase.name))].join(", "), meatWeightG: rp.meatG || null,
      fatPercent: fat ? Math.round(fat.mid) : null, seasoning: seasoning.join("\n"), marinade: "",
      grinderPlate: grindPhrase(snap?.prefs ?? { grind: "coarse", plate: "large plate", seasoningsInGrams: true, goals: "" }), casing: rp.casing,
      smokeTempC: null, cookTempC: null, internalTempC: null, finishedWeightG: res?.finishedG ?? null,
    },
    session: null,
  };
}

// "Make this batch again": a new plan for this one recipe with today's choices,
// and the meat to buy worked out from today's real trim losses.
export function repeatBatch(p: SausagePlan, recipe: Recipe, now: string): SausagePlan {
  const d = dayOf(p);
  const rp = recipePlanOf(p, recipe);
  const purchases: Purchase[] = rp.meats.map((m) => {
    const u = usableOf(m.purchase);
    const ratio = u.measured && m.purchase.weightG ? u.g! / m.purchase.weightG : null;
    return {
      ...m.purchase, id: newId(), name: m.purchase.name.replace(/\s*#\d+$/, ""), weightG: ratio ? Math.round(m.g / ratio) : null, price: null,
      purchasedOn: null, bestBefore: null, usableG: null,
    };
  });
  const merged: Purchase[] = [];
  for (const x of purchases) {
    const same = merged.find((y) => y.name === x.name);
    if (same) same.weightG = same.weightG != null && x.weightG != null ? same.weightG + x.weightG : null;
    else merged.push(x);
  }
  return {
    format: 1, id: newId(), title: `Again: ${recipe.title} (from ${p.title})`, createdAt: now, updatedAt: now, purchases: merged,
    recipeIds: [recipe.id], alloc: {}, status: "draft", approvedAt: null, approvedBy: "", have: [], results: {}, sessions: {}, snapshots: {},
    day: {
      ...blankDay(null), scale: d.scale, tweaks: { [recipe.id]: d.tweaks[recipe.id] ?? [] }, optional: { [recipe.id]: d.optional[recipe.id] ?? {} },
      equipment: d.equipment, meat: Object.fromEntries(merged.map((x) => [x.id, "unknown" as MeatStatus])),
      log: [{ id: newId(), at: now, kind: "note", text: `Repeating ${recipe.title} from ${p.title}. Meat amounts are what to buy (from that day's trim), not weighed yet.`, recipeId: recipe.id }],
    },
  };
}
