// Turning a method into big, one-at-a-time steps for cooking along.

// A family recipe's method is free text. Split on lines, dropping "1." /
// "Step 2:" style numbering; one long paragraph stays one step.
export function stepsFromText(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^(step\s*)?\d+\s*[.):-]\s*/i, "").trim())
    .filter(Boolean);
}

// "Simmer 25 minutes" → 25. For a range ("6–7 minutes") use the low end so
// the timer goes off before it's overdone. Only minutes and hours.
export function timerIn(step: string): number | null {
  const m = step.match(/(\d+(?:½)?)(?:\s*[–-]\s*\d+)?\s*(minutes?|mins?|hours?)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace("½", ".5"));
  return /hour/i.test(m[2]) ? n * 60 : n;
}

// Which ingredients a step mentions, so cook-along can show "for this step"
// with quantities. A word only counts if no other ingredient in the recipe
// shares it ("beans" in a chili with two kinds of beans matches neither) —
// better to show nothing than the wrong amount.
const STOP = new Set(["fresh", "small", "red", "or", "and", "bone-in", "pinch", "of"]);

function words(name: string): string[] {
  return name.toLowerCase().replace(/\(.*?\)/g, " ").split(/[\s,&]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function stem(w: string): string {
  return w.replace(/oes$/, "o").replace(/s$/, "");
}

export function ingredientsForStep<T extends { name: string }>(step: string, ingredients: T[]): T[] {
  const text = step.toLowerCase();
  const all = ingredients.map((i) => words(i.name).map(stem));
  return ingredients.filter((ing, n) => {
    if (text.includes(ing.name.toLowerCase())) return true;
    return all[n].some((w) =>
      new RegExp(`\\b${w.replace(/[^a-z-]/g, "")}(s|es)?\\b`).test(text)
      && !all.some((other, m) => m !== n && other.includes(w)));
  });
}
