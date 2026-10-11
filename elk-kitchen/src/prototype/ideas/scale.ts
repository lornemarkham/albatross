// Scaling a structured recipe — plain arithmetic, no AI needed.

import type { Ingredient } from "./types";

const FRACTIONS: [number, string][] = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];

export function formatQty(q: number): string {
  if (q >= 10) return String(Math.round(q));
  const whole = Math.floor(q);
  const rest = q - whole;
  if (rest < 0.07) return String(whole);
  if (rest > 0.93) return String(whole + 1);
  for (const [v, glyph] of FRACTIONS) {
    if (Math.abs(rest - v) < 0.07) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(q * 10) / 10);
}

export function scaleIngredient(ing: Ingredient, factor: number): Ingredient {
  return ing.qty === null ? ing : { ...ing, qty: ing.qty * factor };
}

export function ingredientLine(ing: Ingredient): string {
  if (ing.qty === null) return ing.unit ? `${ing.name}, ${ing.unit}` : ing.name;
  return [formatQty(ing.qty), ing.unit, ing.name].filter(Boolean).join(" ");
}
