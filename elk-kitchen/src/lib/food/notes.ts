// Kitchen's side-notes about food that lives in ELK Inventory: the photo, what
// the person said, how sure anyone was, and what later happened to it.
//
// ELK Inventory owns the food itself (item, quantity, place, movements). A
// FoodNote only points at an Inventory item by id and keeps what Inventory has
// no field for: photos, the person's own words ("two bones", "half a bag"),
// whether the name was typed or suggested from a photo, and a history of uses.
// A note never says how much is left — only Inventory knows that — so a used-up
// food stays in this history without ever appearing as available stock.
//
// Kept on this device (like tasting cards) and included in Backup & import.

import type { PhotoRef } from "../../types/recipe";
import type { FoodKind } from "./describe";

export const FOOD_KEY = "elk-kitchen-food-v1";
type KV = Pick<Storage, "getItem" | "setItem">;

// How the name on the record came about. A photo only ever *suggests*; the
// person's confirmation is what makes it the record.
export type NameFrom = "you-said" | "photo-suggested" | "photo-suggested-edited";
export type Confidence = "low" | "medium" | "high";

export type FoodUse = {
  id: string;
  at: string;
  kind: "used" | "moved" | "returned" | "undone";
  quantity: number;
  unit: string;
  // Inventory's batch id for this change (what undo needs).
  requestId: string;
  // "Split pea soup", "eaten", "moved to Fridge".
  for: string;
  sessionId: string | null;
};

export type FoodNote = {
  // The Inventory batch id of the add, so saving twice can't make two notes.
  id: string;
  itemId: string;
  itemName: string;
  // What was said or typed, word for word.
  description: string;
  nameFrom: NameFrom;
  // What the photo suggested, if it did (kept even when the person changed it).
  suggestedName: string;
  confidence: Confidence | null;
  quantityText: string;
  amountKnown: boolean;
  approximate: boolean;
  kinds: FoodKind[];
  notes: string;
  location: string;
  madeOn: string | null;
  photos: PhotoRef[];
  // SHA-256 of each photo's bytes, so the same picture isn't saved twice by accident.
  fingerprints: string[];
  addedAt: string;
  addedBy: string;
  // "kitchen": added through Add Food. "inventory": food Inventory already had when it was first used here.
  origin: "kitchen" | "inventory";
  uses: FoodUse[];
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const KINDS: FoodKind[] = ["raw", "homemade", "leftover", "opened", "prepared", "garden"];

export function normalizeNote(v: unknown): FoodNote | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!str(o.id) || !str(o.itemId)) return null;
  const photos = Array.isArray(o.photos) ? o.photos.filter((p): p is PhotoRef => !!p && typeof (p as PhotoRef).id === "string").map((p) => ({ id: p.id, caption: str(p.caption), addedAt: str(p.addedAt) })) : [];
  const uses = Array.isArray(o.uses) ? o.uses.flatMap((u): FoodUse[] => {
    const x = u as Record<string, unknown>;
    if (!x || !str(x.requestId) || !["used", "moved", "returned", "undone"].includes(str(x.kind))) return [];
    return [{ id: str(x.id, str(x.requestId)), at: str(x.at), kind: x.kind as FoodUse["kind"], quantity: Number(x.quantity) || 0, unit: str(x.unit), requestId: str(x.requestId), for: str(x.for), sessionId: typeof x.sessionId === "string" ? x.sessionId : null }];
  }) : [];
  return {
    id: str(o.id), itemId: str(o.itemId), itemName: str(o.itemName), description: str(o.description),
    nameFrom: (["you-said", "photo-suggested", "photo-suggested-edited"] as const).find((n) => n === o.nameFrom) ?? "you-said",
    suggestedName: str(o.suggestedName), confidence: (["low", "medium", "high"] as const).find((c) => c === o.confidence) ?? null,
    quantityText: str(o.quantityText), amountKnown: o.amountKnown === true, approximate: o.approximate === true,
    kinds: strs(o.kinds).filter((k): k is FoodKind => (KINDS as string[]).includes(k)), notes: str(o.notes), location: str(o.location),
    madeOn: typeof o.madeOn === "string" ? o.madeOn : null, photos, fingerprints: strs(o.fingerprints),
    addedAt: str(o.addedAt), addedBy: str(o.addedBy), origin: o.origin === "inventory" ? "inventory" : "kitchen", uses,
  };
}

export class FoodStore {
  private readonly kv: KV;
  constructor(kv: KV) { this.kv = kv; }

  list(): FoodNote[] {
    try {
      const v = JSON.parse(this.kv.getItem(FOOD_KEY) ?? "[]");
      return Array.isArray(v) ? v.map(normalizeNote).filter((n): n is FoodNote => !!n) : [];
    } catch { return []; }
  }

  private save(all: FoodNote[]) { this.kv.setItem(FOOD_KEY, JSON.stringify(all)); }

  get(id: string): FoodNote | null { return this.list().find((n) => n.id === id) ?? null; }
  byItem(itemId: string): FoodNote[] { return this.list().filter((n) => n.itemId === itemId); }
  byFingerprint(fp: string): FoodNote | null { return this.list().find((n) => n.fingerprints.includes(fp)) ?? null; }

  // Adding the same id again changes nothing (a retried save, an imported backup).
  add(note: FoodNote): boolean {
    const all = this.list();
    if (all.some((n) => n.id === note.id)) return false;
    this.save([...all, note]);
    return true;
  }

  // Record a change against the newest note for the item; food Inventory
  // already had gets a bare note so its history is kept too.
  recordUse(item: { id: string; name: string }, use: FoodUse, now: string): FoodNote {
    const all = this.list();
    const mine = all.filter((n) => n.itemId === item.id);
    let note = mine[mine.length - 1];
    if (!note) {
      note = { id: `inventory:${item.id}`, itemId: item.id, itemName: item.name, description: "", nameFrom: "you-said", suggestedName: "", confidence: null, quantityText: "", amountKnown: false, approximate: false, kinds: [], notes: "", location: "", madeOn: null, photos: [], fingerprints: [], addedAt: now, addedBy: "", origin: "inventory", uses: [] };
      all.push(note);
    }
    if (!note.uses.some((u) => u.requestId === use.requestId && u.kind === use.kind)) note.uses = [...note.uses, use];
    this.save(all);
    return note;
  }

  // An undo: the original use stays in the history, marked undone by a later entry.
  recordUndo(requestId: string, undoBatchId: string, now: string): void {
    const all = this.list();
    for (const n of all) {
      const orig = n.uses.find((u) => u.requestId === requestId && u.kind !== "undone");
      if (orig && !n.uses.some((u) => u.kind === "undone" && u.requestId === requestId)) {
        n.uses = [...n.uses, { id: undoBatchId, at: now, kind: "undone", quantity: orig.quantity, unit: orig.unit, requestId, for: orig.for, sessionId: orig.sessionId }];
      }
    }
    this.save(all);
  }
}

// What a note says was taken out and not put back.
export function netUsed(note: FoodNote): number {
  const undone = new Set(note.uses.filter((u) => u.kind === "undone").map((u) => u.requestId));
  return note.uses.filter((u) => u.kind === "used" && !undone.has(u.requestId)).reduce((n, u) => n + u.quantity, 0);
}

// SHA-256 of a photo's bytes. Exact copies match; a re-saved or re-compressed photo is a different picture.
export async function fingerprintBytes(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
