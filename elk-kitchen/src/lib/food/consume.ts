// Using food up: every change goes to ELK Inventory through its own functions
// (pantry_use / pantry_move / pantry_undo, via pantryStock.ts), after the
// person confirmed the exact food and count. Kitchen then writes the matching
// line in the food's history, so "what was this used for" survives even after
// Inventory shows none left.
//
//   use all      → everything Inventory has of it, oldest batch first
//   use some     → a whole number
//   return       → put back what a cook didn't actually use (undo, then use the part that was)
//   undo         → reverse one change, once (Inventory refuses a second time)
//   move         → some of a batch to another place
//
// "Available" is only ever Inventory's count. A used-up food is in the history
// (FoodNote.uses), never in the list of what's on hand.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PantryAction } from "../../types/cooking";
import { loadStock, moveStock, undoStock, useStock, type StockItem, type StockLot, type StockResult } from "../pantryStock";
import type { FoodStore } from "./notes";

export type UseFor = { label: string; sessionId?: string | null };

const record = (store: FoodStore, item: { id: string; name: string }, a: PantryAction, kind: "used" | "moved" | "returned", why: UseFor) =>
  store.recordUse(item, { id: a.requestId, at: a.at, kind, quantity: a.quantity, unit: a.unit, requestId: a.requestId, for: why.label, sessionId: why.sessionId ?? null }, a.at);

// quantity "all" = everything in the batch, or in Inventory when no batch is chosen.
export async function useFood(
  client: SupabaseClient, store: FoodStore,
  args: { item: StockItem; lot?: StockLot | null; quantity: number | "all"; why: UseFor; requestId?: string; now?: string },
): Promise<StockResult> {
  const lot = args.lot ?? null;
  const left = lot ? lot.remaining : args.item.onHand;
  const quantity = args.quantity === "all" ? left : args.quantity;
  if (left <= 0) return { ok: false, error: `Inventory shows none of ${args.item.name} left.` };
  if (quantity > left) return { ok: false, error: `Inventory only has ${left} ${args.item.unit} of ${args.item.name}${lot ? " in that batch" : ""}, so nothing was changed.` };
  const r = await useStock(client, { item: args.item, lot, quantity, requestId: args.requestId, now: args.now });
  if (r.ok) record(store, args.item, r.action, "used", args.why);
  return r;
}

export async function moveFood(
  client: SupabaseClient, store: FoodStore,
  args: { item: StockItem; lot: StockLot; quantity: number; toLocation: string; requestId?: string; now?: string },
): Promise<StockResult> {
  if (args.quantity > args.lot.remaining) return { ok: false, error: `Only ${args.lot.remaining} ${args.item.unit} in that batch, so nothing was moved.` };
  const r = await moveStock(client, args);
  if (r.ok) record(store, args.item, r.action, "moved", { label: `moved to ${args.toLocation.trim()}` });
  return r;
}

export type UndoResult = { ok: true; undoBatchId: string } | { ok: false; error: string };

export async function undoFood(client: SupabaseClient, store: FoodStore, action: PantryAction, now = new Date().toISOString()): Promise<UndoResult> {
  const r = await undoStock(client, action);
  if (r.ok) store.recordUndo(action.requestId, r.undoBatchId, now);
  return r;
}

// "We only used one of the two bones." The cook used `action.quantity`; the
// person says `stillHave` of them were not touched. Inventory can only undo a
// whole change, so the change is undone and the part that really was used is
// taken again — two entries in Inventory's history, both visible.
export async function returnUnused(
  client: SupabaseClient, store: FoodStore,
  args: { action: PantryAction; returning: number; why: UseFor; newRequestId?: string; now?: string },
): Promise<{ ok: true; undoBatchId: string; remaining: PantryAction | null } | { ok: false; error: string }> {
  const { action, returning } = args;
  if (action.kind !== "used") return { ok: false, error: "Only food taken out can be returned." };
  if (!Number.isInteger(returning) || returning < 1 || returning > action.quantity) return { ok: false, error: `Return between 1 and ${action.quantity} ${action.unit}.` };
  const now = args.now ?? new Date().toISOString();
  const undone = await undoFood(client, store, action, now);
  if (!undone.ok) return undone;
  const kept = action.quantity - returning;
  if (kept === 0) return { ok: true, undoBatchId: undone.undoBatchId, remaining: null };
  // Read Inventory again: the undo put the batch back, and the part that was used comes from the same batch if it can.
  const fresh = await loadStock(client);
  const item = fresh.status === "ready" ? fresh.items.find((i) => i.id === action.itemId) : null;
  if (!item) return { ok: false, error: "Put it all back, but couldn't re-read Inventory to take the part you did use. Use it again by hand." };
  const lot = action.lotId ? item.lots.find((l) => l.id === action.lotId && l.remaining >= kept) ?? null : null;
  const again = await useFood(client, store, { item, lot, quantity: kept, why: args.why, requestId: args.newRequestId, now });
  if (!again.ok) return { ok: false, error: `Put it all back, but couldn't take the ${kept} you did use: ${again.error}` };
  return { ok: true, undoBatchId: undone.undoBatchId, remaining: again.action };
}
