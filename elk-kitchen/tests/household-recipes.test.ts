// Ounce display (display only) and the household staples / sausage cards in the book.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toOunces, displayMeasures, readUnitSystem, saveUnitSystem } from "../src/lib/units";
import { STAPLE_RECIPES, ensureHouseholdRecipes } from "../src/lib/household/staples";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

test("weights and volumes show in ounces", () => {
  assert.equal(toOunces("Salt: 72 g"), "Salt: 2.5 oz");
  assert.equal(toOunces("5 lb pork tenderloin"), "80 oz pork tenderloin");
  assert.equal(toOunces("2 kg flour"), "71 oz flour");
  assert.equal(toOunces("Maple syrup: 120 ml"), "Maple syrup: 4.1 fl oz");
  assert.equal(toOunces("0.5 lb pork belly"), "8 oz pork belly");
  assert.equal(toOunces("1/2 kg beef"), "18 oz beef");
});

test("lines with no metric measure are untouched", () => {
  for (const t of ["1/2 cup beer", "2 tbsp olive oil", "Salt 2%", "3 garlic cloves", "10 gloves", "Fresh grated ginger"]) assert.equal(toOunces(t), t);
});

test("the stored text is never changed; as-written returns it exactly", () => {
  const text = "120 g sour cream\n1 litre water";
  assert.equal(displayMeasures(text, "as-written"), text);
  assert.equal(displayMeasures(text, "ounces"), "4.2 oz sour cream\n34 fl oz water");
});

test("the choice is remembered, and a bad store means as-written", () => {
  const s = new MemoryStorage();
  assert.equal(readUnitSystem(s), "as-written");
  saveUnitSystem("ounces", s);
  assert.equal(readUnitSystem(s), "ounces");
  assert.equal(readUnitSystem({ getItem: () => { throw new Error("blocked"); }, setItem() {} }), "as-written");
});

test("staples include dressings and every one has ingredients and method", () => {
  assert.ok(STAPLE_RECIPES.length >= 8);
  assert.ok(STAPLE_RECIPES.filter((r) => r.tags.includes("dressing")).length >= 3);
  for (const r of STAPLE_RECIPES) assert.ok(r.ingredients.trim() && r.instructions.trim() && r.category !== "", r.title);
});

test("staples and the four sausage cards are added once and never replace anything", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage());
  const before = await store.listRecipes();
  const added = await ensureHouseholdRecipes(store);
  assert.equal(added, STAPLE_RECIPES.length + 4);
  const titles = (await store.listRecipes()).map((r) => r.title);
  for (const t of ["House Vinaigrette", "Ranch Dressing", "Breakfast Sausage", "Bratwurst", "Smokies", "Dinner Sausage"]) assert.ok(titles.includes(t), t);
  for (const r of before) assert.ok(titles.includes(r.title), `kept ${r.title}`);
  assert.equal(await ensureHouseholdRecipes(store), 0);
  assert.equal((await store.listRecipes()).length, before.length + added);
});

test("a deleted staple is not brought back, and a typed one is not duplicated", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage());
  await ensureHouseholdRecipes(store);
  const ranch = (await store.listRecipes()).find((r) => r.title === "Ranch Dressing")!;
  await store.setRemoved(ranch.id, ranch.version, true);
  assert.equal(await ensureHouseholdRecipes(store), 0);
  assert.ok(!(await store.listRecipes()).some((r) => r.title === "Ranch Dressing"));
});

test("two simultaneous callers add each recipe once", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage());
  const [a, b] = await Promise.all([ensureHouseholdRecipes(store), ensureHouseholdRecipes(store)]);
  assert.equal(a, b);
  const titles = (await store.listRecipes()).map((r) => r.title);
  assert.equal(new Set(titles).size, titles.length);
});
