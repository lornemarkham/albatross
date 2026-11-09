// Plain-language food commands, in rules (not AI):
//   "Add these two pork bones to my freezer."        add
//   "I made three containers of chicken stock."      add (homemade)
//   "What's in my freezer?"                          list (read only)
//   "Show me what needs using."                      needs-using (read only)
//   "I used the last of the stew meat."              used (all)
//   "Move one container of stock to the fridge."     move
//
// parseCommand only reads the sentence. resolveCommand matches it to what
// Inventory actually has and says what would happen. Anything that changes
// stock is a *plan* that needs a tap to confirm; a name that matches several
// products, or a count nobody said, becomes a question instead of a guess.

import { wordsOf } from "../pantryCheck";
import { useSoon, daysBetween, whenLabel } from "../companion/pantryView";
import { zoneOf, type Zone } from "../chef/knowledge";
import type { StockItem, StockLot } from "../pantryStock";
import { parseFoodDescription, type FoodDraft } from "./describe";
import type { FoodNote } from "./notes";

export type Command =
  | { kind: "add"; drafts: FoodDraft[] }
  | { kind: "list"; where: string; zone: Zone | null }
  | { kind: "needs-using" }
  | { kind: "used"; name: string; count: number | "all" | null }
  | { kind: "move"; name: string; count: number | "all" | null; to: string }
  | { kind: "unknown" };

const NUMS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const CONT = "(?:bags?|containers?|batch(?:es)?|jars?|cans?|tins?|packs?|packages?|trays?|bowls?|bunch(?:es)?|loaf|loaves|bottles?|tubs?|boxes|box|cartons?|portions?|servings?|bones?|links?|chops?|steaks?|pounds?|lbs?)";
const LOC = "((?:(?:chest|deep|garage|basement|upright|kitchen|spare)\\s+)?(?:freezer|fridge|refrigerator|pantry|cupboard|cellar|cooler))";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");

function countOf(s: string): number | "all" | null {
  const m = new RegExp(`\\b(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:${CONT}\\b|of\\b)`).exec(s);
  if (!m) return /\b(?:all|everything|the last|last of|rest of|remaining)\b/.test(s) ? "all" : null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMS[m[1]];
}

// "the last of the stew meat" → "stew meat"; "two containers of stock" → "stock"
function foodName(s: string): string {
  return s
    .replace(/^(?:all of|all the|all|the last of|last of|the rest of|rest of|the remaining|everything|the)\s+/g, "")
    .replace(new RegExp(`^(?:\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\\s+${CONT}\\s+(?:of\\s+)?`), "")
    .replace(/^(?:the|my|our|of|some)\s+/g, "")
    .replace(/\s+(?:from|out of|in)\s+(?:the |my |our )?(?:freezer|fridge|pantry).*$/, "")
    .trim();
}

export function parseCommand(text: string, today: string): Command {
  const t = clean(text);
  if (!t) return { kind: "unknown" };

  if (/\bwhat(?:'s| is| do i| do we| have i| have we)?\b.*\b(?:need|needs|needing)\b.*\b(?:using|eating|used)\b|\bneeds? (?:using|to be used|eating)\b|\bwhat should (?:i|we) use (?:up|first)\b|\bwhat(?:'s| is) (?:expiring|going off|about to go off)\b|\buse (?:it )?up\b.*\bwhat\b/.test(t)) return { kind: "needs-using" };

  const where = new RegExp(`\\bwhat(?:'s| is| do (?:i|we) have| have (?:i|we) got)?\\b.*\\b(?:in|inside|on)\\s+(?:the |my |our )?${LOC}`).exec(t)
    ?? new RegExp(`\\b(?:show|list|tell) (?:me )?(?:what(?:'s| is)? |everything )?(?:in|inside)\\s+(?:the |my |our )?${LOC}`).exec(t);
  if (where) return { kind: "list", where: cap(where[1]), zone: zoneOf(where[1]) };
  if (/\bwhat(?:'s| is| do (?:i|we) have| have (?:i|we) got)\b.*\b(?:in stock|do i have|do we have|have i got|we have)\b|\bwhat(?:'s| is) in (?:the |my |our )?(?:inventory|pantry list|kitchen)\b|\bwhat do (?:i|we) have\b/.test(t)) return { kind: "list", where: "", zone: null };

  // move: "move one container of stock to the fridge"
  const mv = new RegExp(`^(?:please )?(?:move|shift)\\s+(.+?)\\s+(?:in|into|to|over to)\\s+(?:the |my |our )?${LOC}$`).exec(t);
  if (mv) {
    return { kind: "move", name: foodName(mv[1]), count: countOf(mv[1]), to: cap(mv[2]) };
  }

  // used: "i used the last of the stew meat", "we're out of stock", "finished the chili", "used 2 bones"
  const used = /\b(?:i|we)(?:'ve| have)?\s+(?:just\s+)?(?:used|used up|finished|finished off|ate|eaten|cooked with|threw out|threw away|thrown out|binned)\s+(.+)$/.exec(t)
    ?? /^(?:used|use)\s+(.+)$/.exec(t)
    ?? /\b(?:(?:i|we)(?:'re| are)|(?:i|we) have|there(?:'s| is)) (?:all )?(?:out of|no more|none left of|nothing left of)\s+(.+)$/.exec(t)
    ?? /\bwe(?:'re| are) out of\s+(.+)$/.exec(t)
    ?? /\bno (?:more|\w+ left)\s+(.+)$/.exec(t);
  if (used) {
    const rest = used[1];
    const outOf = /out of|no more|none left|nothing left/.test(used[0]);
    const n = outOf ? "all" : countOf(rest);
    const name = foodName(rest);
    if (name) return { kind: "used", name, count: n };
  }

  // add: needs a food that parses, and an adding word or a "made"/"have".
  if (/^(?:please )?(?:can you |could you )?(?:add|put|save|store|log|record|note)\b|\b(?:i|we)(?:'ve| have)?\s+(?:just\s+)?(?:made|cooked|baked|bought|found|picked|got|have|froze)\b|\bthere(?:'s| is| are)\b.*\b(?:in|left)\b/.test(t)) {
    const drafts = parseFoodDescription(text, today);
    if (drafts.length) return { kind: "add", drafts };
  }
  return { kind: "unknown" };
}

// ── Matching what was said to what Inventory has ──────────────────────────

export type ChangePlan =
  // Everything needed is known; confirm and it happens.
  | { status: "ready"; item: StockItem; lot: StockLot | null; quantity: number; summary: string; lines: string[] }
  // Cannot go ahead without an answer from the person.
  | { status: "ask"; question: string; options: StockItem[]; needsCount: boolean }
  | { status: "none"; reply: string };

export type CommandPlan =
  | { kind: "add"; drafts: FoodDraft[] }
  | { kind: "answer"; title: string; lines: string[] }
  | { kind: "used"; plan: ChangePlan; wanted: number | "all" | null }
  | { kind: "move"; plan: ChangePlan; to: string }
  | { kind: "unknown"; reply: string };

const stemSet = (s: string) => new Set(wordsOf(s));

// Products whose names contain every word that was said; the one whose name is exactly that wins.
export function matchProducts(name: string, stock: StockItem[], onlyInStock = true): StockItem[] {
  const want = [...stemSet(name)];
  if (!want.length) return [];
  const hits = stock.filter((i) => (!onlyInStock || i.onHand > 0) && want.every((w) => stemSet(i.name).has(w)));
  const exact = hits.filter((i) => stemSet(i.name).size === want.length);
  return exact.length === 1 ? exact : hits;
}

const label = (i: StockItem) => `${i.name} (${i.onHand} ${i.unit}${i.lots[0]?.location ? ` · ${i.lots.map((l) => l.location || "no place").filter((v, n, a) => a.indexOf(v) === n).join(", ")}` : ""})`;

export function resolveCommand(cmd: Command, stock: StockItem[], notes: FoodNote[], today: string): CommandPlan {
  switch (cmd.kind) {
    case "add": return { kind: "add", drafts: cmd.drafts };
    case "list": {
      const have = stock.filter((i) => i.onHand > 0);
      const rows = cmd.zone
        ? have.flatMap((i) => i.lots.filter((l) => zoneOf(l.location) === cmd.zone && (!/chest|deep|garage|basement|upright|kitchen|spare/i.test(cmd.where) || l.location.toLowerCase().includes(cmd.where.toLowerCase().split(" ")[0]))).map((l) => ({ i, l })))
        : have.flatMap((i) => i.lots.map((l) => ({ i, l })));
      const title = cmd.zone ? `In the ${cmd.where.toLowerCase()}` : "Everything Inventory shows";
      if (!rows.length) return { kind: "answer", title, lines: [cmd.zone ? `Inventory shows nothing in the ${cmd.where.toLowerCase()}. That only means nobody has entered anything there — it may still hold things.` : "Inventory shows no food in stock."] };
      return { kind: "answer", title, lines: rows.map(({ i, l }) => `${i.name} — ${l.remaining} ${i.unit}${l.location ? ` · ${l.location}` : ""}${l.bestBefore ? ` · ${whenLabel(daysBetween(today, l.bestBefore))}` : ""}`).sort() };
    }
    case "needs-using": {
      const pantry = stock.filter((i) => i.onHand > 0).map((i) => ({ name: i.name, onHand: i.onHand, unit: i.unit, bestBefore: i.lots.map((l) => l.bestBefore).filter((d): d is string => !!d).sort()[0] ?? null, location: i.lots[0]?.location ?? "", places: [], lowStockAt: null, itemId: i.id, opened: null, lastReceivedOn: null }));
      const soon = useSoon(pantry, today, 7);
      const noteKinds = (id: string) => notes.filter((n) => n.itemId === id).flatMap((n) => n.kinds);
      const lines = soon.map((s) => `${s.item.name} — ${s.item.onHand} ${s.item.unit} · ${whenLabel(s.daysLeft)}`);
      const other = stock.filter((i) => i.onHand > 0 && !soon.some((s) => s.item.itemId === i.id) && (/\bleft ?-?overs?\b/i.test(i.name) || noteKinds(i.id).some((k) => k === "leftover" || k === "opened")))
        .map((i) => `${i.name} — ${i.onHand} ${i.unit} · ${noteKinds(i.id).includes("opened") ? "opened" : "leftover"}`);
      const all = [...lines, ...other];
      return { kind: "answer", title: "Needs using", lines: all.length ? all : ["Nothing in Inventory has a best-before date coming up or is marked opened or leftover. Foods without dates aren't covered."] };
    }
    case "used": return { kind: "used", wanted: cmd.count, plan: changePlan(cmd.name, cmd.count, stock, "take out") };
    case "move": return { kind: "move", to: cmd.to, plan: changePlan(cmd.name, cmd.count, stock, `move to ${cmd.to}`) };
    default: return { kind: "unknown", reply: "I can add food, list what's in a place, show what needs using, note that something was used, or move it. Try: “Add two pork bones to the freezer.”" };
  }
}

function changePlan(name: string, count: number | "all" | null, stock: StockItem[], verb: string): ChangePlan {
  const hits = matchProducts(name, stock);
  if (!hits.length) {
    const gone = matchProducts(name, stock, false);
    return { status: "none", reply: gone.length ? `Inventory shows none of ${gone[0].name} left, so there's nothing to ${verb}.` : `Inventory has nothing called “${name}”. Nothing was changed.` };
  }
  if (hits.length > 1) return { status: "ask", question: `Which one did you mean by “${name}”?`, options: hits, needsCount: false };
  const item = hits[0];
  if (count === null) return { status: "ask", question: `How many ${item.unit} of ${item.name} (Inventory has ${item.onHand})?`, options: [item], needsCount: true };
  const quantity = count === "all" ? item.onHand : count;
  if (quantity > item.onHand) return { status: "none", reply: `Inventory only has ${item.onHand} ${item.unit} of ${item.name}, not ${quantity}. Nothing was changed.` };
  const lots = item.lots;
  const lot = verb.startsWith("move") ? (lots.find((l) => l.remaining >= quantity) ?? null) : null;
  if (verb.startsWith("move") && !lot) return { status: "none", reply: `No single batch of ${item.name} has ${quantity} ${item.unit} to move together (they're split across batches). Move fewer at a time.` };
  const spans = !lot && lots.length > 1;
  return {
    status: "ready", item, lot, quantity,
    summary: `${verb === "take out" ? "Take out" : `Move`} ${quantity === item.onHand && count === "all" ? "all " : ""}${quantity} ${item.unit} of ${item.name}${lot ? ` from ${lot.location || "no place"}` : ""}${verb.startsWith("move") ? ` to ${verb.slice(8)}` : ""}`,
    lines: [`Inventory has ${item.onHand} ${item.unit} now; it will have ${item.onHand - (verb === "take out" ? quantity : 0)}.`, spans ? `Comes from ${lots.length} batches, oldest first.` : "", "You can undo this afterwards."].filter(Boolean),
  };
}

export { label as productLabel };
