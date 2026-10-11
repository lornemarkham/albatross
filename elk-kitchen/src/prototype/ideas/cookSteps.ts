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
