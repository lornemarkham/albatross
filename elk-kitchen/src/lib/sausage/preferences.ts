// Cooking preferences and sausage-day plans, kept on this device under their
// own keys (never the recipe keys). Preferences start blank: Kitchen only
// uses what the cook set, and they can change it any time.
import type { Preferences, SausagePlan } from "../../types/sausage";

export const PREFS_KEY = "elk-kitchen-preferences-v1";
export const PLANS_KEY = "elk-kitchen-sausage-plans-v1";
type KV = Pick<Storage, "getItem" | "setItem">;

export const blankPrefs = (): Preferences => ({ grind: "", plate: "", seasoningsInGrams: false, goals: "" });

export function loadPrefs(storage: KV): Preferences {
  try {
    const v = JSON.parse(storage.getItem(PREFS_KEY) ?? "null") as Partial<Preferences> | null;
    if (!v || typeof v !== "object") return blankPrefs();
    return {
      grind: v.grind === "coarse" || v.grind === "medium" || v.grind === "fine" ? v.grind : "",
      plate: typeof v.plate === "string" ? v.plate.slice(0, 80) : "",
      seasoningsInGrams: v.seasoningsInGrams === true,
      goals: typeof v.goals === "string" ? v.goals.slice(0, 500) : "",
    };
  } catch {
    return blankPrefs();
  }
}

export function savePrefs(storage: KV, p: Preferences): void {
  storage.setItem(PREFS_KEY, JSON.stringify(p));
}

// "Coarse grind through the large plate" — or "" when nothing is set.
export function grindPhrase(p: Preferences): string {
  const g = p.grind ? `${p.grind} grind` : "";
  const plate = p.plate.trim();
  if (g && plate) return `${g} through the ${plate.replace(/^the\s+/i, "")}`;
  return g || (plate ? `the ${plate.replace(/^the\s+/i, "")}` : "");
}

export function normalizePlan(raw: unknown): SausagePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<SausagePlan>;
  if (p.format !== 1 || typeof p.id !== "string" || !Array.isArray(p.purchases)) return null;
  return {
    format: 1, id: p.id, title: typeof p.title === "string" ? p.title : "Sausage day",
    createdAt: p.createdAt ?? "", updatedAt: p.updatedAt ?? p.createdAt ?? "",
    purchases: p.purchases, recipeIds: Array.isArray(p.recipeIds) ? p.recipeIds : [],
    alloc: p.alloc && typeof p.alloc === "object" ? p.alloc : {},
    status: p.status === "approved" ? "approved" : "draft", approvedAt: p.approvedAt ?? null, approvedBy: p.approvedBy ?? "",
    have: Array.isArray(p.have) ? p.have : [], results: p.results ?? {}, sessions: p.sessions ?? {}, snapshots: p.snapshots ?? {},
  };
}

export class PlanStore {
  private storage: KV;
  constructor(storage: KV) { this.storage = storage; }
  list(): SausagePlan[] {
    try {
      const v = JSON.parse(this.storage.getItem(PLANS_KEY) ?? "[]");
      return (Array.isArray(v) ? v.map(normalizePlan).filter((x): x is SausagePlan => !!x) : []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }
  get(id: string): SausagePlan | null { return this.list().find((p) => p.id === id) ?? null; }
  // Plans are only ever added or updated here; there is no delete.
  put(plan: SausagePlan): void {
    const rest = this.list().filter((p) => p.id !== plan.id);
    this.storage.setItem(PLANS_KEY, JSON.stringify([plan, ...rest]));
  }
}
