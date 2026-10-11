// "Use what we have": quick taps instead of typing out the fridge. Each chip
// confirms only the sample ingredients that word clearly covers, and the
// pantry check quotes the person's own word back ("You said you have
// peppers") — never a more specific claim. Session only; nothing is saved.

import { normName } from "./pantryMatch";
import type { Answers } from "./types";

export type HaveChip = { label: string; group: "Protein" | "Vegetables & fresh" | "Cupboard"; confirms: string[] };

export const HAVE_CHIPS: HaveChip[] = [
  { label: "chicken", group: "Protein", confirms: ["chicken thighs", "chicken breasts"] },
  { label: "ground turkey", group: "Protein", confirms: ["ground turkey"] },
  { label: "black beans", group: "Protein", confirms: ["black beans"] },
  { label: "chickpeas", group: "Protein", confirms: ["chickpeas"] },
  { label: "lentils", group: "Protein", confirms: ["red lentils"] },
  { label: "cheddar", group: "Protein", confirms: ["cheddar cheese"] },
  { label: "feta", group: "Protein", confirms: ["feta cheese"] },
  { label: "peppers", group: "Vegetables & fresh", confirms: ["bell peppers", "bell pepper"] },
  { label: "onions", group: "Vegetables & fresh", confirms: ["onion", "onions"] },
  { label: "carrots", group: "Vegetables & fresh", confirms: ["carrots"] },
  { label: "potatoes", group: "Vegetables & fresh", confirms: ["potatoes (yukon gold)"] },
  { label: "spinach", group: "Vegetables & fresh", confirms: ["spinach"] },
  { label: "tomatoes", group: "Vegetables & fresh", confirms: ["tomatoes"] },
  { label: "zucchini", group: "Vegetables & fresh", confirms: ["zucchini"] },
  { label: "corn on the cob", group: "Vegetables & fresh", confirms: ["corn on the cob"] },
  { label: "cucumber", group: "Vegetables & fresh", confirms: ["cucumber"] },
  { label: "garlic", group: "Vegetables & fresh", confirms: ["garlic"] },
  { label: "lemons", group: "Vegetables & fresh", confirms: ["lemons"] },
  { label: "rice", group: "Cupboard", confirms: ["rice"] },
  { label: "pasta", group: "Cupboard", confirms: ["small pasta"] },
  { label: "tortillas", group: "Cupboard", confirms: ["flour tortillas"] },
  { label: "canned tomatoes", group: "Cupboard", confirms: ["diced tomatoes"] },
  { label: "stock", group: "Cupboard", confirms: ["chicken stock"] },
  { label: "salsa", group: "Cupboard", confirms: ["salsa"] },
  { label: "oats", group: "Cupboard", confirms: ["rolled oats"] },
  { label: "peanut butter", group: "Cupboard", confirms: ["peanut butter"] },
];

export const CHIP_GROUPS = ["Protein", "Vegetables & fresh", "Cupboard"] as const;

// Is this chip currently "on"? True when every ingredient it confirms has
// been confirmed with this chip's word.
export function chipOn(chip: HaveChip, answers: Answers): boolean {
  return chip.confirms.every((c) => {
    const a = answers[normName(c)];
    return typeof a === "object" && a.said === chip.label;
  });
}

export function toggleChip(chip: HaveChip, answers: Answers): Answers {
  const next = { ...answers };
  const on = chipOn(chip, answers);
  for (const c of chip.confirms) {
    if (on) delete next[normName(c)];
    else next[normName(c)] = { said: chip.label };
  }
  return next;
}

// The words the person has told Kitchen they have (taps or typed), for
// matching against free-text family recipes.
export function saidWords(answers: Answers): string[] {
  return [...new Set(Object.values(answers).flatMap((a) => (typeof a === "object" ? [a.said] : [])))];
}
