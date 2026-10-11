// Pantry awareness, honestly. Pantry won't know about most fridge items, and
// it matches products by name only, so every ingredient ends up in one of:
//
//   have      Pantry shows some (or the person said so) — with the evidence
//   out       Pantry tracks it and shows none left, or the person said no
//   ask       Pantry has no record — Kitchen asks instead of guessing
//   basic     salt/oil/pepper — listed, never claimed
//
// "You have everything" is only said when every non-basic ingredient is
// "have". Nothing here ever changes stock (doctrine §7).

import type { Answers, Ingredient, PantryItem, Provenance } from "./types";

export type IngredientStatus =
  | { state: "have"; source: Extract<Provenance, "pantry" | "you-said">; evidence: string; useSoon: string | null }
  | { state: "out"; evidence: string }
  | { state: "ask"; question: string }
  | { state: "basic" };

export type PantryFit = {
  statuses: { ingredient: Ingredient; status: IngredientStatus }[];
  have: number;
  out: number;
  ask: number;
  // Non-basic ingredients — the ones that count.
  total: number;
  useSoon: { name: string; bestBefore: string }[];
  headline: string;
};

const USE_SOON_DAYS = 5;

export function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// Same rule as Pantry's findProductByName: case/space-insensitive equality.
export function findInPantry(pantry: PantryItem[], ing: Ingredient): PantryItem | null {
  const names = (ing.pantryNames ?? [ing.name]).map(normName);
  return pantry.find((p) => names.includes(normName(p.name))) ?? null;
}

export function answerKey(ing: Ingredient): string {
  return normName(ing.name);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const d = (iso: string) => { const [y, m, dd] = iso.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((d(toIso) - d(fromIso)) / 86_400_000);
}

export function countLabel(n: number, unit: string): string {
  const singular: Record<string, string> = { cans: "can", jars: "jar", bags: "bag", boxes: "box", bottles: "bottle", packs: "pack", cartons: "carton", items: "item" };
  return n === 1 && singular[unit] ? `1 ${singular[unit]}` : `${n} ${unit}`;
}

export function ingredientStatus(ing: Ingredient, pantry: PantryItem[], answers: Answers, today: string): IngredientStatus {
  if (ing.kind === "basic") return { state: "basic" };
  const said = answers[answerKey(ing)];
  if (said === "yes") return { state: "have", source: "you-said", evidence: "You said you have this", useSoon: null };
  if (typeof said === "object") return { state: "have", source: "you-said", evidence: `You said you have ${said.said}`, useSoon: null };
  if (said === "no") return { state: "out", evidence: "You said you don't have this" };

  const item = findInPantry(pantry, ing);
  if (item && item.onHand > 0) {
    const soon = item.bestBefore !== null && daysBetween(today, item.bestBefore) <= USE_SOON_DAYS ? item.bestBefore : null;
    return {
      state: "have",
      source: "pantry",
      evidence: `Pantry: ${countLabel(item.onHand, item.unit)}${item.location ? ` · ${item.location}` : ""}`,
      useSoon: soon,
    };
  }
  if (item) return { state: "out", evidence: "Pantry shows none left" };
  return { state: "ask", question: `Do you have ${ing.name}?` };
}

export function pantryFit(ingredients: Ingredient[], pantry: PantryItem[], answers: Answers, today: string): PantryFit {
  const statuses = ingredients.map((ingredient) => ({ ingredient, status: ingredientStatus(ingredient, pantry, answers, today) }));
  const count = (s: IngredientStatus["state"]) => statuses.filter((x) => x.status.state === s).length;
  const have = count("have"), out = count("out"), ask = count("ask");
  const total = have + out + ask;
  const useSoon = statuses.flatMap(({ ingredient, status }) =>
    status.state === "have" && status.useSoon ? [{ name: ingredient.name, bestBefore: status.useSoon }] : []);
  return { statuses, have, out, ask, total, useSoon, headline: headline(have, out, ask, total) };
}

function headline(have: number, out: number, ask: number, total: number): string {
  if (total > 0 && have === total) return "You have everything for this";
  if (out > 0) return `Missing ${out} thing${out === 1 ? "" : "s"}${ask ? ` · ${ask} to check` : ""}`;
  if (have === 0) return ask === 1 ? "1 thing to check" : `${ask} things to check`;
  return `You have ${have} of ${total} · ${ask} to check`;
}

// Real family recipes have free-text ingredients, so the best Kitchen can do
// is spot a Pantry product name inside a line — a possible match, never a
// confirmed one.
export function possibleMatches(freeText: string, pantry: PantryItem[]): { line: string; item: PantryItem }[] {
  const lines = freeText.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: { line: string; item: PantryItem }[] = [];
  for (const line of lines) {
    const l = normName(line);
    const item = pantry.find((p) => p.onHand > 0 && l.includes(normName(p.name)));
    if (item) out.push({ line, item });
  }
  return out;
}
