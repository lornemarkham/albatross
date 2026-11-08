// Reading ELK Pantry for a free-text family recipe: honest have / missing /
// unknown, and Inventory's own counting rules for what's on hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRecipe, ingredientName } from "../src/lib/pantryCheck";
import { addToShoppingList, summarizePantry, type PantryItem } from "../src/lib/pantry";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    { id: "a", name: "Black beans", quantity: 5, attributes: { unit: "cans", opened: "opened" } },
    { id: "b", name: "Oats", quantity: 3, attributes: null },
    { id: "c", name: "Lentils", quantity: 0, attributes: {} },
  ];
  const lots = [
    { item_id: "a", quantity_remaining: 1, location: "Basement", best_before: "2027-01-01", purchased_on: "2026-01-01", created_at: "1" },
    { item_id: "a", quantity_remaining: 2, location: "Kitchen", best_before: "2026-11-01", purchased_on: "2026-05-01", created_at: "2" },
    { item_id: "a", quantity_remaining: 0, location: "Garage", best_before: "2025-01-01", purchased_on: "2025-01-01", created_at: "0" },
  ];
  assert.deepEqual(summarizePantry(items, lots), [
    { name: "Black beans", onHand: 3, unit: "cans", bestBefore: "2026-11-01", location: "Basement",
      // Every open batch, oldest first; the empty Garage batch isn't one.
      places: [{ location: "Basement", quantity: 1, bestBefore: "2027-01-01", receivedOn: "2026-01-01" }, { location: "Kitchen", quantity: 2, bestBefore: "2026-11-01", receivedOn: "2026-05-01" }],
      lowStockAt: null,
      // Inventory's own product id, its "Opened?" field, and when the newest open batch came in.
      itemId: "a", opened: true, lastReceivedOn: "2026-05-01" },
    { name: "Oats", onHand: 3, unit: "items", bestBefore: null, location: "", places: [], lowStockAt: null, itemId: "b", opened: null, lastReceivedOn: null },
    { name: "Lentils", onHand: 0, unit: "items", bestBefore: null, location: "", places: [], lowStockAt: null, itemId: "c", opened: null, lastReceivedOn: null },
  ]);
});

// ── Adding a recipe's missing ingredients to Pantry's shopping list ─────────────
const fakeClient = (reply: { data?: unknown; error?: { code?: string; message: string } | null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: reply.data ?? null, error: reply.error ?? null }; } };
  return { client: client as unknown as SupabaseClient, calls };
};

test("shopping: sends the names through pantry_shopping_add, marked as from this recipe", async () => {
  const { client, calls } = fakeClient({ data: 2 });
  const r = await addToShoppingList(client, ["Basmati Rice", "fresh basil"], " Green curry ");
  assert.deepEqual(r, { ok: true, added: 2 });
  assert.deepEqual(calls, [{ fn: "pantry_shopping_add", args: { p_names: ["Basmati Rice", "fresh basil"], p_note: "for Green curry", p_source: "recipe" } }]);
});

test("shopping: says plainly when Pantry's database doesn't have the list yet", async () => {
  const { client } = fakeClient({ error: { code: "PGRST202", message: "Could not find the function" } });
  assert.deepEqual(await addToShoppingList(client, ["eggs"], "Cake"), { ok: false, error: "The shopping list isn't switched on in ELK Pantry yet." });
});
