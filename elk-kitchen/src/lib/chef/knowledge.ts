// What Kitchen knows the household has, and how it knows it.
//
//   inventory  ELK Inventory / Pantry shows it (Pantry's own count, place, best-before).
//              Inventory is the source of truth for stock; Kitchen only reads it.
//   recent     Kitchen's own cooking history (or a finished Sausage Day) says it was
//              made recently. That's a record of cooking, not a count of what's left.
//   said       The person said so in this conversation. Never stock; offered to
//              Inventory only if they confirm.
//
// Every number shown comes from Pantry, or is the person's own words. Nothing
// here estimates a quantity, and nothing here writes anywhere.

import type { PantryItem } from "../pantry";
import type { CookingEntry, Recipe } from "../../types/recipe";
import type { SausagePlan } from "../../types/sausage";
import { daysBetween, stockLabel, whenLabel } from "../companion/pantryView";
import { mentions } from "../pantryCheck";
import { dayOf } from "../sausage/day";
import type { Mentioned } from "./mentioned";

export type Zone = "fridge" | "freezer" | "pantry" | "storage";
export const ZONE_LABEL: Record<Zone, string> = { fridge: "Refrigerator", freezer: "Freezer", pantry: "Pantry", storage: "Food storage" };

export type HaveSource = "inventory" | "recent" | "said";

export type Have = {
  name: string;
  source: HaveSource;
  zones: Zone[];
  // How Kitchen knows, in words: "Pantry: 2 packs · Garage freezer", "Made yesterday (Kitchen's cooking history)", "You said: half a bag".
  evidence: string;
  bestBefore: string | null;
  daysLeft: number | null;
  opened: boolean;
  expired: boolean;
  leftover: boolean;
  // "use" when the person asked to use it up.
  wantUsed: boolean;
  // The person named it in this conversation (or picked it): it leads over similar foods.
  mentioned: boolean;
};

export type RecentFood = {
  title: string;
  recipeId: string;
  entryId: string | null;
  madeOn: string;
  daysAgo: number;
  yieldNote: string;
  from: "cooking-history" | "sausage-day";
  // A Pantry product with the same name, if someone put it away in Inventory.
  inPantry: PantryItem | null;
};

export type Knowledge = {
  pantryConnected: boolean;
  // Everything with some left, newest evidence first per source.
  have: Have[];
  byZone: Record<Zone, Have[]>;
  // Best-before within 4 days, opened packages, leftovers, and what the person asked to use.
  useSoon: Have[];
  // Past its best-before: listed, never planned around without the person checking it.
  expired: Have[];
  recent: RecentFood[];
  said: Mentioned[];
};

export function zoneOf(location: string): Zone {
  const l = location.toLowerCase();
  if (/freez/.test(l)) return "freezer";
  if (/fridge|refrigerat|cooler|crisper/.test(l)) return "fridge";
  if (/pantry|cupboard|cabinet|shelf|larder|spice|drawer/.test(l)) return "pantry";
  return "storage";
}

export const RECENT_DAYS = 10;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ago = (d: number) => (d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);

// Kitchen's own record of recent cooking: batches in the cooking history and
// sausages from a finished Sausage Day (this phone's record), newest first.
export function recentlyMade(history: { recipe: Recipe; entry: CookingEntry }[], plans: SausagePlan[], pantry: PantryItem[] | null, today: string, within = RECENT_DAYS): RecentFood[] {
  const out: RecentFood[] = [];
  const seen = new Set<string>();
  const inPantry = (title: string) => pantry?.find((p) => p.onHand > 0 && (norm(p.name) === norm(title) || mentions(p.name, title))) ?? null;
  for (const { recipe, entry } of history) {
    if (!entry.cookedOn) continue;
    const d = daysBetween(entry.cookedOn, today);
    if (d < 0 || d > within) continue;
    seen.add(`${recipe.id}|${entry.cookedOn}`);
    out.push({ title: recipe.title, recipeId: recipe.id, entryId: entry.id, madeOn: entry.cookedOn, daysAgo: d, yieldNote: entry.yieldNote, from: "cooking-history", inPantry: inPantry(recipe.title) });
  }
  for (const plan of plans) {
    for (const m of dayOf(plan).completion?.made ?? []) {
      const d = daysBetween(m.madeOn, today);
      if (d < 0 || d > within || seen.has(`${m.recipeId}|${m.madeOn}`)) continue;
      seen.add(`${m.recipeId}|${m.madeOn}`);
      const yieldNote = [m.count ? `${m.count} sausages` : "", m.finishedG ? `${(m.finishedG / 1000).toFixed(2)} kg` : ""].filter(Boolean).join(" · ");
      out.push({ title: m.title, recipeId: m.recipeId, entryId: m.entryId, madeOn: m.madeOn, daysAgo: d, yieldNote, from: "sausage-day", inPantry: inPantry(m.title) });
    }
  }
  return out.sort((a, b) => a.daysAgo - b.daysAgo || a.title.localeCompare(b.title));
}

export function buildKnowledge(args: { pantry: PantryItem[] | null; recent: RecentFood[]; said: Mentioned[]; today: string; recipeTitles?: string[] }): Knowledge {
  const { pantry, recent, said, today } = args;
  const titles = new Set((args.recipeTitles ?? []).map(norm));
  const have: Have[] = [];
  const wantUsed = (name: string) => said.some((m) => m.intent === "use" && mentions(name, m.name));
  const named = (name: string) => said.some((m) => mentions(name, m.name) || mentions(m.name, name));

  for (const p of pantry ?? []) {
    if (p.onHand <= 0) continue;
    const daysLeft = p.bestBefore ? daysBetween(today, p.bestBefore) : null;
    const zones = [...new Set((p.places?.length ? p.places.map((x) => x.location) : [p.location]).map(zoneOf))];
    const leftover = /\bleft ?-?overs?\b|\bcooked\b/i.test(p.name) || titles.has(norm(p.name));
    have.push({
      name: p.name, source: "inventory", zones,
      evidence: `Pantry: ${stockLabel(p)}${p.bestBefore ? ` · ${whenLabel(daysLeft!)}` : ""}${p.opened ? " · opened" : ""}`,
      bestBefore: p.bestBefore, daysLeft, opened: p.opened === true, expired: daysLeft != null && daysLeft < 0, leftover, wantUsed: wantUsed(p.name), mentioned: named(p.name),
    });
  }
  for (const r of recent) {
    if (r.inPantry) continue; // Pantry already lists it, with its own count
    have.push({
      name: r.title, source: "recent", zones: [],
      evidence: `Made ${ago(r.daysAgo)}${r.yieldNote ? ` (${r.yieldNote})` : ""} — ${r.from === "sausage-day" ? "Sausage Day record" : "Kitchen's cooking history"}; Pantry doesn't count it`,
      bestBefore: null, daysLeft: null, opened: false, expired: false, leftover: true, wantUsed: wantUsed(r.title), mentioned: named(r.title),
    });
  }
  for (const m of said) {
    if (m.intent === "made") {
      // "I made bratwurst yesterday": Kitchen's history confirms it if it has it.
      const known = recent.find((r) => mentions(r.title, m.name) || mentions(m.name, r.title));
      if (known) continue;
    }
    // Same food in Inventory (same words): Inventory's record is the evidence. A near match
    // ("cheese" said, "Cream cheese" in Pantry) stays separate.
    const inv = have.find((h) => h.source === "inventory" && sameFood(h.name, m.name));
    if (inv && m.intent !== "made") { if (m.intent === "use") inv.wantUsed = true; continue; }
    have.push({
      name: m.name, source: "said", zones: m.where ? [zoneOf(m.where)] : [],
      evidence: `You said${m.intent === "made" ? ` you made it${m.when ? ` ${m.when}` : ""}` : m.amount ? `: ${m.amount}` : ""}${m.where ? ` (${m.where})` : ""} — not in Inventory`,
      bestBefore: null, daysLeft: null, opened: false, expired: false, leftover: m.intent === "made", wantUsed: m.intent === "use", mentioned: true,
    });
  }

  const byZone: Record<Zone, Have[]> = { fridge: [], freezer: [], pantry: [], storage: [] };
  for (const h of have) if (h.source === "inventory") for (const z of h.zones) byZone[z].push(h);
  const useSoon = have.filter((h) => !h.expired && ((h.daysLeft != null && h.daysLeft <= 4) || h.opened || h.wantUsed || (h.leftover && h.source !== "said")))
    .sort((a, b) => Number(b.wantUsed) - Number(a.wantUsed) || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
  return { pantryConnected: pantry != null, have, byZone, useSoon, expired: have.filter((h) => h.expired), recent, said };
}

export const sameFood = (a: string, b: string) => mentions(a, b) && mentions(b, a);

// The best evidence Kitchen has for an ingredient name, or null. Expired food doesn't count as "have".
// One direction only: the household's "Cheddar cheese" is a cheese, but their "cheese" isn't cream cheese.
// Several words can name the same thing ("sausage", "bratwurst"): the best match across all of them.
export function findHave(k: Knowledge, word: string | string[], not: string[] = [], skip: Set<string> = new Set()): Have | null {
  const order: HaveSource[] = ["said", "recent", "inventory"];
  const words = Array.isArray(word) ? word : [word];
  const hits = k.have.filter((h) => !h.expired && !skip.has(norm(h.name)) && words.some((w) => mentions(h.name, w)) && !not.some((n) => mentions(h.name, n)));
  hits.sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || Number(b.wantUsed) - Number(a.wantUsed) || order.indexOf(a.source) - order.indexOf(b.source));
  return hits[0] ?? null;
}
