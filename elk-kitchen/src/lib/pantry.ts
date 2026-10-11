// ELK Pantry, read-only. ELK Inventory owns the pantry (supabase-pantry.sql in
// elk-inventory); Kitchen only reads the same rows Inventory's Pantry screen
// shows, with the signed-in person's own token, so the family-only rules
// there decide who sees anything. Nothing here writes, copies or caches stock.
// The one write is adding to Pantry's shopping list, through Inventory's own
// pantry_shopping_add (which skips anything already on the list).
//
// The pantry is whatever the family has entered, so a name missing from it
// means "Pantry doesn't know", never "you don't have it" (see pantryCheck.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PantryItem } from "../prototype/ideas/types";

export type { PantryItem };

export type PantryLoad =
  | { status: "ready"; items: PantryItem[] }
  // Inventory's pantry tables aren't in this project yet.
  | { status: "not-set-up" }
  | { status: "error"; error: string };

type ItemRow = { id: string; name: string; quantity: number | null; attributes: Record<string, unknown> | null };
type LotRow = { item_id: string; quantity_remaining: number; location: string | null; best_before: string | null; purchased_on: string | null; created_at: string };

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table/i.test(e.message ?? "");

function unitOf(item: ItemRow): string {
  const u = item.attributes?.unit;
  return typeof u === "string" && u.trim() ? u.trim() : "items";
}

// Mirrors Inventory's pantryModel.summarize: lots are the truth once a
// product has any; before that, the product's own count is all there is.
export function summarizePantry(items: ItemRow[], lots: LotRow[]): PantryItem[] {
  return items.map((item) => {
    const mine = lots.filter((l) => l.item_id === item.id);
    const open = mine.filter((l) => l.quantity_remaining > 0)
      .sort((a, b) => (a.purchased_on ?? "0000").localeCompare(b.purchased_on ?? "0000") || a.created_at.localeCompare(b.created_at));
    const onHand = mine.length === 0 ? Math.max(0, item.quantity ?? 0) : open.reduce((n, l) => n + l.quantity_remaining, 0);
    const dates = open.map((l) => l.best_before).filter((d): d is string => !!d).sort();
    return {
      name: item.name.trim(),
      onHand,
      unit: unitOf(item),
      bestBefore: dates[0] ?? null,
      location: open[0]?.location?.trim() ?? "",
    };
  }).filter((p) => p.name);
}

export async function loadPantry(client: SupabaseClient): Promise<PantryLoad> {
  const [items, lots] = await Promise.all([
    // Same filter as Inventory's isPantryItem: food-storage products only.
    client.from("inventory_items").select("id,name,quantity,attributes").eq("domain", "food-storage").limit(2000),
    client.from("stock_lots").select("item_id,quantity_remaining,location,best_before,purchased_on,created_at").limit(5000),
  ]);
  for (const r of [items, lots]) {
    if (r.error) return isMissingTable(r.error) ? { status: "not-set-up" } : { status: "error", error: r.error.message };
  }
  return { status: "ready", items: summarizePantry(items.data as ItemRow[], lots.data as LotRow[]) };
}

export type ShoppingAdd = { ok: true; added: number } | { ok: false; error: string };

export async function addToShoppingList(client: SupabaseClient, names: string[], recipeTitle: string): Promise<ShoppingAdd> {
  const { data, error } = await client.rpc("pantry_shopping_add", {
    p_names: names, p_note: recipeTitle.trim() ? `for ${recipeTitle.trim()}`.slice(0, 500) : null, p_source: "recipe",
  });
  if (error) {
    // PGRST202: Inventory's database doesn't have the shopping list yet.
    return { ok: false, error: error.code === "PGRST202" ? "The shopping list isn't switched on in ELK Pantry yet." : error.message };
  }
  return { ok: true, added: data as number };
}
