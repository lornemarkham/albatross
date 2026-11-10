// Ounce display for ingredient text. Display only: the stored recipe text, the
// sausage cards' grams and every Pantry quantity stay exactly as they were
// written. "Ounces" shows weights (g, kg, lb) as oz and volumes (ml, l) as fl oz.

export type UnitSystem = "as-written" | "ounces";

const KEY = "elk-kitchen-units";
const G_PER_OZ = 28.349523125;
const ML_PER_FL_OZ = 29.5735295625;

type Storage1 = Pick<Storage, "getItem" | "setItem">;

export function readUnitSystem(storage: Storage1 | null = typeof localStorage === "undefined" ? null : localStorage): UnitSystem {
  try {
    return storage?.getItem(KEY) === "ounces" ? "ounces" : "as-written";
  } catch {
    return "as-written";
  }
}

export function saveUnitSystem(system: UnitSystem, storage: Storage1 | null = typeof localStorage === "undefined" ? null : localStorage): void {
  try {
    storage?.setItem(KEY, system);
  } catch { /* a full or blocked store only means the choice isn't remembered */ }
}

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`;
const MEASURE = new RegExp(String.raw`(?<![\w.])${NUM}\s*(kg|g|grams?|lbs?|pounds?|ml|l|litres?|liters?)(?![\w%])`, "gi");

function parseNumber(s: string): number {
  const t = s.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t.replace(",", "."));
}

function nice(v: number): string {
  if (v >= 10) return String(Math.round(v));
  if (v >= 1) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

// "72 g" → "2.5 oz"; "5 lb" → "80 oz"; "120 ml" → "4.1 fl oz". Text with no
// metric or pound measure is returned untouched.
export function toOunces(text: string): string {
  return text.replace(MEASURE, (whole, num: string, unit: string) => {
    const n = parseNumber(num);
    if (!Number.isFinite(n) || n <= 0) return whole;
    const u = unit.toLowerCase();
    if (u === "g" || u.startsWith("gram")) return `${nice(n / G_PER_OZ)} oz`;
    if (u === "kg") return `${nice((n * 1000) / G_PER_OZ)} oz`;
    if (u.startsWith("lb") || u.startsWith("pound")) return `${nice(n * 16)} oz`;
    if (u === "ml") return `${nice(n / ML_PER_FL_OZ)} fl oz`;
    return `${nice((n * 1000) / ML_PER_FL_OZ)} fl oz`;
  });
}

export const displayMeasures = (text: string, system: UnitSystem): string => (system === "ounces" ? toOunces(text) : text);
