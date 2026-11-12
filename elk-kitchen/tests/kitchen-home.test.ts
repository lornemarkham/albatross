// ELK Home · Kitchen (M783): the wall screen's "today", star ratings over the
// existing 0–10 scores, the plan board, the offline snapshot, navigation, and
// the family shopping list against ELK Inventory's real SQL (read, add without
// duplicates, tick off and undo, shared between members, stock untouched).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { RECIPE_EXTRA, ENTRY_EXTRA } from "./defaults.ts";
import { kitchenToday, familyRecord, isDinnerCandidate } from "../src/lib/home/kitchenToday";
import { litStars, ratingToStars, starText, starsToRating } from "../src/lib/home/stars";
import { MealPlanStore } from "../src/lib/home/mealPlan";
import { readSnapshot, saveSnapshot, SNAPSHOT_MAX_CHARS } from "../src/lib/home/snapshot";
import { KITCHEN_NAV, LOCATIONS, showsNav } from "../src/lib/home/locations";
import { loadShoppingList, onListAlready, setShoppingDone } from "../src/lib/companion/shopping";
import { addToShoppingList, loadPantry, type PantryItem } from "../src/lib/pantry";
import type { RecipeSummary, Recipe, CookingEntry } from "../src/types/recipe";
import type { MealFeedback } from "../src/types/feedback";
import type { HistoryItem } from "../src/lib/cooking/history";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

const TODAY = "2026-11-12";
const recipe = (id: string, title: string, ingredients: string, over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id, title, authorName: "", ingredients, instructions: "Step one.\nStep two.", notes: "", tags: [], suggestedTags: [], approxCalories: null,
  ...RECIPE_EXTRA, version: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  lastCookedOn: "", timesCooked: 0, favourite: false, ...over,
});
const item = (name: string, onHand: number, over: Partial<PantryItem> = {}): PantryItem =>
  ({ name, onHand, unit: "packs", location: "Fridge", bestBefore: null, places: [{ location: "Fridge", quantity: onHand, bestBefore: over.bestBefore ?? null }], ...over });
const fb = (over: Partial<MealFeedback>): MealFeedback => ({
  id: Math.random().toString(36).slice(2), entryId: "e1", recipeId: "r", authorName: "Lorne", rating: null, scores: { flavour: null, seasoning: null, texture: null, juiciness: null },
  comment: "", improvement: "", makeAgain: null, photos: [], source: "app", version: 1, history: [], createdAt: "2026-11-01T18:00:00Z", updatedAt: "2026-11-01T18:00:00Z", mine: false, ...over,
});

const RECIPES = [
  recipe("curry", "Chicken Curry", "500 g chicken thighs\n1 onion\n1 can coconut milk\nRice"),
  recipe("pasta", "Tomato Pasta", "Pasta\n1 can tomatoes\n1 onion\nParmesan"),
  recipe("stock", "Chicken Stock", "Chicken bones\nWater", { category: "Staples & dressings" }),
  recipe("brat", "Bratwurst", "Pork shoulder\nCasings", { kind: "sausage" }),
];
const PANTRY = [
  item("Chicken thighs", 2, { bestBefore: "2026-11-13", lastReceivedOn: "2026-11-10" }),
  item("Onion", 3, { location: "Pantry", lastReceivedOn: "2026-10-01" }),
  item("Coconut milk", 0, { lowStockAt: 1 }),
  item("Rice", 1, { lowStockAt: 2, lastReceivedOn: "2026-11-11" }),
  item("Pasta", 4),
  item("Leftover chili", 2, { lastReceivedOn: "2026-11-11" }),
];
const base = { recipes: RECIPES, feedback: [] as MealFeedback[], profiles: [], history: [] as HistoryItem[], pantry: PANTRY, planned: [], today: TODAY };

test("Today: existing pantry food appears — in stock, running low, expiring soon, recently added, leftovers", () => {
  const v = kitchenToday(base);
  assert.equal(v.pantryConnected, true);
  assert.deepEqual(v.available.map((p) => p.name), ["Chicken thighs", "Leftover chili", "Onion", "Pasta", "Rice"]);
  assert.deepEqual(v.low.map((p) => p.name), ["Coconut milk", "Rice"]);
  assert.deepEqual(v.soon.map((s) => s.item.name), ["Chicken thighs"]);
  assert.deepEqual(v.recentlyAdded.map((p) => p.name), ["Leftover chili", "Rice", "Chicken thighs"]);
  assert.deepEqual(v.leftovers.map((p) => p.name), ["Leftover chili"]);
});

test("Suggested dinner uses the food that needs eating, says why, and lists what Pantry shows none of", () => {
  const v = kitchenToday(base);
  const top = v.dinner[0];
  assert.equal(top.suggestion.recipe.id, "curry");
  assert.ok(top.why.some((w) => w.startsWith("Uses the chicken thighs that needs eating (best before tomorrow)")), top.why.join(" | "));
  assert.ok(top.why.includes("Pantry shows 3 of 4 ingredients"), top.why.join(" | "));
  assert.deepEqual(top.suggestion.missing.map((m) => m.status.state === "missing" && m.status.item.name), ["Coconut milk"]);
  // Staples and sausage batches aren't dinners.
  assert.ok(v.dinner.every((d) => d.suggestion.recipe.id !== "stock" && d.suggestion.recipe.id !== "brat"));
  assert.equal(isDinnerCandidate(RECIPES[2]), false);
  assert.equal(isDinnerCandidate(RECIPES[3]), false);
});

test("Ratings influence the next recommendation, in stars, and 'not again' keeps a dinner off the wall", () => {
  const noPantry = { ...base, pantry: null };
  assert.equal(kitchenToday(noPantry).dinner[0].suggestion.recipe.id, "curry", "alphabetical tie without ratings");
  const loved = [fb({ recipeId: "pasta", entryId: "p1", authorName: "Kathy", rating: 10, makeAgain: "yes" }), fb({ recipeId: "pasta", entryId: "p1", authorName: "Sam", rating: 9 })];
  const v = kitchenToday({ ...noPantry, feedback: loved });
  assert.equal(v.dinner[0].suggestion.recipe.id, "pasta");
  assert.ok(v.dinner[0].why.includes("Your family rated this 4.8 stars (2 ratings)"), v.dinner[0].why.join(" | "));
  assert.ok(v.dinner[0].why.includes("Kathy wants it again"));
  assert.deepEqual(v.favourites.map((f) => [f.recipe.id, f.stars]), [["pasta", 4.8]]);
  const disliked = kitchenToday({ ...noPantry, feedback: [fb({ recipeId: "curry", entryId: "c1", authorName: "Kathy", rating: 2, makeAgain: "no" })] });
  assert.ok(disliked.dinner.every((d) => d.suggestion.recipe.id !== "curry"));
});

test("Without ELK Pantry, nothing about stock is claimed", () => {
  const v = kitchenToday({ ...base, pantry: null });
  assert.equal(v.pantryConnected, false);
  assert.deepEqual([v.available.length, v.low.length, v.soon.length, v.recentlyAdded.length], [0, 0, 0, 0]);
  assert.ok(v.dinner.every((d) => !d.why.some((w) => /Pantry/.test(w))));
});

test("Stars sit on the existing 0–10 scale: a star is two points, old scores keep their meaning", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(starsToRating), [2, 4, 6, 8, 10]);
  assert.deepEqual([10, 9, 8, 7.7, 0].map(ratingToStars), [5, 4.5, 4, 3.9, 0]);
  assert.deepEqual([null, 0, 7, 8, 10].map(litStars), [0, 0, 4, 4, 5]);
  assert.equal(starText(8), "★★★★☆ 4");
});

test("A recipe's family record: average stars, each person's latest, times cooked, last cooked", () => {
  const entries = [{ cookedOn: "2026-11-01" }, { cookedOn: "2026-10-03" }, { cookedOn: "" }];
  const feedback = [
    fb({ recipeId: "curry", authorName: "Kathy", rating: 6, updatedAt: "2026-10-03T19:00:00Z" }),
    fb({ recipeId: "curry", authorName: "Kathy", rating: 10, makeAgain: "yes", comment: "Better with lime", updatedAt: "2026-11-01T19:00:00Z" }),
    fb({ recipeId: "curry", authorName: "Sam", rating: 8 }),
    fb({ recipeId: "pasta", authorName: "Sam", rating: 2 }),
  ];
  const r = familyRecord({ id: "curry" }, entries, feedback, true);
  assert.equal(r.stars, 4.5);
  assert.deepEqual(r.people.map((p) => [p.name, p.stars, p.again, p.comment]), [["Kathy", 5, "yes", "Better with lime"], ["Sam", 4, null, ""]]);
  assert.deepEqual([r.timesCooked, r.lastCookedOn, r.favourite], [3, "2026-11-01", true]);
  assert.equal(familyRecord({ id: "none" }, [], feedback, false).stars, null);
});

test("Plan board: add, the same meal once per day, remove, only today onwards", () => {
  const s = new MealPlanStore(new MemoryStorage());
  const a = s.add(TODAY, "Chicken Curry", "curry", "2026-11-12T10:00:00Z");
  assert.equal(s.add(TODAY, "Chicken Curry", "curry").id, a.id);
  s.add("2026-11-13", "Tacos", null);
  s.add("2026-11-01", "Old", null);
  s.add("2026-11-30", "Far", null);
  assert.deepEqual(s.upcoming(TODAY).map((m) => m.title), ["Chicken Curry", "Tacos"]);
  s.remove(a.id);
  assert.deepEqual(s.upcoming(TODAY).map((m) => m.title), ["Tacos"]);
  assert.throws(() => s.add(TODAY, "  ", null));
});

test("Offline snapshot: recipes (with method), pantry and list, timed; removed recipes left out; too big is refused", () => {
  const st = new MemoryStorage();
  assert.equal(readSnapshot(st), null);
  const recipes = [...RECIPES, recipe("gone", "Gone", "x", { removedAt: "2026-11-01" })];
  assert.equal(saveSnapshot(st, { at: "2026-11-12T17:00:00Z", recipes, pantry: PANTRY, shopping: ["Milk"] }), true);
  const s = readSnapshot(st)!;
  assert.equal(s.at, "2026-11-12T17:00:00Z");
  assert.deepEqual(s.recipes.map((r) => r.id), ["curry", "pasta", "stock", "brat"]);
  assert.equal(s.recipes[0].instructions, "Step one.\nStep two.");
  assert.deepEqual([s.pantry?.length, s.shopping], [PANTRY.length, ["Milk"]]);
  const huge = [recipe("big", "Big", "x".repeat(SNAPSHOT_MAX_CHARS))];
  assert.equal(saveSnapshot(st, { at: "later", recipes: huge, pantry: null, shopping: null }), false);
  assert.equal(readSnapshot(st)!.at, "2026-11-12T17:00:00Z", "the older snapshot is kept");
});

test("ELK Home navigation: Kitchen built, other places named; full-screen cooking hides the rail", () => {
  assert.deepEqual(LOCATIONS.filter((l) => l.home).map((l) => l.key), ["kitchen"]);
  assert.deepEqual(LOCATIONS.map((l) => l.key), ["kitchen", "workshop", "household", "power"]);
  assert.deepEqual(KITCHEN_NAV.map((n) => n.to), ["/", "/recipes", "/pantry", "/shopping", "/cook", "/food"]);
  assert.equal(KITCHEN_NAV.find((n) => n.match("/recipe/abc"))?.label, "Recipes");
  assert.equal(showsNav("/"), true);
  assert.equal(showsNav("/cook"), true);
  assert.equal(showsNav("/cook/s1"), false);
  assert.equal(showsNav("/cook/s1/review"), true);
  assert.equal(showsNav("/ideas/cook/saved/r1"), false);
});

// ── The family shopping list, against ELK Inventory's real SQL ───────────────
const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const STRANGER = "00000000-0000-0000-0000-0000000000ff";
let db: PGlite;

// supabase-js as far as shopping.ts / pantry.ts use it (select/is/eq/order/limit, update, rpc, auth.getUser).
function clientAs(uid: string): SupabaseClient {
  const as = asUser(db);
  const text = (v: unknown) => (v instanceof Date ? (v.toISOString().endsWith("T00:00:00.000Z") ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
  const run = async (sql: string, params: unknown[]) => {
    try { return { data: (await as(uid, sql, params)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)]))), error: null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  };
  return {
    auth: { async getUser() { return { data: { user: { id: uid } } }; } },
    from(table: string) {
      let cols = "*"; let order = ""; let set: Record<string, unknown> | null = null;
      const where: string[] = []; const params: unknown[] = [];
      const b = {
        select(c: string) { cols = c; return b; },
        update(v: Record<string, unknown>) { set = v; return b; },
        eq(k: string, v: unknown) { params.push(v); where.push(`${k} = $${params.length}`); return b; },
        is(k: string, v: null) { where.push(`${k} IS ${v === null ? "NULL" : "NOT NULL"}`); return b; },
        order(k: string) { order = ` ORDER BY ${k}`; return b; },
        limit() { return b; },
        then(res: (r: unknown) => unknown, rej: (e: unknown) => unknown) {
          const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
          if (set) {
            const keys = Object.keys(set);
            const n = params.length;
            const sql = `UPDATE public.${table} SET ${keys.map((k, i) => `${k} = $${n + i + 1}`).join(", ")}${w}`;
            return run(sql, [...params, ...keys.map((k) => set![k])]).then(res, rej);
          }
          return run(`SELECT ${cols} FROM public.${table}${w}${order}`, params).then(res, rej);
        },
      };
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const r = await run(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) AS v`, names.map((n) => args[n]));
      return r.error ? r : { data: (r.data as { v: unknown }[])[0].v, error: null };
    },
  } as unknown as SupabaseClient;
}

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "tests/fixtures/inventory-main-supabase-schema.sql");
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await runFile(db, "tests/fixtures/inventory-next-supabase-pantry.sql");
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com'), ('${BOB}', 'b@example.com'), ('${STRANGER}', 'x@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('rice-01', 'Rice', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Pantry shelf', 0, '{"unit":"bags","lowStockAt":2}');
  `);
  await addMember(db, ALICE, "Alice");
  await addMember(db, BOB, "Bob");
  await asUser(db)(ALICE, "SELECT pantry_receive('rice-01', 1, 'Pantry shelf', NULL, '2026-11-11')");
});

const stock = async () => (await db.query<{ q: number }>("SELECT sum(quantity_remaining)::int q FROM stock_lots")).rows[0].q;

test("Shopping: missing ingredients go on Inventory's one list, never twice; every member sees it; ticking off and Undo sync; stock untouched", async () => {
  const stockBefore = await stock();
  const a = clientAs(ALICE), b = clientAs(BOB);
  assert.deepEqual(await addToShoppingList(a, ["Coconut milk", "Rice"], "Chicken Curry"), { ok: true, added: 2 });
  // The same thing again (any case) isn't added: the curry's missing list and a quick add.
  assert.deepEqual(await addToShoppingList(b, ["coconut milk", "Limes"], "", "added in Kitchen"), { ok: true, added: 1 });

  const bobSees = await loadShoppingList(b);
  assert.equal(bobSees.status, "ready");
  const items = (bobSees as { items: { id: string; name: string; note: string | null; source: string }[] }).items;
  assert.deepEqual(items.map((i) => [i.name, i.note, i.source]), [["Coconut milk", "for Chicken Curry", "recipe"], ["Rice", "for Chicken Curry", "recipe"], ["Limes", "added in Kitchen", "manual"]]);
  assert.equal(onListAlready("  COCONUT   milk", items.map((i) => i.name)), true);
  assert.equal(onListAlready("Coconut cream", items.map((i) => i.name)), false);

  // Alice ticks off on the wall; Bob's phone no longer lists it; Undo brings it back.
  const coconut = items[0];
  assert.deepEqual(await setShoppingDone(a, coconut.id, true), { ok: true });
  const after = await loadShoppingList(b);
  assert.deepEqual((after as { items: { name: string }[] }).items.map((i) => i.name), ["Rice", "Limes"]);
  const [{ done_by }] = (await db.query<{ done_by: string }>("SELECT done_by FROM pantry_shopping_items WHERE id = $1", [coconut.id])).rows;
  assert.equal(done_by, ALICE);
  await setShoppingDone(a, coconut.id, false);
  assert.equal(((await loadShoppingList(b)) as { items: unknown[] }).items.length, 3);

  // Nobody outside the family sees the list or can tick it.
  const stranger = await loadShoppingList(clientAs(STRANGER));
  assert.ok(stranger.status === "ready" && stranger.items.length === 0);
  await setShoppingDone(clientAs(STRANGER), coconut.id, true);
  assert.equal(((await loadShoppingList(b)) as { items: unknown[] }).items.length, 3, "a stranger's update changes nothing");

  // The list never moved stock; Pantry's own reading is unchanged.
  assert.equal(await stock(), stockBefore);
  const p = await loadPantry(b);
  assert.ok(p.status === "ready" && p.items.find((i) => i.name === "Rice")?.onHand === 1);
});

// Keeps the fixture types honest for the history panel.
test("Recently cooked comes straight from cooking history, newest first, at most five", () => {
  const r: Recipe = { ...recipe("curry", "Chicken Curry", "x") };
  const entry = (id: string, cookedOn: string): CookingEntry => ({ id, recipeId: "curry", cookedOn, cookName: "", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA, createdAt: "", mine: true });
  const history: HistoryItem[] = ["6", "5", "4", "3", "2", "1"].map((d) => ({ recipe: r, entry: entry(`e${d}`, `2026-11-0${d}`) }));
  assert.deepEqual(kitchenToday({ ...base, history }).recentlyCooked.map((h) => h.entry.id), ["e6", "e5", "e4", "e3", "e2"]);
});
