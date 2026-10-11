// A family recipe's free-text ingredient lines against ELK Pantry, honestly.
//
//   have     Pantry has a product whose whole name is in the line, with some left
//   missing  same match, but Pantry shows none left
//   unknown  Pantry has no record of it — not proof it's missing. When a pantry
//            product merely resembles the line ("Tomato paste" for "tomatoes")
//            it's offered as a hint, never counted as "have".
//   basic    salt, pepper, water… listed, never claimed or asked about
//
// Pantry counts packages, not amounts, so "have" never means "have enough".

import type { PantryItem } from "./pantry";

export type LineStatus =
  | { state: "have"; item: PantryItem }
  | { state: "missing"; item: PantryItem }
  | { state: "unknown"; maybe: PantryItem | null }
  | { state: "basic" };

export type LineCheck = { line: string; name: string; status: LineStatus };

export type RecipePantryCheck = {
  lines: LineCheck[];
  have: number;
  missing: number;
  unknown: number;
  // Non-basic ingredient lines.
  total: number;
  headline: string;
  // "You have chicken and rice. Do you have broccoli?"
  prompt: string;
};

const UNITS = new Set([
  "cup", "cups", "c", "tbsp", "tbs", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons", "g", "gram", "grams", "kg",
  "ml", "l", "litre", "litres", "liter", "liters", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "pinch", "dash",
  "can", "cans", "tin", "tins", "jar", "jars", "pkg", "package", "packages", "packet", "packets", "bunch", "clove", "cloves",
  "slice", "slices", "stick", "sticks", "handful", "head", "heads", "sprig", "sprigs", "of", "a", "an", "large", "small", "medium", "about", "x",
]);
const BASICS = new Set(["salt", "pepper", "black pepper", "salt and pepper", "salt & pepper", "water", "ice", "cooking spray"]);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9À-ɏ\s-]/g, " ").split(/[\s-]+/).filter(Boolean).map(singular);
function singular(w: string): string {
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// "2 1/2 cups plain flour, sifted" → "plain flour"
export function ingredientName(line: string): string {
  const head = line.replace(/\(.*?\)/g, " ").split(/[,;]| - | – /)[0];
  const tokens = head.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && (/^[\d¼½¾⅓⅔⅛.,/–-]+[a-z]{0,2}$/i.test(tokens[i]) || UNITS.has(tokens[i].toLowerCase().replace(/\.$/, "")))) i++;
  return tokens.slice(i).join(" ").trim() || head.trim();
}

const contains = (big: string[], small: string[]) => small.length > 0 && small.every((w) => big.includes(w));

export function checkLine(line: string, pantry: PantryItem[]): LineCheck {
  const name = ingredientName(line);
  if (BASICS.has(name.toLowerCase())) return { line, name, status: { state: "basic" } };
  const lineWords = words(line);
  // Whole pantry name in the line; the longest (most specific) wins, and one with stock beats one without.
  const hits = pantry.filter((p) => contains(lineWords, words(p.name)))
    .sort((a, b) => words(b.name).length - words(a.name).length || Number(b.onHand > 0) - Number(a.onHand > 0));
  const hit = hits[0];
  if (hit) return { line, name, status: hit.onHand > 0 ? { state: "have", item: hit } : { state: "missing", item: hit } };
  const nameWords = words(name);
  const maybe = pantry.find((p) => p.onHand > 0 && contains(words(p.name), nameWords)) ?? null;
  return { line, name, status: { state: "unknown", maybe } };
}

const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export function checkRecipe(ingredients: string, pantry: PantryItem[]): RecipePantryCheck {
  const lines = ingredients.split("\n").map((l) => l.replace(/^[-•*·]\s*/, "").trim())
    // Skip blank lines and section headings ("Dressing:").
    .filter((l) => l && !/:$/.test(l))
    .map((l) => checkLine(l, pantry));
  const count = (s: LineStatus["state"]) => lines.filter((l) => l.status.state === s).length;
  const have = count("have"), missing = count("missing"), unknown = count("unknown");
  const total = have + missing + unknown;

  let headline: string;
  if (total === 0) headline = "No ingredients to check";
  else if (have === total) headline = `Pantry shows all ${total} ingredients (it counts packages, not amounts)`;
  else if (have === 0 && missing === 0) headline = "Pantry has no record of these ingredients";
  else headline = `Pantry confirms ${have} of ${total} ingredients`
    + (missing ? ` · ${missing} it shows none left of` : "")
    + (unknown ? ` · ${unknown} it doesn't know about` : "");

  const name = (l: LineCheck) => l.name.toLowerCase();
  const haveNames = lines.filter((l) => l.status.state === "have").map(name).slice(0, 3);
  const askNames = lines.filter((l) => l.status.state === "unknown").map(name).slice(0, 3);
  const prompt = [
    haveNames.length ? `You have ${list(haveNames)}${have > haveNames.length ? " and more" : ""}.` : "",
    askNames.length ? `Do you have ${list(askNames)}${unknown > askNames.length ? "…" : ""}?` : "",
  ].filter(Boolean).join(" ");

  return { lines, have, missing, unknown, total, headline, prompt };
}
