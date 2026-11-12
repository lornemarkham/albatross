// "What's planned": meals someone put on the plan from this screen. Kept in
// this browser (the wall tablet is the household's plan board). It is not
// shared with other phones yet: that needs a kitchen.sql table, and the screen
// says so. A plan is never a cook: nothing here touches Pantry or history.

import { newId } from "../recipeModel";

export const PLAN_KEY = "elk-kitchen-meal-plan-v1";

export type PlannedMeal = { id: string; date: string; recipeId: string | null; title: string; addedAt: string };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export class MealPlanStore {
  private storage: Storage;
  constructor(storage: Storage) { this.storage = storage; }

  list(): PlannedMeal[] {
    try {
      const raw = JSON.parse(this.storage.getItem(PLAN_KEY) ?? "[]");
      return (Array.isArray(raw) ? raw : []).filter((m): m is PlannedMeal =>
        !!m && typeof m.id === "string" && typeof m.date === "string" && typeof m.title === "string")
        .sort((a, b) => a.date.localeCompare(b.date) || a.addedAt.localeCompare(b.addedAt));
    } catch {
      return [];
    }
  }

  add(date: string, title: string, recipeId: string | null, now = new Date().toISOString()): PlannedMeal {
    const meal: PlannedMeal = { id: newId(), date, recipeId, title: title.trim().slice(0, 200), addedAt: now };
    if (!meal.title) throw new Error("A planned meal needs a name.");
    const all = this.list();
    // The same meal on the same day is planned once.
    const same = all.find((m) => m.date === date && (recipeId ? m.recipeId === recipeId : m.title.toLowerCase() === meal.title.toLowerCase()));
    if (same) return same;
    this.storage.setItem(PLAN_KEY, JSON.stringify([...all, meal]));
    return meal;
  }

  remove(id: string): void {
    this.storage.setItem(PLAN_KEY, JSON.stringify(this.list().filter((m) => m.id !== id)));
  }

  // Today and the next `days` days; anything older drops off the board (kept in storage).
  upcoming(today: string, days = 6): PlannedMeal[] {
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days);
    const last = end.toISOString().slice(0, 10);
    return this.list().filter((m) => m.date >= today && m.date <= last);
  }
}
