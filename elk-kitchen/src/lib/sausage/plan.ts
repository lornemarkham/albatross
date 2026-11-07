// Sausage day planner: the meat you bought + the family's sausage recipes →
// a plan the cook approves. Plain arithmetic and rules, not AI, so every
// number can be explained and tested.
//
// Honesty rules:
// - A weight nobody gave stays blank. Estimates (usable meat, fat %) are
//   labelled as estimates and replaced by anything the person weighs or types.
// - Seasonings are worked out from the recipe's own ratios and the meat's
//   weight. A recipe that doesn't say how much meat its amounts are for can't
//   be scaled, and Kitchen says so rather than guessing.
// - Nothing here changes a recipe or Pantry's stock.

import type { Recipe } from "../../types/recipe";
import type { BatchPlan, BatchResult, Preferences, Purchase, SausageKind, SausagePlan, Seasoning } from "../../types/sausage";
import { newId } from "../recipeModel";
import { convert, grams, quantityAt, round } from "../cooking/parse";
import { cutOf, isPoultry, speciesOf, type Species } from "./cuts";

// ── Purchases ────────────────────────────────────────────────────────────────

export function blankPurchase(name = ""): Purchase {
  return { id: newId(), name, weightG: null, price: null, currency: "CAD", purchasedOn: null, bestBefore: null, boneIn: null, skinOn: null, usableG: null, fatPercent: null };
}

const WEIGHT = /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|kilograms?|g|grams?|lbs?|pounds?|oz|ounces?)\b/i;

// One purchase per line: "Pork butt 3.705 kg $31.45", "Chicken thighs bone-in skin-on, 2.62 kg, 32.20".
export function parsePurchases(text: string): Purchase[] {
  return text.split(/\n+/).map((l) => l.trim().replace(/^[-•*]\s*/, "")).filter(Boolean).flatMap((line) => {
    const p = blankPurchase();
    const w = WEIGHT.exec(line);
    if (w) {
      const q = quantityAt(`${w[1]} ${w[2]}`);
      const g = q ? grams(q.qty) : null;
      if (g != null) p.weightG = Math.round(g);
    }
    let rest = w ? line.replace(w[0], " ") : line;
    const money = /\$\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{2})\s*(?:\$|cad|usd)?/i.exec(rest);
    if (money) {
      p.price = Number((money[1] ?? money[2]).replace(",", "."));
      if (/usd/i.test(money[0])) p.currency = "USD";
      rest = rest.replace(money[0], " ");
    }
    const bb = /\b(?:best before|bb|use by|exp(?:iry|ires)?)[:\s]*(\d{4}-\d{2}-\d{2})/i.exec(rest);
    if (bb) { p.bestBefore = bb[1]; rest = rest.replace(bb[0], " "); }
    const bought = /\b(?:bought|purchased|packed|on)?[:\s]*(\d{4}-\d{2}-\d{2})/i.exec(rest);
    if (bought) { p.purchasedOn = bought[1]; rest = rest.replace(bought[0], " "); }
    if (/\bbone[- ]?in\b/i.test(line)) p.boneIn = true;
    if (/\bboneless\b/i.test(line)) p.boneIn = false;
    if (/\bskin[- ]?on\b/i.test(line)) p.skinOn = true;
    if (/\bskinless\b/i.test(line)) p.skinOn = false;
    p.name = rest.replace(/[—–]|\s-\s/g, " ").replace(/[,:;]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(\d+\s*x\s*)/i, "");
    return p.name ? [p] : [];
  });
}

export type Usable = { g: number | null; measured: boolean; pct: number | null; range: [number, number] | null; note: string };

export function usableOf(p: Purchase): Usable {
  if (p.usableG != null && p.usableG > 0) return { g: p.usableG, measured: true, pct: p.weightG ? round((p.usableG / p.weightG) * 100) : null, range: null, note: "weighed" };
  if (!p.weightG) return { g: null, measured: false, pct: null, range: null, note: "No weight given" };
  const c = cutOf(p.name + (p.boneIn ? " bone-in" : "") + (p.skinOn ? " skin-on" : ""));
  let [lo, hi, pct] = c.usable;
  if (p.boneIn && c.key === "pork-butt") [lo, hi, pct] = [85, 95, 90];
  if (p.boneIn === false && c.key === "chicken-thigh-bone-skin") [lo, hi, pct] = [95, 100, 98];
  return { g: Math.round((p.weightG * pct) / 100), measured: false, pct, range: [Math.round((p.weightG * lo) / 100), Math.round((p.weightG * hi) / 100)], note: c.note };
}

export function fatOf(p: Purchase): { pct: number; estimated: boolean; range: [number, number] | null } {
  if (p.fatPercent != null) return { pct: p.fatPercent, estimated: false, range: null };
  const c = cutOf(p.name + (p.skinOn === false ? " skinless" : "") + (p.boneIn === false && p.skinOn === false ? " boneless" : ""));
  return { pct: c.fat[2], estimated: true, range: [c.fat[0], c.fat[1]] };
}

// Price per kilogram of usable meat (bone and trim are paid for too).
export function costPerUsableKg(p: Purchase): number | null {
  const u = usableOf(p);
  return p.price != null && u.g ? round((p.price / u.g) * 1000) : null;
}

// ── Reading a recipe ─────────────────────────────────────────────────────────

const MEAT_WORDS = /\b(pork|beef|chicken|turkey|lamb|venison|elk|moose|bison|veal|belly|butt|shoulder|tenderloin|loin|thighs?|breast|chuck|brisket|round|back ?fat|fatback|meat)\b/i;
const CASING = /\bcasings?\b/i;
const CURE = /\b(cure\s*#?\s*[12]|prague|pink (curing )?salt|insta ?cure|sodium nitrite|curing salt|tender ?quick)\b/i;
export const isCureLine = (s: string) => CURE.test(s);

const lines = (t: string) => t.split("\n").map((l) => l.trim().replace(/^[-•*·]\s*/, "")).filter((l) => l && !/:$/.test(l));

// The meat a recipe was written for: "3 lb pork tenderloin" lines, and the meat type field.
export function originalMeats(recipe: Recipe): { name: string; g: number | null }[] {
  const out: { name: string; g: number | null }[] = [];
  for (const l of lines(recipe.ingredients)) {
    if (CASING.test(l) || !MEAT_WORDS.test(l) || CURE.test(l)) continue;
    const q = quantityAt(l);
    const g = q ? grams(q.qty) : null;
    if (g != null && q) out.push({ name: q.rest.replace(/^of\s+/, ""), g: Math.round(g) });
  }
  if (!out.length && recipe.details.meatType.trim()) {
    for (const part of recipe.details.meatType.split(/,|\band\b|\+|&|\//).map((s) => s.trim()).filter(Boolean)) out.push({ name: part, g: null });
  }
  return out;
}

// How much meat the recipe's amounts are for: its meat weight field, else its meat lines added up.
export function recipeBaseG(recipe: Recipe): number | null {
  if (recipe.details.meatWeightG && recipe.details.meatWeightG > 0) return recipe.details.meatWeightG;
  const known = originalMeats(recipe).map((m) => m.g).filter((g): g is number => g != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

const NAME_THEN_AMOUNT = /^(.*?[a-z)])[\s:=,-]+(\d.*)$/i;

function seasoningFrom(raw: string, baseG: number | null, from: Seasoning["from"]): Seasoning {
  const cure = CURE.test(raw);
  const s = (name: string, rest: Partial<Seasoning>): Seasoning => ({ name: name.trim() || raw, raw, basis: "none", gPerKg: null, perKg: null, from, cure, ...rest });
  // "Salt 2%", "Salt 18 g/kg", "Salt 18 g per kg"
  const pct = /^(.*?)[\s:=-]*(\d+(?:[.,]\d+)?)\s*%\s*$/.exec(raw);
  if (pct && pct[1].trim()) return s(pct[1], { basis: "percent", gPerKg: round(Number(pct[2].replace(",", ".")) * 10) });
  const perKg = /^(.*?)[\s:=-]*(\d+(?:[.,]\d+)?)\s*g(?:rams?)?\s*(?:\/|per)\s*(kg|kilo(?:gram)?|lb|pound)s?\b/i.exec(raw);
  if (perKg && perKg[1].trim()) {
    const v = Number(perKg[2].replace(",", "."));
    return s(perKg[1], { basis: "per-kg", gPerKg: /^(lb|pound)/i.test(perKg[3]) ? round(v / 0.453592) : v });
  }
  // "20 g salt" / "Salt 20 g" / "2 tbsp sage" / "4 cloves garlic"
  let q = quantityAt(raw);
  let name = q?.rest ?? "";
  if (!q || !q.qty.unit) {
    const m = NAME_THEN_AMOUNT.exec(raw);
    const q2 = m ? quantityAt(m[2]) : null;
    if (m && q2 && q2.qty.unit && !q2.rest) { q = q2; name = m[1]; }
  }
  if (!q || !name) return s(raw.replace(/\s*\(.*?\)\s*/g, " "), {});
  if (!baseG) return s(name, {});
  const kg = baseG / 1000;
  const g = grams(q.qty);
  if (g != null) return s(name, { basis: "scaled", gPerKg: round(g / kg) });
  if (["tsp", "tbsp", "cup", "ml", "l"].includes(q.qty.unit)) return s(name, { basis: "volume", perKg: { value: round(q.qty.value / kg), unit: q.qty.unit } });
  return s(name, { basis: "count", perKg: { value: round(q.qty.value / kg), unit: q.qty.unit || "" } });
}

// The recipe's seasonings: the "seasoning ratios" field, else its non-meat ingredient lines.
export function seasoningsOf(recipe: Recipe): Seasoning[] {
  const base = recipeBaseG(recipe);
  const fromField = lines(recipe.details.seasoning).map((l) => seasoningFrom(l, base, "seasoning"));
  if (fromField.length) return fromField;
  return lines(recipe.ingredients)
    .filter((l) => !CASING.test(l) && !(MEAT_WORDS.test(l) && !CURE.test(l) && !/\b(stock|broth|powder|fat back)\b/i.test(l)))
    .map((l) => seasoningFrom(l, base, "ingredients"));
}

export function casingOf(recipe: Recipe): string {
  return recipe.details.casing.trim() || (lines(recipe.ingredients).find((l) => CASING.test(l)) ?? "");
}

const fmt1 = (n: number) => String(Math.round(n * 10) / 10);
export function gramsText(g: number): string {
  if (g >= 1000) return `${fmt1(g / 1000)} kg`;
  if (g >= 100) return `${Math.round(g)} g`;
  return `${fmt1(g)} g`;
}

// What to weigh out for this much meat.
export function amountFor(s: Seasoning, meatG: number): { text: string; grams: number | null } {
  const kg = meatG / 1000;
  if (s.gPerKg != null) { const g = round(s.gPerKg * kg); return { text: gramsText(g), grams: g }; }
  if (s.perKg) {
    // Counts (cloves, pieces) round to a whole one; volumes keep one decimal.
    const v = s.basis === "count" ? Math.max(1, Math.round(s.perKg.value * kg)) : round(s.perKg.value * kg);
    const asMl = s.basis === "volume" ? convert({ value: v, unit: s.perKg.unit }, "ml") : null;
    return { text: `${fmt1(v)} ${s.perKg.unit}${asMl && s.perKg.unit !== "ml" ? ` (≈ ${Math.round(asMl.value)} ml)` : ""}`.trim(), grams: null };
  }
  return { text: "", grams: null };
}

export function kindOf(recipe: Recipe): SausageKind {
  const all = `${recipe.title} ${recipe.tags.join(" ")} ${recipe.ingredients} ${recipe.instructions} ${recipe.details.seasoning} ${recipe.notes}`.toLowerCase();
  if (/\b(ferment|starter culture|bactoferm|summer sausage|pepperoni|salami|landj[aä]ger|dry[- ]cured)\b/.test(all)) return "fermented";
  if (CURE.test(all)) return "cured";
  if (/\bsmok/.test(all) || recipe.details.smokeTempC != null) return "smoked";
  return "fresh";
}

// ── Splitting the meat ───────────────────────────────────────────────────────

export type Split = { alloc: Record<string, Record<string, number>>; reasons: Record<string, string[]>; leftover: string[] };

// Each purchase goes to the recipes whose original meat is the same species,
// in proportion to how much of it the original used (equal shares when the
// recipe doesn't say). Meat no recipe asks for is left for the cook to place.
export function suggestSplit(purchases: Purchase[], recipes: Recipe[]): Split {
  const alloc: Split["alloc"] = Object.fromEntries(recipes.map((r) => [r.id, {}]));
  const reasons: Split["reasons"] = Object.fromEntries(recipes.map((r) => [r.id, []]));
  const leftover: string[] = [];
  const wants = new Map(recipes.map((r) => {
    const m = originalMeats(r);
    const by = new Map<Species, number | null>();
    for (const x of m) for (const sp of speciesOf(x.name)) by.set(sp, x.g == null ? (by.get(sp) ?? null) : (by.get(sp) ?? 0) + x.g);
    return [r.id, by];
  }));
  const anyStated = [...wants.values()].some((m) => m.size > 0);
  for (const p of purchases) {
    const u = usableOf(p).g;
    if (!u) continue;
    const sp = cutOf(p.name).species;
    let takers = recipes.filter((r) => wants.get(r.id)!.has(sp) || (sp === "fat" && wants.get(r.id)!.has("pork")));
    let why = `the original uses ${sp === "poultry" ? "chicken" : sp}`;
    if (!anyStated) { takers = recipes; why = "no recipe names its meat, so it's shared evenly"; }
    if (!takers.length) { leftover.push(p.id); continue; }
    const weights = takers.map((r) => wants.get(r.id)!.get(sp) ?? null);
    const known = weights.every((w) => w != null && w > 0);
    const total = known ? weights.reduce((a, b) => a! + b!, 0)! : takers.length;
    let given = 0;
    takers.forEach((r, i) => {
      const share = i === takers.length - 1 ? u - given : Math.round((u * (known ? weights[i]! : 1)) / total);
      given += share;
      alloc[r.id][p.id] = share;
      reasons[r.id].push(`${p.name}: ${gramsText(share)} — ${why}${takers.length > 1 ? `, split ${known ? "in the originals' proportions" : "evenly"} with ${takers.length - 1} other recipe${takers.length > 2 ? "s" : ""}` : ""}.`);
    });
  }
  return { alloc, reasons, leftover };
}

// ── The plan for one recipe ──────────────────────────────────────────────────

export type MeatUse = { purchase: Purchase; g: number; fat: number; fatEstimated: boolean; measured: boolean };

export type RecipePlan = {
  recipe: Recipe;
  meats: MeatUse[];
  meatG: number;
  // True when every meat in it has been weighed after trimming.
  measured: boolean;
  fatPercent: number | null;
  fatTarget: number | null;
  fatAdvice: string;
  seasonings: { s: Seasoning; text: string; grams: number | null }[];
  unscaled: string; // why seasonings couldn't be scaled, or ""
  casing: string;
  substitutions: string[];
  kind: SausageKind;
  poultry: boolean;
  safety: { level: "warn" | "info"; text: string }[];
  meatCost: number | null;
};

const BACK_FAT = 85;

export function fatAdvice(meatG: number, fatPct: number | null, target: number | null, estimated: boolean): string {
  if (!meatG || fatPct == null) return "";
  const est = estimated ? " (estimated from typical cuts — judge by eye too)" : "";
  if (target == null) return `This mix is about ${fmt1(fatPct)}% fat${est}. The recipe doesn't say a fat %; fresh sausage is usually 20–30%. Add the target to the recipe if you know it.`;
  const diff = fatPct - target;
  if (Math.abs(diff) <= 2) return `About ${fmt1(fatPct)}% fat${est} — on target (${target}%).`;
  if (diff < 0) {
    const T = target / 100, F = (meatG * fatPct) / 100;
    const add = (T * meatG - F) / (BACK_FAT / 100 - T);
    return `About ${fmt1(fatPct)}% fat${est}, leaner than the ${target}% the recipe aims for. To get there: about ${gramsText(add)} of pork back fat, or move fattier pork butt in from another recipe. Lean sausage comes out dry and crumbly.`;
  }
  return `About ${fmt1(fatPct)}% fat${est}, richer than the ${target}% the recipe aims for. Swap in some leaner meat (eye of round, chicken) if you want it closer.`;
}

export function planRecipe(recipe: Recipe, purchases: Purchase[], alloc: Record<string, number>): RecipePlan {
  const meats: MeatUse[] = purchases.filter((p) => (alloc[p.id] ?? 0) > 0).map((p) => {
    const f = fatOf(p);
    return { purchase: p, g: alloc[p.id], fat: f.pct, fatEstimated: f.estimated, measured: usableOf(p).measured };
  });
  const meatG = meats.reduce((n, m) => n + m.g, 0);
  const fatPercent = meatG ? round(meats.reduce((n, m) => n + m.g * m.fat, 0) / meatG) : null;
  const fatTarget = recipe.details.fatPercent;
  const seasonings = seasoningsOf(recipe);
  const scaled = seasonings.map((s) => ({ s, ...amountFor(s, meatG) }));
  const cannot = seasonings.filter((s) => s.basis === "none" && /\d/.test(s.raw));
  const unscaled = cannot.length && !recipeBaseG(recipe)
    ? "The recipe gives amounts but not how much meat they're for. Add the original meat weight to the recipe (Edit → meat weight) and Kitchen will scale them."
    : "";
  const poultry = meats.some((m) => isPoultry(m.purchase.name));
  const kind = kindOf(recipe);
  const orig = originalMeats(recipe);
  const substitutions: string[] = [];
  const usedNames = [...new Set(meats.map((m) => m.purchase.name))];
  const origKeys = new Set(orig.map((o) => cutOf(o.name).key));
  const usedKeys = new Set(meats.map((m) => cutOf(m.purchase.name).key));
  if (orig.length && meats.length && [...origKeys].some((k) => !usedKeys.has(k))) {
    substitutions.push(`${usedNames.join(" + ")} in place of ${orig.map((o) => o.name).join(" + ")} (the original's meat).`);
  }
  const meatCost = meats.every((m) => costPerUsableKg(m.purchase) != null) && meats.length
    ? round(meats.reduce((n, m) => n + (costPerUsableKg(m.purchase)! * m.g) / 1000, 0))
    : null;
  return {
    recipe, meats, meatG, measured: meats.length > 0 && meats.every((m) => m.measured), fatPercent, fatTarget,
    fatAdvice: fatAdvice(meatG, fatPercent, fatTarget, meats.some((m) => m.fatEstimated)),
    seasonings: scaled, unscaled, casing: casingOf(recipe), substitutions, kind, poultry,
    safety: safetyFor(kind, poultry, seasonings), meatCost,
  };
}

// ── Food safety (USDA FSIS; see src/lib/meat.ts for sources) ────────────────
// Cure #1 (6.25% sodium nitrite): 156 ppm ingoing nitrite is the USDA limit
// for comminuted (ground) products, which is 2.5 g of Cure #1 per kg of meat
// (9 CFR 424.21; the figure printed on Prague Powder #1). Kitchen only checks
// a cure the recipe already states; it never works one out.
export const CURE1_G_PER_KG = 2.5;

export function safetyFor(kind: SausageKind, poultry: boolean, seasonings: Seasoning[]): { level: "warn" | "info"; text: string }[] {
  const out: { level: "warn" | "info"; text: string }[] = [];
  out.push(poultry
    ? { level: "info", text: "Contains chicken: cook to 74 °C (165 °F) in the centre — the poultry temperature applies to the whole mix." }
    : { level: "info", text: "Ground pork and beef: cook to 71 °C (160 °F) in the centre." });
  out.push({ level: "info", text: "Keep meat, fat and grinder parts at 4 °C (40 °F) or colder; put it back in the fridge between steps. No more than 2 hours out in total." });
  if (poultry) out.push({ level: "info", text: "Raw chicken: separate board and knife, wash hands, and clean the grinder and stuffer properly when you're done." });
  if (kind === "fresh") out.push({ level: "info", text: "Fresh sausage (no cure): fridge 1–2 days, or freeze." });
  const cures = seasonings.filter((s) => s.cure);
  for (const c of cures) {
    if (/\b(cure|prague(\s*powder)?)\s*#?\s*2(?![.,\d])/i.test(c.raw)) {
      out.push({ level: "warn", text: `“${c.raw}”: Cure #2 is for long dry-cured products. Kitchen doesn't guide those — use Cure #1 only if your tested recipe says so.` });
    } else if (c.gPerKg != null && c.gPerKg > CURE1_G_PER_KG + 0.05) {
      out.push({ level: "warn", text: `“${c.raw}” works out to ${fmt1(c.gPerKg)} g per kg. If that's Cure #1 (6.25% nitrite), the USDA limit for sausage is ${CURE1_G_PER_KG} g per kg. Check the recipe before using it.` });
    } else if (c.gPerKg == null) {
      out.push({ level: "warn", text: `“${c.raw}”: weigh curing salt in grams. Cure #1 for sausage is ${CURE1_G_PER_KG} g per kg of meat at most — don't measure it by spoon.` });
    } else {
      out.push({ level: "info", text: `Cure: ${fmt1(c.gPerKg)} g per kg (USDA limit for Cure #1 in sausage: ${CURE1_G_PER_KG} g per kg). Weigh it on a gram scale and mix it in evenly.` });
    }
  }
  if (kind === "smoked") {
    out.push({ level: "warn", text: "This recipe is smoked but has no cure. Hot-smoke only: smoker 107 °C (225 °F) or hotter, cooking straight through to the safe internal temperature. Never cold-smoke or hold uncured sausage in a low smoker." });
  }
  if (kind === "cured") out.push({ level: "info", text: "Cured and smoked: the cure doesn't replace cooking. Bring it to the safe internal temperature. Kitchen doesn't support cold smoking." });
  if (kind === "fermented") out.push({ level: "warn", text: "Fermented or dry-cured sausage needs a tested recipe, a starter culture and pH/weight-loss checks. Kitchen doesn't guide that process." });
  return out;
}

// ── Needed items, costs, approval ────────────────────────────────────────────

export function neededItems(plans: RecipePlan[]): { name: string; for: string[] }[] {
  const m = new Map<string, { name: string; for: string[] }>();
  const add = (name: string, title: string) => {
    const k = name.trim().toLowerCase();
    if (!k) return;
    const e = m.get(k) ?? { name: name.trim(), for: [] };
    if (!e.for.includes(title)) e.for.push(title);
    m.set(k, e);
  };
  for (const p of plans) {
    for (const s of p.seasonings) if (!/^(ice|ice water|water|cold water)$/i.test(s.s.name.trim())) add(s.s.name.replace(/\b(to taste|optional)\b/gi, "").trim(), p.recipe.title);
    if (p.casing) add(p.casing, p.recipe.title);
  }
  return [...m.values()];
}

export type Costs = { meatCost: number | null; perKg: number | null; perKgBasis: "finished" | "raw mix" | null; perSausage: number | null; perServing: number | null };

export function costsFor(p: RecipePlan, r: BatchResult | undefined): Costs {
  const c = p.meatCost;
  if (c == null) return { meatCost: null, perKg: null, perKgBasis: null, perSausage: null, perServing: null };
  const finished = r?.finishedG && r.finishedG > 0 ? r.finishedG : null;
  const kg = (finished ?? p.meatG) / 1000;
  return {
    meatCost: c,
    perKg: kg ? round(c / kg) : null,
    perKgBasis: finished ? "finished" : p.meatG ? "raw mix" : null,
    perSausage: r?.count && r.count > 0 ? round(c / r.count) : null,
    perServing: r?.servings && r.servings > 0 ? round(c / r.servings) : null,
  };
}

export const money = (n: number | null, currency = "CAD") => (n == null ? "—" : `$${n.toFixed(2)}${currency && currency !== "CAD" ? ` ${currency}` : ""}`);

export function newPlan(now: string, title = "Sausage day"): SausagePlan {
  return { format: 1, id: newId(), title, createdAt: now, updatedAt: now, purchases: [], recipeIds: [], alloc: {}, status: "draft", approvedAt: null, approvedBy: "", have: [], results: {}, sessions: {}, snapshots: {} };
}

export function snapshot(plan: SausagePlan, p: RecipePlan, prefs: Preferences, approvedBy: string, now: string): BatchPlan {
  return {
    planId: plan.id, planTitle: plan.title, recipeId: p.recipe.id, recipeTitle: p.recipe.title, recipeVersion: p.recipe.version,
    approvedAt: now, approvedBy,
    meats: p.meats.map((m) => ({ name: m.purchase.name, plannedG: m.g, fatPercent: m.fat, fatEstimated: m.fatEstimated, measured: m.measured, costPerKg: costPerUsableKg(m.purchase) })),
    plannedMeatG: p.meatG, fatPercent: p.fatPercent, fatTarget: p.fatTarget,
    seasonings: p.seasonings.map((x) => x.s), substitutions: p.substitutions, safety: p.safety.map((s) => s.text),
    kind: p.kind, poultry: p.poultry, meatCost: p.meatCost, currency: plan.purchases[0]?.currency ?? "CAD", prefs,
  };
}

// Approving freezes today's adaptation for each recipe. The recipes themselves are untouched.
export function approve(plan: SausagePlan, plans: RecipePlan[], prefs: Preferences, by: string, now: string): SausagePlan {
  return {
    ...plan, status: "approved", approvedAt: now, approvedBy: by, updatedAt: now,
    snapshots: Object.fromEntries(plans.map((p) => [p.recipe.id, snapshot(plan, p, prefs, by, now)])),
  };
}

// Problems that should stop "Approve": nothing to cook, or more meat planned than there is.
export function planProblems(plan: SausagePlan): string[] {
  const out: string[] = [];
  if (!plan.recipeIds.length) out.push("Pick at least one recipe.");
  for (const p of plan.purchases) {
    if (!p.weightG && !p.usableG) out.push(`${p.name || "A purchase"} has no weight.`);
    const u = usableOf(p).g ?? 0;
    const used = plan.recipeIds.reduce((n, id) => n + (plan.alloc[id]?.[p.id] ?? 0), 0);
    if (used > u + 1) out.push(`${p.name}: ${gramsText(used)} planned but only ${gramsText(u)} ${usableOf(p).measured ? "weighed" : "estimated usable"}.`);
  }
  return out;
}

export function leftoverOf(plan: SausagePlan, p: Purchase): number {
  const u = usableOf(p).g ?? 0;
  return u - plan.recipeIds.reduce((n, id) => n + (plan.alloc[id]?.[p.id] ?? 0), 0);
}
