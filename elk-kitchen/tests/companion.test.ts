// The family cooking companion: asking what to cook, grounded in ELK Pantry,
// the family's recorded feedback and food notes; shopping requests; and family
// dinner feedback in both storage modes.
import { RECIPE_EXTRA, ENTRY_EXTRA } from "./defaults.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAsk, heard } from "../src/lib/companion/ask";
import { recommend, type Grounding } from "../src/lib/companion/recommend";
import { leftovers, useSoon, stockLabel } from "../src/lib/companion/pantryView";
import { parseShopping, reviewLines } from "../src/lib/companion/shopping";
import { tasteByRecipe, avoidList } from "../src/lib/familyMemory";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { SharedRecipeStore } from "../src/lib/sharedRecipeStore";
import { parseImportFile } from "../src/lib/recipeModel";
import { summarizePantry, type PantryItem } from "../src/lib/pantry";
import type { RecipeSummary } from "../src/types/recipe";
import type { MealFeedback, MemberProfile } from "../src/types/feedback";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

const TODAY = "2026-11-07";
const recipe = (id: string, title: string, ingredients: string, over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id, title, authorName: "", ingredients, instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null,
  ...RECIPE_EXTRA, version: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  lastCookedOn: "", timesCooked: 0, favourite: false, ...over,
});
const pantryItem = (name: string, onHand: number, unit: string, location: string, bestBefore: string | null = null): PantryItem =>
  ({ name, onHand, unit, location, bestBefore, places: [{ location, quantity: onHand, bestBefore }] });
const fb = (over: Partial<MealFeedback>): MealFeedback => ({
  id: Math.random().toString(36).slice(2), entryId: "e1", recipeId: "r", authorName: "Lorne", rating: null, scores: { flavour: null, seasoning: null, texture: null, juiciness: null }, comment: "", improvement: "",
  makeAgain: null, photos: [], source: "app", version: 1, history: [], createdAt: "2026-10-20T18:00:00Z", updatedAt: "2026-10-20T18:00:00Z", mine: false, ...over,
});

const RECIPES = [
  recipe("stirfry", "Chicken Stir-fry", "2 cups leftover chicken\n1 bunch spinach\nSoy sauce\nRice", { tags: ["weeknight", "quick"] }),
  recipe("chili", "Elk Chili", "1 lb ground elk\n2 cans black beans\n1 onion\nMushrooms"),
  recipe("dal", "Red Lentil Dal", "1 cup red lentils\n1 onion\nSpinach\nCoconut milk"),
  recipe("pasta", "Creamy Pasta", "Pasta\nCream\nParmesan\nChicken"),
];
const PANTRY: PantryItem[] = [
  pantryItem("Leftover chicken", 2, "containers", "Fridge", "2026-11-08"),
  pantryItem("Spinach", 1, "bags", "Fridge", "2026-11-09"),
  pantryItem("Rice", 3, "bags", "Pantry shelf"),
  pantryItem("Black beans", 4, "cans", "Pantry shelf", "2027-05-01"),
  pantryItem("Cream", 0, "cartons", "Fridge"),
];
const ground = (over: Partial<Grounding> = {}): Grounding =>
  ({ recipes: RECIPES, pantry: PANTRY, taste: new Map(), profiles: [], today: TODAY, ...over });

// Every number Kitchen shows about stock must be one of Pantry's own numbers.
function assertNoInventedQuantities(texts: string[], pantry: PantryItem[]) {
  const pantryNumbers = new Set(pantry.flatMap((p) => [p.onHand, ...(p.places ?? []).map((l) => l.quantity)]).map(String));
  for (const t of texts) {
    for (const m of t.matchAll(/(\d+) (containers|bags|cans|cartons|packs)/g)) {
      assert.ok(pantryNumbers.has(m[1]), `"${t}" shows ${m[1]} ${m[2]}, which Pantry never said`);
    }
  }
}

test("the brief's requests are understood (rules, shown back to the person)", () => {
  const a = parseAsk("What can I make with what we have?");
  assert.equal(a.kind, "ideas"); assert.ok(a.fromPantry);
  const b = parseAsk("What should we cook tonight?");
  assert.equal(b.meal, "dinner");
  const c = parseAsk("We need to use the leftover chicken.");
  assert.deepEqual(c.use, ["chicken"]); assert.ok(c.leftover);
  assert.equal(parseAsk("What's going bad soon?").kind, "going-off");
  const e = parseAsk("Give me three dinner ideas the family will like.");
  assert.equal(e.count, 3); assert.equal(e.meal, "dinner"); assert.ok(e.familyLikes);
  const f = parseAsk("Something vegetarian in 25 minutes, no mushrooms. We have chickpeas and feta");
  assert.deepEqual(f.diet, ["vegetarian"]); assert.equal(f.minutes, 25); assert.ok(f.quick);
  assert.deepEqual(f.avoid, ["mushrooms"]); assert.deepEqual(f.said, ["chickpeas", "feta"]);
  assert.ok(heard(f).includes("you have chickpeas, feta"));
});

test("leftover chicken: recipes that use it come first, citing what Pantry really shows", () => {
  const ans = recommend(parseAsk("We need to use the leftover chicken"), ground());
  assert.deepEqual(ans.suggestions.map((s) => s.recipe.id).slice(0, 2).sort(), ["pasta", "stirfry"]);
  assert.equal(ans.suggestions[0].recipe.id, "stirfry");
  const texts = ans.suggestions[0].reasons.map((r) => r.text);
  assert.ok(texts.some((t) => /Leftover chicken \(2 containers · Fridge\)/.test(t)), texts.join(" | "));
  assert.ok(texts.some((t) => /spinach — best before in 2 days/.test(t)), "uses the spinach that needs using");
  assertNoInventedQuantities(ans.suggestions.flatMap((s) => s.reasons.map((r) => r.text)), PANTRY);
  assert.deepEqual(ans.leftovers.map((p) => p.name), ["Leftover chicken"]);
});

test("what's going bad: best-before order (not purchase order), and the recipes that use them", () => {
  const soon = useSoon(PANTRY, TODAY);
  assert.deepEqual(soon.map((s) => [s.item.name, s.daysLeft]), [["Leftover chicken", 1], ["Spinach", 2]]);
  const ans = recommend(parseAsk("What's going bad soon?"), ground());
  assert.match(ans.reply, /Leftover chicken \(best before tomorrow\)/);
  assert.ok(ans.suggestions.every((s) => s.reasons.some((r) => r.source === "pantry")));
  assert.ok(ans.suggestions.some((s) => s.recipe.id === "dal"));
});

test("without Pantry, Kitchen says so and never claims stock; what you say stays 'you said'", () => {
  const ans = recommend(parseAsk("We have chicken and rice, what's for dinner?"), ground({ pantry: null }));
  assert.equal(ans.pantryConnected, false);
  assert.match(ans.reply, /Pantry isn't connected/);
  const all = ans.suggestions.flatMap((s) => s.reasons);
  assert.ok(!all.some((r) => r.source === "pantry" || r.source === "missing"), "no Pantry claims without Pantry");
  const said = ans.suggestions.find((s) => s.recipe.id === "stirfry")!.reasons.find((r) => r.source === "said");
  assert.equal(said?.text, "You said you have chicken and rice");
});

test("an ingredient only mentioned out loud is labelled as said, not as in Pantry", () => {
  const ans = recommend(parseAsk("Use up the parmesan"), ground());
  const pasta = ans.suggestions.find((s) => s.recipe.id === "pasta")!;
  assert.ok(pasta.reasons.some((r) => r.source === "said" && /parmesan, which you mentioned \(not in Pantry\)/.test(r.text)));
  // Cream: Pantry tracks it and shows none left → missing (a shopping candidate); Parmesan: unknown, never "missing".
  assert.deepEqual(pasta.missing.map((m) => m.name), ["Cream"]);
  assert.ok(pasta.unknown.some((m) => m.name === "Parmesan"));
});

test("family ratings and 'make it again' steer suggestions, quoted with who said them", () => {
  const taste = tasteByRecipe([
    fb({ recipeId: "dal", entryId: "d1", authorName: "Kathy", rating: 9, makeAgain: "yes" }),
    fb({ recipeId: "dal", entryId: "d1", authorName: "Sam", rating: 8, makeAgain: "yes" }),
    fb({ recipeId: "chili", entryId: "c1", authorName: "Kathy", rating: 4, makeAgain: "no", improvement: "Less cumin" }),
  ]);
  const ans = recommend(parseAsk("Give me three dinner ideas the family will like"), ground({ taste }));
  assert.equal(ans.suggestions.length, 3);
  assert.equal(ans.suggestions[0].recipe.id, "dal");
  const dal = ans.suggestions[0].reasons.map((r) => r.text);
  assert.ok(dal.includes("Rated 8.5/10 on average by 2 people (Kathy 9, Sam 8)"), dal.join(" | "));
  assert.ok(dal.includes("Kathy and Sam said they'd have it again"));
  assert.ok(!ans.suggestions.some((s) => s.recipe.id === "chili"), "'not again' drops out of a three-idea answer");
  const chili = recommend(parseAsk("Use up the black beans"), ground({ taste })).suggestions.find((s) => s.recipe.id === "chili");
  assert.ok(chili?.reasons.some((r) => r.source === "caution" && r.text === "Kathy said not again"));
});

test("no family feedback → no claimed tastes", () => {
  const ans = recommend(parseAsk("What should we cook tonight?"), ground());
  assert.ok(!ans.suggestions.flatMap((s) => s.reasons).some((r) => r.source === "family"));
});

test("food notes: someone's 'avoids' is flagged in their words; diet requests are firm, loosened out loud", () => {
  const profiles: MemberProfile[] = [{ key: "k", name: "Kathy", avoids: "mushrooms, coconut", likes: "", notes: "", updatedAt: "", mine: false }];
  assert.deepEqual(avoidList(profiles[0]), ["mushrooms", "coconut"]);
  const ans = recommend(parseAsk("Give me six ideas"), ground({ profiles }));
  const chili = ans.suggestions.find((s) => s.recipe.id === "chili");
  assert.ok(chili?.reasons.some((r) => r.text === "Kathy avoids mushrooms (their food notes) — the recipe lists it"));
  const veg = recommend(parseAsk("something vegetarian"), ground());
  assert.ok(veg.suggestions.every((s) => !["stirfry", "pasta", "chili"].includes(s.recipe.id)));
  const none = recommend(parseAsk("vegan with the leftover chicken"), ground());
  assert.ok(none.loosened.length > 0);
  assert.match(none.reply, /leave out/);
});

test("Pantry read keeps every batch's place and best-before, and Pantry's low-stock level", () => {
  const items = summarizePantry(
    [{ id: "i1", name: "Pork shoulder", quantity: 0, attributes: { unit: "packs", lowStockAt: 2 } }],
    [
      { item_id: "i1", quantity_remaining: 2, location: "Garage freezer", best_before: "2027-01-01", purchased_on: "2026-09-01", created_at: "a" },
      { item_id: "i1", quantity_remaining: 1, location: "Chest freezer", best_before: "2026-12-01", purchased_on: "2026-10-01", created_at: "b" },
    ]);
  assert.equal(items[0].onHand, 3);
  assert.equal(items[0].bestBefore, "2026-12-01");
  assert.equal(stockLabel(items[0]), "2 packs · Garage freezer, 1 packs · Chest freezer");
  assert.equal(items[0].lowStockAt, 2);
  assert.deepEqual(leftovers(items, ["Pork shoulder"]).map((p) => p.name), ["Pork shoulder"]);
});

test("shopping requests in plain words become a reviewable list", () => {
  assert.deepEqual(parseShopping("Add cream to the shopping list."), { kind: "add", names: ["cream"], reason: "asked" });
  assert.deepEqual(parseShopping("We're out of onions"), { kind: "add", names: ["onions"], reason: "out" });
  assert.deepEqual(parseShopping("we're running low on milk and eggs"), { kind: "add", names: ["milk", "eggs"], reason: "out" });
  assert.deepEqual(parseShopping("Add everything missing from this recipe"), { kind: "add-missing" });
  assert.equal(parseShopping("What should we cook tonight?"), null);
  const lines = reviewLines(["onions", "Cream", "cream", "saffron"], ["Cream"], [pantryItem("Onions", 2, "bags", "Pantry shelf")]);
  assert.deepEqual(lines.map((l) => [l.name, l.selected, l.onList]), [["onions", true, false], ["Cream", false, true], ["saffron", true, false]]);
  assert.match(lines[0].pantryNote, /Pantry still shows 2 bags of Onions — update it in Pantry/);
  assert.equal(lines[2].pantryNote, "Pantry has no record of it");
});

test("each person's latest say counts once per recipe", () => {
  const t = tasteByRecipe([
    fb({ recipeId: "r", entryId: "a", authorName: "Kathy", rating: 5, createdAt: "2026-09-01", updatedAt: "2026-09-01" }),
    fb({ recipeId: "r", entryId: "b", authorName: "Kathy", rating: 9, createdAt: "2026-10-01", updatedAt: "2026-10-01" }),
  ]).get("r")!;
  assert.deepEqual(t.ratings, [{ name: "Kathy", rating: 9 }]);
  assert.equal(t.dinners, 2);
});

test("this phone: several people rate one dinner; an edit keeps the earlier answer; backups carry it once", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage());
  const r = await store.createRecipe({ title: "Chili", authorName: "", ingredients: "", instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA });
  const e = await store.addCookingEntry(r.id, { cookedOn: TODAY, cookName: "Lorne", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA });
  const base = { comment: "", improvement: "", makeAgain: null, photos: [] };
  const k = await store.saveFeedback(e.id, { ...base, authorName: "Kathy", rating: 7, comment: "Salty" }, null);
  await store.saveFeedback(e.id, { ...base, authorName: "Sam", rating: 10, makeAgain: "yes" }, null);
  await assert.rejects(store.saveFeedback(e.id, { ...base, authorName: "kathy", rating: 1 }, null), /already given feedback/);
  const k2 = await store.saveFeedback(e.id, { ...base, authorName: "Kathy", rating: 8, comment: "Better the next day" }, k);
  assert.equal(k2.version, 2);
  assert.deepEqual(k2.history.map((h) => [h.rating, h.comment]), [[7, "Salty"]]);
  await assert.rejects(store.saveFeedback(e.id, { ...base, authorName: "Kathy", rating: 2 }, k), /changed this feedback first/);

  const bundle = await store.exportAll();
  assert.equal(bundle.mealFeedback?.length, 2);
  const data = parseImportFile(JSON.stringify(bundle), TODAY);
  const other = new DeviceRecipeStore(new MemoryStorage());
  assert.equal(await other.importFeedback(data.mealFeedback!), 0, "no dinner there yet → nothing attached to nothing");
  const { planImport } = await import("../src/lib/recipeModel");
  await other.importItems(planImport(data, await other.existingKeys()), []);
  assert.equal(await other.importFeedback(data.mealFeedback!), 2);
  assert.equal(await other.importFeedback(data.mealFeedback!), 0, "importing again adds nothing");
  const got = await other.listFeedback();
  assert.ok(got.status === "ready" && got.items.find((f) => f.authorName === "Kathy")?.comment === "Better the next day");
});

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
function fakeClient(reply: (c: Call) => { data: unknown; error: { message: string; code?: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {
        select: () => b, insert: (p: unknown) => { call.op = "insert"; call.payload = p; return b; },
        update: (p: unknown) => { call.op = "update"; call.payload = p; return b; },
        upsert: (p: unknown) => { call.op = "upsert"; call.payload = p; return b; },
        eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; }, is: () => b,
        order: () => b, limit: () => b, range: () => b, single: () => b, maybeSingle: () => b,
        then: (res: (r: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(reply(call)).then(res, rej),
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
const ME = "00000000-0000-0000-0000-0000000000a1";
const row = { id: "f1", entry_id: "e1", recipe_id: "r", user_id: ME, author_name: "Lorne", source: "app", rating: "9.0", comment: "", improvement: "", make_again: "yes", photos: [], history: [], version: 1, created_at: "x", updated_at: "x" };

test("shared mode: the app never sends who, when, version or history; edits name their version", async () => {
  const { client, calls } = fakeClient((c) => ({ data: c.op === "update" ? [{ ...row, version: 2 }] : row, error: null }));
  const store = new SharedRecipeStore(client, ME);
  const input = { authorName: "ignored", rating: 9, comment: "", improvement: "", makeAgain: "yes" as const, photos: [] };
  const made = await store.saveFeedback("e1", input, null);
  assert.equal(made.rating, 9); assert.ok(made.mine);
  const ins = calls.find((c) => c.op === "insert")!.payload as Record<string, unknown>;
  for (const owned of ["user_id", "author_name", "version", "history", "created_at", "updated_at", "source"]) assert.ok(!(owned in ins), owned);
  await store.saveFeedback("e1", input, made);
  assert.deepEqual(calls.find((c) => c.op === "update")!.filters, [["id", "f1"], ["version", 1]]);
});

test("shared mode before kitchen.sql v5: feedback and food notes say 'not set up' instead of failing", async () => {
  const { client } = fakeClient(() => ({ data: null, error: { message: "Could not find the table", code: "PGRST205" } }));
  const store = new SharedRecipeStore(client, ME);
  assert.deepEqual(await store.listFeedback(), { status: "not-set-up" });
  assert.deepEqual(await store.listProfiles(), { status: "not-set-up" });
});
