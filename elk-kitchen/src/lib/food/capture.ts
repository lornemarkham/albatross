// Adding food: from a draft the person has confirmed to ELK Inventory, plus
// Kitchen's note (photo, words, how sure).
//
// Inventory gets the food through its own pantry_receive (the same function
// the finished-food form uses), so it owns the item, count, place and
// movement. Kitchen keeps the FoodNote beside it. Nothing here guesses:
//   - a photo or description only ever fills in a *draft*; saving needs a tap;
//   - a near match ("Pork bones" vs "Pork shoulder bones") is offered, never merged;
//   - the same photo, or the same food in the same place a moment ago, asks first.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhotoRef } from "../../types/recipe";
import type { PantryAction } from "../../types/cooking";
import { candidates, receiveFinished, type StockItem } from "../pantryStock";
import { sameFood } from "../chef/knowledge";
import type { FoodDraft } from "./describe";
import type { Confidence, FoodNote, FoodStore, NameFrom } from "./notes";

export type CapturedPhoto = { ref: PhotoRef; fingerprint: string };

// What a photo (or the person) called the food, and how.
export type Identification = {
  nameFrom: NameFrom;
  suggestedName: string;
  confidence: Confidence | null;
};

export const SAID_IT: Identification = { nameFrom: "you-said", suggestedName: "", confidence: null };

// If a name came from a photo suggestion, say whether the person changed it.
export function identify(finalName: string, suggestion: { name: string; confidence: Confidence } | null): Identification {
  if (!suggestion) return SAID_IT;
  const same = finalName.trim().toLowerCase() === suggestion.name.trim().toLowerCase();
  return { nameFrom: same ? "photo-suggested" : "photo-suggested-edited", suggestedName: suggestion.name, confidence: suggestion.confidence };
}

export type Duplicate =
  | { kind: "photo"; note: FoodNote }
  | { kind: "recent"; note: FoodNote; minutes: number };

export type AddPlan = {
  // The Inventory product this would join (same name), or null for a new one.
  existing: StockItem | null;
  // Other products with some of the same words: offered, never assumed.
  similar: StockItem[];
  // Inventory counts this product in another unit than the draft.
  unitMismatch: string | null;
  duplicates: Duplicate[];
  // The plain-words summary shown before the person confirms.
  summary: string[];
};

const RECENT_MINUTES = 30;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function planAdd(draft: FoodDraft, stock: StockItem[], notes: FoodNote[], fingerprints: string[], now: string): AddPlan {
  const existing = stock.find((i) => norm(i.name) === norm(draft.name)) ?? stock.find((i) => sameFood(i.name, draft.name)) ?? null;
  const similar = candidates(draft.name, stock).filter((i) => i.id !== existing?.id).slice(0, 3);
  const unitMismatch = existing && norm(existing.unit) !== norm(draft.unit) && existing.unit !== "items" ? existing.unit : null;

  const duplicates: Duplicate[] = [];
  for (const fp of fingerprints) {
    const hit = notes.find((n) => n.fingerprints.includes(fp));
    if (hit && !duplicates.some((d) => d.kind === "photo" && d.note.id === hit.id)) duplicates.push({ kind: "photo", note: hit });
  }
  for (const n of notes) {
    if (n.origin !== "kitchen" || !(norm(n.itemName) === norm(draft.name) || sameFood(n.itemName, draft.name))) continue;
    if (draft.location && n.location && norm(draft.location) !== norm(n.location)) continue;
    const minutes = Math.round((Date.parse(now) - Date.parse(n.addedAt)) / 60_000);
    if (minutes >= 0 && minutes <= RECENT_MINUTES && !duplicates.some((d) => d.note.id === n.id)) duplicates.push({ kind: "recent", note: n, minutes });
  }

  const unit = existing?.unit ?? draft.unit;
  const summary = [
    `${draft.amountKnown ? `${draft.count} ${unit}` : "Amount not known (counted as 1 portion)"} of ${existing?.name ?? draft.name}`,
    draft.approximate && draft.amountKnown ? `Amount is approximate: you said ${draft.quantityText}` : "",
    draft.location ? `Put in: ${draft.location}${draft.locationFrom === "frozen" ? " (you said it's frozen)" : ""}` : "No place chosen",
    existing ? `Adds a new batch to Inventory's “${existing.name}” (${existing.onHand} ${existing.unit} now)` : "Adds a new item to Inventory",
    draft.notes ? `Note: ${draft.notes}` : "",
  ].filter(Boolean);
  return { existing, similar, unitMismatch, duplicates, summary };
}

export type AddResult =
  | { ok: true; action: PantryAction; note: FoodNote }
  | { ok: false; error: string; duplicates?: Duplicate[] };

export type AddArgs = {
  stock: StockItem[];
  draft: FoodDraft;
  // The Inventory product the person chose to add to; null = a new product by name.
  itemId: string | null;
  photos?: CapturedPhoto[];
  identification?: Identification;
  bestBefore?: string | null;
  // The person has seen the duplicate warning and wants it anyway.
  allowDuplicate?: boolean;
  // Kept until success, so a retry after a lost reply can't add twice.
  requestId?: string;
  newItemId?: string;
  now?: string;
  addedBy?: string;
  newId: () => string;
};

export async function addFood(client: SupabaseClient, store: FoodStore, args: AddArgs): Promise<AddResult> {
  const now = args.now ?? new Date().toISOString();
  const draft = args.draft;
  if (!draft.name.trim()) return { ok: false, error: "What is it? Give the food a name." };
  const item = args.itemId ? args.stock.find((i) => i.id === args.itemId) ?? null : null;
  if (args.itemId && !item) return { ok: false, error: "That Inventory item isn't there any more. Reload and try again." };

  const requestId = args.requestId ?? args.newId();
  // A retry of a save that already went through: hand back what was made.
  const done = store.get(requestId);
  const photos = args.photos ?? [];
  if (!done && !args.allowDuplicate) {
    const dup = planAdd(draft, args.stock, store.list(), photos.map((p) => p.fingerprint), now).duplicates;
    if (dup.length) return { ok: false, error: "This looks like something already saved.", duplicates: dup };
  }

  const r = await receiveFinished(client, {
    item, newName: draft.name, unit: draft.unit, quantity: draft.count, location: draft.location,
    bestBefore: args.bestBefore ?? null, madeOn: draft.madeOn ?? now.slice(0, 10), requestId, newItemId: args.newItemId, now,
  });
  if (!r.ok) return r;

  const id = r.action.requestId;
  const idn = args.identification ?? SAID_IT;
  const note: FoodNote = done ?? {
    id, itemId: r.action.itemId, itemName: r.action.itemName, description: draft.said, nameFrom: idn.nameFrom, suggestedName: idn.suggestedName, confidence: idn.confidence,
    quantityText: draft.quantityText, amountKnown: draft.amountKnown, approximate: draft.approximate, kinds: draft.kinds, notes: draft.notes,
    location: draft.location, madeOn: draft.madeOn, photos: photos.map((p) => p.ref), fingerprints: photos.map((p) => p.fingerprint),
    addedAt: now, addedBy: args.addedBy ?? "", origin: "kitchen", uses: [],
  };
  store.add(note);
  return { ok: true, action: r.action, note };
}
