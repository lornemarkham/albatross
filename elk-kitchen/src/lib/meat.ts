import type { MeatDetails, RecipeKind } from "../types/recipe";

export const blankDetails = (): MeatDetails => ({
  meatType: "", meatWeightG: null, fatPercent: null, seasoning: "", marinade: "", grinderPlate: "", casing: "",
  smokeTempC: null, cookTempC: null, internalTempC: null, finishedWeightG: null,
});

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v : "");

// Tolerant of missing/old data: anything absent becomes blank.
export function normalizeDetails(raw: unknown): MeatDetails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    meatType: text(r.meatType), meatWeightG: num(r.meatWeightG), fatPercent: num(r.fatPercent),
    seasoning: text(r.seasoning), marinade: text(r.marinade), grinderPlate: text(r.grinderPlate), casing: text(r.casing),
    smokeTempC: num(r.smokeTempC), cookTempC: num(r.cookTempC), internalTempC: num(r.internalTempC),
    finishedWeightG: num(r.finishedWeightG),
  };
}

export const KINDS: { value: RecipeKind; label: string }[] = [
  { value: "general", label: "Everyday recipe" },
  { value: "jerky", label: "Jerky" },
  { value: "sausage", label: "Sausage" },
];

export const CATEGORIES = ["Jerky", "Sausage", "Mains", "Sides", "Soups & stews", "Salads", "Baking", "Breakfast", "Snacks", "Sauces & rubs", "Drinks", "Other"];

// Yield as a percentage of the starting meat weight (jerky typically lands
// around 30–45%). null until both weights are known.
export function yieldPercent(d: Pick<MeatDetails, "meatWeightG" | "finishedWeightG">): number | null {
  if (!d.meatWeightG || d.meatWeightG <= 0 || d.finishedWeightG == null || d.finishedWeightG < 0) return null;
  return Math.round((d.finishedWeightG / d.meatWeightG) * 1000) / 10;
}

export type SeasoningLine = { name: string; percent: number | null; grams: number | null; raw: string };

// "Salt 2%" / "Black pepper 0.5 %" / "Garlic powder: 1.2%" → grams for a meat weight.
export function seasoningLines(seasoning: string, meatWeightG: number | null): SeasoningLine[] {
  return seasoning.split("\n").map((l) => l.trim()).filter(Boolean).map((raw) => {
    const m = raw.match(/^(.*?)[\s:=-]*(\d+(?:[.,]\d+)?)\s*%\s*$/);
    if (!m || !m[1].trim()) return { name: raw, percent: null, grams: null, raw };
    const percent = Number(m[2].replace(",", "."));
    const grams = meatWeightG && meatWeightG > 0 ? Math.round((meatWeightG * percent) * 10 / 100) / 10 : null;
    return { name: m[1].trim(), percent, grams, raw };
  });
}

// ── Food safety ──────────────────────────────────────────────────────────────
// Source: USDA Food Safety and Inspection Service (FSIS) — "Jerky and Food
// Safety", "Sausages and Food Safety", "Safe Minimum Internal Temperature
// Chart", "Smoking Meat". Ground beef/pork/lamb 160 °F (71 °C); poultry
// 165 °F (74 °C). Jerky: heat meat to 160 °F (165 °F poultry) as part of
// making it, then dry at ≥ 130–140 °F (54–60 °C). Smokers: hold ≥ 225 °F
// (107 °C) unless using a cure and a tested recipe. Fridge ≤ 40 °F (4 °C).
// These are guidance prompts, not a guarantee: the owner should confirm the
// figures against FSIS before relying on them.
export const SAFETY_SOURCE = "USDA FSIS: Jerky and Food Safety; Sausages and Food Safety; Safe Minimum Internal Temperature Chart";

export type SafetyNote = { level: "warn" | "info"; text: string };

const isPoultry = (meatType: string) => /chicken|turkey|poultry|duck|goose/i.test(meatType);
export const requiredInternalC = (meatType: string) => (isPoultry(meatType) ? 74 : 71);

export function safetyGuidance(kind: RecipeKind): SafetyNote[] {
  if (kind === "jerky") {
    return [
      { level: "info", text: "Beef jerky: the meat must reach 71 °C (160 °F) — 74 °C (165 °F) for poultry — at some point during making it. Drying alone at low heat is not enough." },
      { level: "info", text: "Marinate in the fridge (4 °C / 40 °F or colder), never on the counter. Throw away used marinade; don't baste with it." },
      { level: "info", text: "Dry at 54–60 °C (130–140 °F) or hotter, with steady airflow. Finished jerky should bend and crack but not snap." },
      { level: "info", text: "Cool, then store airtight: pantry 1–2 months, fridge or freezer for longer. Wash hands, boards and knives between raw and finished meat." },
    ];
  }
  if (kind === "sausage") {
    return [
      { level: "info", text: "Fresh ground sausage (beef, pork, lamb, veal): cook to 71 °C (160 °F). Poultry sausage: 74 °C (165 °F). Check with a probe thermometer in the thickest part." },
      { level: "info", text: "Keep meat, grinder parts and fat at 4 °C (40 °F) or colder while working. Use ground meat or fresh sausage within 1–2 days, or freeze." },
      { level: "info", text: "Smoked, dried or cooked-then-stored sausage needs a tested recipe and the right curing salt (nitrite) for the quantity. Do not guess the cure amount." },
      { level: "info", text: "Smoker: hold 107 °C (225 °F) or hotter unless following a tested cured recipe. Don't leave raw or cooked meat between 4 and 60 °C (40–140 °F) for over 2 hours." },
    ];
  }
  return [];
}

// Warnings for what was actually recorded. Silent when nothing relevant was entered.
export function safetyChecks(kind: RecipeKind, d: MeatDetails): SafetyNote[] {
  if (kind === "general") return [];
  const out: SafetyNote[] = [];
  const need = requiredInternalC(d.meatType);
  const needF = Math.round(need * 9 / 5 + 32);
  if (d.internalTempC != null && d.internalTempC < need) {
    out.push({ level: "warn", text: `Internal temperature ${d.internalTempC} °C is below the ${need} °C (${needF} °F) USDA minimum${isPoultry(d.meatType) ? " for poultry" : " for ground beef, pork and lamb"}. Don't treat this batch as safe.` });
  } else if (d.internalTempC == null && (d.finishedWeightG != null || d.cookTempC != null || d.smokeTempC != null)) {
    out.push({ level: "warn", text: `No internal temperature recorded. Safe minimum is ${need} °C (${needF} °F) — record the probe reading.` });
  }
  if (kind === "jerky" && d.cookTempC != null && d.cookTempC < 54) {
    out.push({ level: "warn", text: `Drying at ${d.cookTempC} °C is below 54 °C (130 °F), which USDA says is too cool to dry jerky safely.` });
  }
  if (kind === "sausage" && d.smokeTempC != null && d.smokeTempC < 107) {
    out.push({ level: "info", text: `Smoking at ${d.smokeTempC} °C is below 107 °C (225 °F). That's only safe with a cured, tested recipe — and the internal temperature still has to reach ${need} °C.` });
  }
  if (d.fatPercent != null && (d.fatPercent < 0 || d.fatPercent > 100)) {
    out.push({ level: "warn", text: "Fat percentage should be between 0 and 100." });
  }
  return out;
}
