// What happened to food Kitchen knows about: used up, or used in part. The
// history comes from Kitchen's notes; whether any is *left* comes only from
// Inventory's count, so a used-up food is listed here and never as available.

import type { PhotoRef } from "../../types/recipe";
import type { StockItem } from "../pantryStock";
import { netUsed, type FoodNote } from "./notes";

export type FoodHistoryRow = {
  itemId: string;
  itemName: string;
  used: number;
  unit: string;
  // What the last (not undone) use was for: a dish, "eaten".
  lastFor: string;
  lastAt: string;
  photos: PhotoRef[];
  onHand: number;
};

export function foodHistory(notes: FoodNote[], stock: StockItem[]): { inStock: FoodHistoryRow[]; usedUp: FoodHistoryRow[] } {
  const byItem = new Map<string, FoodNote[]>();
  for (const n of notes) byItem.set(n.itemId, [...(byItem.get(n.itemId) ?? []), n]);
  const rows: FoodHistoryRow[] = [];
  for (const [itemId, mine] of byItem) {
    const used = mine.reduce((n, x) => n + netUsed(x), 0);
    if (used <= 0) continue;
    const undone = new Set(mine.flatMap((n) => n.uses.filter((u) => u.kind === "undone").map((u) => u.requestId)));
    const last = mine.flatMap((n) => n.uses).filter((u) => u.kind === "used" && !undone.has(u.requestId)).sort((a, b) => a.at.localeCompare(b.at)).pop();
    const now = stock.find((i) => i.id === itemId);
    rows.push({
      itemId, itemName: now?.name ?? mine[0].itemName, used, unit: now?.unit ?? mine.flatMap((n) => n.uses).find((u) => u.unit)?.unit ?? "",
      lastFor: last?.for ?? "", lastAt: last?.at ?? "", photos: mine.flatMap((n) => n.photos), onHand: now?.onHand ?? 0,
    });
  }
  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { inStock: rows.filter((r) => r.onHand > 0), usedUp: rows.filter((r) => r.onHand <= 0) };
}
