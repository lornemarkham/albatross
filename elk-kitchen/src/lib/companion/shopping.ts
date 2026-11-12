// Shopping requests in plain words → a list the person reviews before
// anything is sent. ELK Pantry owns the shopping list (doctrine Q9):
// Kitchen reads its open items and adds only through pantry_shopping_add.
// "We're out of onions" never changes stock: Pantry's count is Pantry's.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PantryItem } from "../pantry";
import { mentions } from "../pantryCheck";

export type ShoppingRequest =
  | { kind: "add"; names: string[]; reason: "asked" | "out" }
  // "add everything missing from this recipe" — needs a recipe in view
  | { kind: "add-missing" };

const FILLER = /^(the|some|a|an|more|of|any|our|fresh|extra)\s+/;
function names(phrase: string): string[] {
  return phrase
    .replace(/\b(to|on|onto) (the|our|my) (shopping|grocery) list\b.*$/, "")
    .replace(/\b(please|thanks|thank you|again|too|as well|now|today|tonight)\b/g, " ")
    .split(/,|\band\b|&|\bplus\b/)
    .map((s) => {
      let t = s.trim().toLowerCase().replace(/[.!?]+$/, "");
      for (let i = 0; i < 3; i++) t = t.replace(FILLER, "");
      return t.trim();
    })
    .filter((s) => s.length > 1 && s.length <= 60 && !/^(it|them|that|this|everything|stuff)$/.test(s));
}

export function parseShopping(text: string): ShoppingRequest | null {
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  if (/\b(everything|all( the)?( things)?|what'?s|whatever'?s|the) (that'?s )?missing\b|\bmissing (ingredients|items|things)\b/.test(t)) return { kind: "add-missing" };
  const out = /\bwe('re| are|'ve| have)? ?(run |running )?(out of|low on|nearly out of|almost out of|run out of|used up( all)?( the)?)\s+(.+)$/.exec(t);
  if (out) { const n = names(out[6]); return n.length ? { kind: "add", names: n, reason: "out" } : null; }
  const add = /\b(?:add|put|get|buy|pick up|need)\s+(.+?)(?:\s+(?:to|on|onto)\s+(?:the|our|my)\s+(?:shopping|grocery)\s+list)?$/.exec(t);
  if (add && /\b(shopping|grocery)\b|\bbuy\b|\bpick up\b|\bwe need\b/.test(t)) {
    const n = names(add[1].replace(/^(more|some)\s+/, ""));
    return n.length ? { kind: "add", names: n, reason: "asked" } : null;
  }
  return null;
}

export type ShoppingLine = {
  name: string;
  selected: boolean;
  // Already on Pantry's open list (pantry_shopping_add would skip it anyway).
  onList: boolean;
  // What Pantry shows for it, said plainly, so a disagreement is visible.
  pantryNote: string;
};

export function reviewLines(wanted: string[], openList: string[], pantry: PantryItem[] | null): ShoppingLine[] {
  const seen = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const open = new Set(openList.map(norm));
  return wanted.filter((n) => { const k = norm(n); if (!k || seen.has(k)) return false; seen.add(k); return true; }).map((name) => {
    const onList = open.has(norm(name));
    const p = pantry?.find((x) => norm(x.name) === norm(name)) ?? pantry?.find((x) => mentions(x.name, name)) ?? null;
    const pantryNote = !pantry ? "" : !p ? "Pantry has no record of it" : p.onHand > 0 ? `Pantry still shows ${p.onHand} ${p.unit} of ${p.name} — update it in Pantry if that's wrong` : `Pantry shows none left of ${p.name}`;
    return { name, selected: !onList, onList, pantryNote };
  });
}

export type OpenList = { status: "ready"; names: string[] } | { status: "not-set-up" } | { status: "error"; error: string };

// The open (not yet bought) items on Pantry's list, read with the person's own token.
export async function loadOpenShopping(client: SupabaseClient): Promise<OpenList> {
  const { data, error } = await client.from("pantry_shopping_items").select("name").is("done_at", null).order("created_at").limit(500);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01" || /could not find the table/i.test(error.message)) return { status: "not-set-up" };
    return { status: "error", error: error.message };
  }
  return { status: "ready", names: (data as { name: string }[]).map((r) => r.name) };
}

// The family shopping list as the kitchen screen shows it: Pantry's own rows,
// read with the person's token, so every phone and the wall see the same list.
export type ShoppingItem = { id: string; name: string; note: string | null; source: "manual" | "low-stock" | "recipe"; createdAt: string };
export type ShoppingList = { status: "ready"; items: ShoppingItem[] } | { status: "not-set-up" } | { status: "error"; error: string };

export async function loadShoppingList(client: SupabaseClient): Promise<ShoppingList> {
  const { data, error } = await client.from("pantry_shopping_items").select("id,name,note,source,created_at").is("done_at", null).order("created_at").limit(500);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01" || /could not find the table/i.test(error.message)) return { status: "not-set-up" };
    return { status: "error", error: error.message };
  }
  return {
    status: "ready",
    items: (data as { id: string; name: string; note: string | null; source: ShoppingItem["source"]; created_at: string }[])
      .map((r) => ({ id: r.id, name: r.name, note: r.note, source: r.source, createdAt: r.created_at })),
  };
}

// "Got it" — the same plain update ELK Inventory's own list makes (its
// setShoppingDone), so a tick on the wall shows on every phone. Undo clears it.
// Stock doesn't change: putting groceries away is Pantry's job.
export async function setShoppingDone(client: SupabaseClient, id: string, done: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: u } = await client.auth.getUser();
  const { error } = await client.from("pantry_shopping_items")
    .update(done ? { done_at: new Date().toISOString(), done_by: u.user?.id ?? null } : { done_at: null, done_by: null })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const onListAlready = (name: string, openNames: string[]) => openNames.some((n) => normName(n) === normName(name));
