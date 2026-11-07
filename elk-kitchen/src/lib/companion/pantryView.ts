// ELK Pantry as Kitchen talks about it. Every number here is Pantry's own:
// whole packages with Pantry's unit, Pantry's places and best-before dates.
// Nothing is estimated, converted or rounded.

import type { PantryItem } from "../pantry";

export function daysBetween(fromIso: string, toIso: string): number {
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(toIso) - day(fromIso)) / 86_400_000);
}

export type SoonItem = { item: PantryItem; daysLeft: number; bestBefore: string };

// Open batches with a best-before date within `within` days (or already past),
// soonest first. Uses best-before, not the order Pantry takes stock (C6).
export function useSoon(pantry: PantryItem[], today: string, within = 4): SoonItem[] {
  const out: SoonItem[] = [];
  for (const item of pantry) {
    if (item.onHand <= 0 || !item.bestBefore) continue;
    const daysLeft = daysBetween(today, item.bestBefore);
    if (daysLeft <= within) out.push({ item, daysLeft, bestBefore: item.bestBefore });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name));
}

// Pantry products that are cooked food: named "leftover…", or named like one
// of the family's recipes (what Kitchen's review puts away is named after the
// recipe). Only what's in stock.
export function leftovers(pantry: PantryItem[], recipeTitles: string[]): PantryItem[] {
  const titles = new Set(recipeTitles.map((t) => t.trim().toLowerCase()).filter(Boolean));
  return pantry.filter((p) => p.onHand > 0 && (/\bleft ?-?overs?\b|\bcooked\b/i.test(p.name) || titles.has(p.name.trim().toLowerCase())));
}

export function whenLabel(daysLeft: number): string {
  if (daysLeft < -1) return `best before was ${-daysLeft} days ago`;
  if (daysLeft === -1) return "best before was yesterday";
  if (daysLeft === 0) return "best before today";
  if (daysLeft === 1) return "best before tomorrow";
  return `best before in ${daysLeft} days`;
}

// "2 packs · Garage freezer" / "2 packs · Fridge, 1 pack · Chest freezer"
export function stockLabel(p: PantryItem): string {
  const places = (p.places ?? []).filter((l) => l.quantity > 0);
  if (places.length > 1) return places.map((l) => `${l.quantity} ${p.unit}${l.location ? ` · ${l.location}` : ""}`).join(", ");
  return `${p.onHand} ${p.unit}${p.location ? ` · ${p.location}` : ""}`;
}

export const isLow = (p: PantryItem) => p.lowStockAt != null && p.onHand <= p.lowStockAt;
