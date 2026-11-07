// Dividing today's meat between the recipes while keeping each recipe's own
// meat ratios. The originals call for tenderloin, belly, chicken thigh and
// beef; what was bought is pork butt, eye of round and bone-in thighs. Each
// original cut is matched to what's here by species (pork for pork, chicken
// for chicken, beef for beef), and every recipe is made at the same share of
// its original size, so the batches taste like the cards.
//
// Nothing here assumes all the meat gets used: the recommendation is "as
// written" when there's enough, and whatever's left is reported, not spread.

import type { Recipe } from "../../types/recipe";
import type { Purchase, SausagePlan } from "../../types/sausage";
import { cutOf, type Species } from "./cuts";
import { fatOf, gramsText, originalMeats, usableOf } from "./plan";

export type Demand = { recipeId: string; title: string; bySpecies: Partial<Record<Species, number>>; totalG: number; lines: { name: string; g: number; species: Species }[] };

const speciesWord = (sp: Species) => (sp === "poultry" ? "chicken" : sp === "fat" ? "pork fat" : sp);
// Pork fat counts as pork: belly in an original is matched to the pork you have.
const bucket = (sp: Species): Species => (sp === "fat" ? "pork" : sp);

export function demandOf(recipe: Recipe): Demand {
  const lines = originalMeats(recipe).filter((m) => m.g != null).map((m) => ({ name: m.name, g: m.g!, species: bucket(cutOf(m.name).species) }));
  const bySpecies: Demand["bySpecies"] = {};
  for (const l of lines) bySpecies[l.species] = (bySpecies[l.species] ?? 0) + l.g;
  return { recipeId: recipe.id, title: recipe.title, bySpecies, totalG: lines.reduce((n, l) => n + l.g, 0), lines };
}

// Usable meat on hand by species: weighed where weighed, else the cut's estimate.
export function supplyOf(purchases: Purchase[], skip: (p: Purchase) => boolean = () => false) {
  const by: Partial<Record<Species, { g: number; estimated: boolean; purchases: Purchase[] }>> = {};
  for (const p of purchases) {
    if (skip(p)) continue;
    const u = usableOf(p);
    if (!u.g) continue;
    const sp = bucket(cutOf(p.name).species);
    const e = by[sp] ?? { g: 0, estimated: false, purchases: [] };
    e.g += u.g;
    e.estimated ||= !u.measured;
    e.purchases.push(p);
    by[sp] = e;
  }
  return by;
}

export type Recommendation = {
  // The share of each original recipe to make (1 = as written).
  scale: number;
  // The biggest share the meat allows, and which meat limits it.
  maxScale: number;
  limitedBy: Species | null;
  alloc: Record<string, Record<string, number>>;
  // Meat not in any batch, by purchase.
  leftover: { purchase: Purchase; g: number }[];
  // Species a recipe needs that wasn't bought.
  missing: { recipeId: string; species: Species }[];
  estimated: boolean;
};

const floor2 = (n: number) => Math.floor(n * 100) / 100;

// scale: undefined = recommend (1× when there's enough meat, else the most the meat allows).
export function recommend(plan: SausagePlan, recipes: Recipe[], scale?: number): Recommendation {
  const skip = (p: Purchase) => plan.day?.meat[p.id] === "not-using";
  const supply = supplyOf(plan.purchases, skip);
  const demands = recipes.map(demandOf);
  const total: Partial<Record<Species, number>> = {};
  for (const d of demands) for (const [sp, g] of Object.entries(d.bySpecies) as [Species, number][]) total[sp] = (total[sp] ?? 0) + g;
  const missing: Recommendation["missing"] = [];
  for (const d of demands) for (const sp of Object.keys(d.bySpecies) as Species[]) if (!supply[sp]) missing.push({ recipeId: d.recipeId, species: sp });

  let maxScale = Infinity;
  let limitedBy: Species | null = null;
  for (const [sp, need] of Object.entries(total) as [Species, number][]) {
    const have = supply[sp]?.g ?? 0;
    if (!have || !need) continue;
    if (have / need < maxScale) { maxScale = have / need; limitedBy = sp; }
  }
  if (!Number.isFinite(maxScale)) maxScale = 0;
  maxScale = floor2(maxScale);
  const s = scale != null ? Math.max(0, Math.min(scale, maxScale)) : Math.min(1, maxScale);

  const alloc: Recommendation["alloc"] = Object.fromEntries(recipes.map((r) => [r.id, {}]));
  const used = new Map<string, number>();
  for (const d of demands) {
    for (const [sp, need] of Object.entries(d.bySpecies) as [Species, number][]) {
      const src = supply[sp];
      if (!src) continue;
      // Share the species across its packages by usable weight, so both pork butts are used evenly.
      const want = Math.round(need * s);
      let given = 0;
      src.purchases.forEach((p, i) => {
        const g = i === src.purchases.length - 1 ? want - given : Math.round((want * (usableOf(p).g ?? 0)) / src.g);
        given += g;
        if (g > 0) { alloc[d.recipeId][p.id] = (alloc[d.recipeId][p.id] ?? 0) + g; used.set(p.id, (used.get(p.id) ?? 0) + g); }
      });
    }
  }
  const leftover = plan.purchases.filter((p) => !skip(p)).map((p) => ({ purchase: p, g: (usableOf(p).g ?? 0) - (used.get(p.id) ?? 0) })).filter((x) => x.g > 0);
  return { scale: s, maxScale, limitedBy, alloc, leftover, missing, estimated: Object.values(supply).some((x) => x!.estimated) };
}

// ── Fat, with how sure we are ────────────────────────────────────────────────

export type FatRange = { low: number; mid: number; high: number };
const r1 = (n: number) => Math.round(n * 10) / 10;

function mix(parts: { g: number; fat: [number, number, number] }[]): FatRange | null {
  const g = parts.reduce((n, p) => n + p.g, 0);
  if (!g) return null;
  const at = (i: 0 | 1 | 2) => r1(parts.reduce((n, p) => n + p.g * p.fat[i], 0) / g);
  return { low: at(0), mid: at(2), high: at(1) };
}

// The original recipe's fat, estimated from its cuts' typical ranges.
export function originalFat(recipe: Recipe): FatRange | null {
  return mix(demandOf(recipe).lines.map((l) => ({ g: l.g, fat: cutOf(l.name).fat })));
}

// Today's mix: a typed fat % is exact; otherwise the cut's range.
export function todayFat(plan: SausagePlan, recipeId: string): FatRange | null {
  const a = plan.alloc[recipeId] ?? {};
  return mix(plan.purchases.filter((p) => (a[p.id] ?? 0) > 0).map((p) => {
    const f = fatOf(p);
    return { g: a[p.id], fat: f.estimated && f.range ? [f.range[0], f.range[1], f.pct] as [number, number, number] : [f.pct, f.pct, f.pct] as [number, number, number] };
  }));
}

export const fatText = (f: FatRange | null) => (f ? (f.low === f.high ? `${f.mid}%` : `about ${Math.round(f.mid)}% (likely ${Math.round(f.low)}–${Math.round(f.high)}%)`) : "unknown");

// Plain words on what changed from the card, and what it does to the sausage.
export function substitutionNotes(recipe: Recipe, plan: SausagePlan): string[] {
  const d = demandOf(recipe);
  const a = plan.alloc[recipe.id] ?? {};
  const here = plan.purchases.filter((p) => (a[p.id] ?? 0) > 0);
  const out: string[] = [];
  for (const sp of Object.keys(d.bySpecies) as Species[]) {
    const orig = d.lines.filter((l) => l.species === sp);
    const now = here.filter((p) => bucket(cutOf(p.name).species) === sp);
    if (!now.length) { out.push(`No ${speciesWord(sp)} in this batch — the card has ${orig.map((o) => o.name).join(" and ")}.`); continue; }
    const origKeys = new Set(orig.map((o) => cutOf(o.name).key));
    const nowKeys = new Set(now.map((p) => cutOf(p.name).key));
    if ([...origKeys].every((k) => nowKeys.has(k))) continue;
    const nowName = [...new Set(now.map((p) => cutOf(p.name).label.toLowerCase()))].join(" and ");
    const g = now.reduce((n, p) => n + a[p.id], 0);
    const origText = orig.map((o) => `${gramsText(o.g)} ${o.name}`).join(" + ");
    let why = "";
    if (sp === "pork" && orig.some((o) => /tenderloin|loin/i.test(o.name)) && orig.some((o) => /belly/i.test(o.name))) {
      why = " Pork butt is a natural stand-in: it sits between lean tenderloin (about 5% fat) and fatty belly (about 50%), so one cut covers both.";
    } else if (sp === "pork" && orig.some((o) => /belly/i.test(o.name))) {
      why = " Butt is leaner than belly (about 25% against 50% fat), so this batch comes out leaner than the card.";
    } else if (sp === "beef" && nowKeys.has("beef-eye-round")) {
      why = " Eye of round is very lean (about 5% fat): fine here, but it adds no fat of its own.";
    }
    out.push(`${gramsText(g)} ${nowName} in place of ${origText}.${why}`);
  }
  return out;
}

export function fatComparison(recipe: Recipe, plan: SausagePlan): string {
  const o = originalFat(recipe);
  const t = todayFat(plan, recipe.id);
  if (!o || !t) return "";
  const diff = t.mid - o.mid;
  const verdict = Math.abs(diff) <= 3 ? "close to the original" : diff < 0 ? "leaner than the original — it may come out a little drier" : "richer than the original";
  return `Fat: the card's meat is ${fatText(o)}; today's is ${fatText(t)}, ${verdict}. Both are estimates from typical cuts until you know better — judge by eye too.`;
}
