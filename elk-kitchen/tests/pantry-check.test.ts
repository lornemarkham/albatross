// Reading ELK Pantry for a free-text family recipe: honest have / missing /
// unknown, and Inventory's own counting rules for what's on hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRecipe, ingredientName } from "../src/lib/pantryCheck";
import { summarizePantry, type PantryItem } from "../src/lib/pantry";

const p = (name: string, onHand: number, extra: Partial<PantryItem> = {}): PantryItem =>
  ({ name, onHand, unit: "items", bestBefore: null, location: "", ...extra });

const PANTRY = [p("Jasmine Rice", 2, { unit: "bags" }), p("Chicken thighs", 1), p("Diced Tomatoes", 0, { unit: "cans" }), p("Tomato paste", 1)];

test("ingredient names lose amounts and units, keep the food", () => {
  assert.equal(ingredientName("2 1/2 cups plain flour, sifted"), "plain flour");
  assert.equal(ingredientName("1 (400 g) can diced tomatoes"), "diced tomatoes");
  assert.equal(ingredientName("½ tsp salt"), "salt");
  assert.equal(ingredientName("Broccoli"), "Broccoli");
});

test("have / missing / unknown, and an incomplete pantry is never proof of missing", () => {
  const r = checkRecipe("Sauce:\n2 cups jasmine rice\n1 can diced tomatoes\n3 tomatoes\nchicken\n1 head broccoli\nsalt\n", PANTRY);
  const by = Object.fromEntries(r.lines.map((l) => [l.name, l.status]));
  assert.equal(by["jasmine rice"].state, "have");
  assert.equal(by["diced tomatoes"].state, "missing", "Pantry tracks it and shows none left");
  // "Tomato paste" resembles "tomatoes" but isn't confirmed — just a hint.
  assert.deepEqual(by["tomatoes"], { state: "unknown", maybe: PANTRY[3] });
  // "chicken" vs the product "Chicken thighs": a hint, not a confirmation.
  assert.equal(by["chicken"].state, "unknown");
  assert.deepEqual(by["broccoli"], { state: "unknown", maybe: null });
  assert.equal(by["salt"].state, "basic");
  assert.equal(r.lines.length, 6, "the 'Sauce:' heading isn't an ingredient");
  assert.deepEqual([r.have, r.missing, r.unknown, r.total], [1, 1, 3, 5]);
  assert.equal(r.headline, "Pantry confirms 1 of 5 ingredients · 1 it shows none left of · 3 it doesn't know about");
  assert.equal(r.prompt, "You have jasmine rice. Do you have tomatoes, chicken and broccoli?");
});

test("an empty or unrelated pantry claims nothing", () => {
  const r = checkRecipe("1 onion\n2 carrots", []);
  assert.deepEqual([r.have, r.missing, r.unknown], [0, 0, 2]);
  assert.equal(r.headline, "Pantry has no record of these ingredients");
  assert.equal(r.prompt, "Do you have onion and carrots?");
});

test("on-hand follows Inventory: batches are the truth once a product has any", () => {
  const items = [
    { id: "a", name: "Black beans", quantity: 5, attributes: { unit: "cans" } },
    { id: "b", name: "Oats", quantity: 3, attributes: null },
    { id: "c", name: "Lentils", quantity: 0, attributes: {} },
  ];
  const lots = [
    { item_id: "a", quantity_remaining: 1, location: "Basement", best_before: "2027-01-01", purchased_on: "2026-01-01", created_at: "1" },
    { item_id: "a", quantity_remaining: 2, location: "Kitchen", best_before: "2026-11-01", purchased_on: "2026-05-01", created_at: "2" },
    { item_id: "a", quantity_remaining: 0, location: "Garage", best_before: "2025-01-01", purchased_on: "2025-01-01", created_at: "0" },
  ];
  assert.deepEqual(summarizePantry(items, lots), [
    { name: "Black beans", onHand: 3, unit: "cans", bestBefore: "2026-11-01", location: "Basement" },
    { name: "Oats", onHand: 3, unit: "items", bestBefore: null, location: "" },
    { name: "Lentils", onHand: 0, unit: "items", bestBefore: null, location: "" },
  ]);
});
