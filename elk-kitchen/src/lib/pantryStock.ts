// The one place Kitchen changes ELK Pantry stock, and the boundary for it.
//
// ELK Inventory owns quantities, lots and stock movements. Kitchen never
// writes Inventory's tables; it calls Inventory's own family-only functions
// (supabase-pantry.sql), the same ones Inventory's Pantry screen calls:
//   pantry_use(item, quantity, lot, request id)  — take some out of one lot, or oldest first
//   pantry_receive(item, quantity, place, best before, made on, new name, unit, request id)
//                                                — put something in (a new product if named)
//   pantry_undo(batch id)                        — reverse one of those, once
// Each call takes a request id that Kitchen generates and keeps. A retry with
// the same id does nothing, so a weak connection can't use something twice.
// Inventory refuses (changing nothing) if there isn't enough.
//
// Nothing happens because a recipe was opened or a cook started (doctrine
// §7). Every call here follows a person confirming the exact item, lot and
// whole-number count on the review screen. Pantry counts packages, not
// grams, so Kitchen never converts a spoken "40 g" into a stock change.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PantryAction } from "../types/cooking";
import { newId } from "./recipeModel";

export type StockLot = {
  id: string;
  remaining: number;
  location: string;
  bestBefore: string | null;
  purchasedOn: string | null;
  createdAt: string;
};
export type StockItem = { id: string; name: string; unit: string; onHand: number; lots: StockLot[] };

export type StockLoad =
  | { status: "ready"; items: StockItem[] }
  | { status: "not-set-up" }
  | { status: "error"; error: string };

type ItemRow = { id: string; name: string; quantity: number | null; attributes: Record<string, unknown> | null };
type LotRow = { id: string; item_id: string; quantity_remaining: number; location: string | null; best_before: string | null; purchased_on: string | null; created_at: string };

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table/i.test(e.message ?? "");

// Open lots in the order Inventory uses them (oldest purchase first).
export function stockFrom(items: ItemRow[], lots: LotRow[]): StockItem[] {
  return items.map((item) => {
    const mine = lots.filter((l) => l.item_id === item.id);
    const open = mine.filter((l) => l.quantity_remaining > 0)
      .sort((a, b) => (a.purchased_on ?? "0000").localeCompare(b.purchased_on ?? "0000") || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((l) => ({ id: l.id, remaining: l.quantity_remaining, location: l.location?.trim() ?? "", bestBefore: l.best_before, purchasedOn: l.purchased_on, createdAt: l.created_at }));
    const u = item.attributes?.unit;
    return {
      id: item.id,
      name: item.name.trim(),
      unit: typeof u === "string" && u.trim() ? u.trim() : "items",
      // Before a product has any lots, Inventory's own count is all there is.
      onHand: mine.length === 0 ? Math.max(0, item.quantity ?? 0) : open.reduce((n, l) => n + l.remaining, 0),
      lots: open,
    };
  }).filter((i) => i.name);
}

export async function loadStock(client: SupabaseClient): Promise<StockLoad> {
  const [items, lots] = await Promise.all([
    client.from("inventory_items").select("id,name,quantity,attributes").eq("domain", "food-storage").limit(2000),
    client.from("stock_lots").select("id,item_id,quantity_remaining,location,best_before,purchased_on,created_at").limit(5000),
  ]);
  for (const r of [items, lots]) {
    if (r.error) return isMissingTable(r.error) ? { status: "not-set-up" } : { status: "error", error: r.error.message };
  }
  return { status: "ready", items: stockFrom(items.data as ItemRow[], lots.data as LotRow[]) };
}

export const lotLabel = (l: StockLot | null) =>
  !l ? "Oldest first" : [l.location || "No place set", l.bestBefore ? `best before ${l.bestBefore}` : "", `${l.remaining} left`].filter(Boolean).join(" · ");

// Which Pantry products an ingredient might be. Names only (Inventory has no
// ingredient catalogue yet, doctrine Q1), so these are offered, never assumed.
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/(es|s)$/, ""));
export function candidates(ingredient: string, items: StockItem[]): StockItem[] {
  const want = words(ingredient);
  if (!want.length) return [];
  return items
    .map((i) => ({ i, score: words(i.name).filter((w) => want.includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.i.onHand - a.i.onHand)
    .map((x) => x.i);
}

export type StockResult = { ok: true; action: PantryAction } | { ok: false; error: string };

function message(error: { message: string; code?: string }): string {
  if (error.code === "PGRST202") return "ELK Pantry's stock functions aren't set up in this database yet.";
  if (error.code === "42501" || /family/i.test(error.message)) return "Only ELK family members can change Pantry stock.";
  return error.message;
}

// Use `quantity` of `item` — from one lot, or oldest first when lot is null.
export async function useStock(
  client: SupabaseClient,
  args: { item: StockItem; lot: StockLot | null; quantity: number; requestId?: string; now?: string },
): Promise<StockResult> {
  if (!Number.isInteger(args.quantity) || args.quantity < 1) return { ok: false, error: "Pantry counts whole packages: use 1 or more." };
  const requestId = args.requestId ?? newId();
  const { data, error } = await client.rpc("pantry_use", {
    p_item_id: args.item.id, p_quantity: args.quantity, p_lot_id: args.lot?.id ?? null, p_request_id: requestId,
  });
  if (error) return { ok: false, error: message(error) };
  return {
    ok: true,
    action: {
      requestId: (data as string) ?? requestId, kind: "used", itemId: args.item.id, itemName: args.item.name, lotId: args.lot?.id ?? null,
      lotLabel: lotLabel(args.lot), quantity: args.quantity, unit: args.item.unit, at: args.now ?? new Date().toISOString(),
      bestBefore: args.lot?.bestBefore ?? null, location: args.lot?.location ?? "", undone: false, undoBatchId: null,
    },
  };
}

// Put the finished food into Pantry: an existing product, or a new one by name.
export async function receiveFinished(
  client: SupabaseClient,
  args: { item: StockItem | null; newName: string; unit: string; quantity: number; location: string; bestBefore: string | null; madeOn: string; requestId?: string; newItemId?: string; now?: string },
): Promise<StockResult> {
  if (!Number.isInteger(args.quantity) || args.quantity < 1) return { ok: false, error: "How many packages? It has to be a whole number, 1 or more." };
  if (!args.item && !args.newName.trim()) return { ok: false, error: "Give the finished food a name." };
  const requestId = args.requestId ?? newId();
  const itemId = args.item?.id ?? args.newItemId ?? newId();
  const { data, error } = await client.rpc("pantry_receive", {
    p_item_id: itemId, p_quantity: args.quantity, p_location: args.location.trim(), p_best_before: args.bestBefore || null,
    p_purchased_on: args.madeOn, p_new_name: args.item ? null : args.newName.trim(), p_unit: args.item ? null : (args.unit.trim() || "packs"),
    p_request_id: requestId,
  });
  if (error) return { ok: false, error: message(error) };
  return {
    ok: true,
    action: {
      requestId: (data as string) ?? requestId, kind: "received", itemId, itemName: args.item?.name ?? args.newName.trim(), lotId: null,
      lotLabel: [args.location.trim() || "No place set", args.bestBefore ? `best before ${args.bestBefore}` : ""].filter(Boolean).join(" · "),
      quantity: args.quantity, unit: args.item?.unit ?? (args.unit.trim() || "packs"), at: args.now ?? new Date().toISOString(),
      bestBefore: args.bestBefore || null, location: args.location.trim(), undone: false, undoBatchId: null,
    },
  };
}

// Move some of one batch to another place (Inventory's pantry_move; the product's total doesn't change).
// Only in the newer ELK Pantry: without it Kitchen says so and changes nothing.
export async function moveStock(
  client: SupabaseClient,
  args: { item: StockItem; lot: StockLot; quantity: number; toLocation: string; requestId?: string; now?: string },
): Promise<StockResult> {
  if (!Number.isInteger(args.quantity) || args.quantity < 1) return { ok: false, error: "Pantry counts whole packages: move 1 or more." };
  if (!args.toLocation.trim()) return { ok: false, error: "Where should it go?" };
  const requestId = args.requestId ?? newId();
  const { data, error } = await client.rpc("pantry_move", { p_lot_id: args.lot.id, p_quantity: args.quantity, p_to_location: args.toLocation.trim(), p_request_id: requestId });
  if (error) return { ok: false, error: error.code === "PGRST202" || /pantry_move.*does not exist|could not find the function/i.test(error.message) ? "Moving food between places isn't switched on in ELK Pantry yet." : message(error) };
  return {
    ok: true,
    action: {
      requestId: (data as string) ?? requestId, kind: "moved", itemId: args.item.id, itemName: args.item.name, lotId: args.lot.id,
      lotLabel: `${args.lot.location || "No place set"} → ${args.toLocation.trim()}`, quantity: args.quantity, unit: args.item.unit,
      at: args.now ?? new Date().toISOString(), bestBefore: args.lot.bestBefore, location: args.toLocation.trim(), undone: false, undoBatchId: null,
    },
  };
}

export async function undoStock(client: SupabaseClient, action: PantryAction): Promise<{ ok: true; undoBatchId: string } | { ok: false; error: string }> {
  const { data, error } = await client.rpc("pantry_undo", { p_batch_id: action.requestId });
  if (error) return { ok: false, error: message(error) };
  return { ok: true, undoBatchId: data as string };
}
