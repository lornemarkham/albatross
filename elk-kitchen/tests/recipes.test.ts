// Recipe persistence, editing, cooking history, import/export, duplicate
// prevention and data preservation — through the device (localStorage) store
// and the pure model, with no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceRecipeStore, DEVICE_KEY, LEGACY_KEY, readDeviceData } from "../src/lib/recipeStorage";
import { legacyEntryId, legacyToRecipe, parseImportFile, planImport } from "../src/lib/recipeModel";
import type { CookingEntryInput, RecipeInput } from "../src/types/recipe";

class MemoryStorage {
  data = new Map<string, string>();
  writes: string[] = [];
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes.push(k); this.data.set(k, v); }
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 10, 12, 0, tick++)).toISOString();

// What the original app stored (its own seed + one family recipe).
const LEGACY = [
  {
    id: "seed-elk-crunch-bowl-v1", title: "ELK Crunch Bowl v1", author: "Lorne", dateCooked: "2026-03-19",
    ingredients: "Romaine\nKimchi", notes: "Fresh, crunchy", changes: "Added purple cabbage",
    improveNextTime: "Try lime", approxCalories: 550, rating: 9, tags: ["asian"], suggestedTags: ["kimchi"],
  },
  {
    id: "3b8c-kathys-chili", title: "Kathy's Chili", author: "Kathy", dateCooked: "2026-03-21",
    ingredients: "Beans\nBeef", notes: "", changes: "", improveNextTime: "", approxCalories: 0, rating: 0, tags: [],
  },
];

const soup: RecipeInput = {
  title: "Cheese Drawer Soup", authorName: "Lorne",
  ingredients: "Leftover cheddar\nParmesan rind\nStock\nPotato\nOnion",
  instructions: "Sweat onion, simmer potato in stock, melt in cheese, blend.",
  notes: "Uses up the cheese drawer.", tags: ["soup", "cheese"], suggestedTags: [], approxCalories: 450,
};
const cook = (over: Partial<CookingEntryInput>): CookingEntryInput => ({
  cookedOn: "2026-10-10", cookName: "Lorne", ingredientsUsed: "", substitutions: "", familyReaction: "",
  improveNextTime: "", notes: "", rating: null, ...over,
});

test("legacy recipes are split into a recipe + its first cooking entry, keeping the id and the original", () => {
  const { recipe, entries } = legacyToRecipe(LEGACY[0], "2026-10-10T00:00:00Z");
  assert.equal(recipe.id, "seed-elk-crunch-bowl-v1");
  assert.equal(recipe.authorName, "Lorne");
  assert.equal(recipe.notes, "Fresh, crunchy");
  assert.equal(recipe.approxCalories, 550);
  assert.deepEqual(recipe.legacy, LEGACY[0]);
  assert.equal(entries.length, 1);
  assert.deepEqual(
    { id: entries[0].id, cookedOn: entries[0].cookedOn, cookName: entries[0].cookName, substitutions: entries[0].substitutions, improveNextTime: entries[0].improveNextTime, rating: entries[0].rating },
    { id: legacyEntryId("seed-elk-crunch-bowl-v1"), cookedOn: "2026-03-19", cookName: "Lorne", substitutions: "Added purple cabbage", improveNextTime: "Try lime", rating: 9 },
  );
  // "0 calories / rating 0" in the old app meant "not filled in".
  const chili = legacyToRecipe(LEGACY[1], "2026-10-10T00:00:00Z");
  assert.equal(chili.recipe.approxCalories, null);
  assert.equal(chili.entries[0].rating, null);
});

test("the old browser data is read but never written over or removed", async () => {
  const s = new MemoryStorage();
  const original = JSON.stringify(LEGACY);
  s.setItem(LEGACY_KEY, original);
  s.writes = [];
  const store = new DeviceRecipeStore(s, clock);

  const list = await store.listRecipes();
  assert.deepEqual(list.map((r) => r.id).sort(), ["3b8c-kathys-chili", "seed-elk-crunch-bowl-v1"]);
  assert.equal(s.writes.length, 0, "just looking writes nothing");

  await store.createRecipe(soup);
  await store.setFavourite("3b8c-kathys-chili", true);
  assert.ok(!s.writes.includes(LEGACY_KEY));
  assert.equal(s.getItem(LEGACY_KEY), original, "legacy key byte-for-byte unchanged");
  assert.equal((await store.listRecipes()).length, 3);
});

test("an empty browser gets the seed recipe, but only once something is saved does anything get written", async () => {
  const s = new MemoryStorage();
  const store = new DeviceRecipeStore(s, clock);
  assert.deepEqual((await store.listRecipes()).map((r) => r.title), ["ELK Crunch Bowl v1"]);
  assert.equal(s.writes.length, 0);
  assert.equal(readDeviceData(s), null, "nothing here to import");
});

test("unreadable device data is left in place and the legacy recipes are still found", async () => {
  const s = new MemoryStorage();
  s.setItem(DEVICE_KEY, "{not json");
  s.setItem(LEGACY_KEY, JSON.stringify(LEGACY));
  assert.equal(readDeviceData(s)?.recipes.length, 2);
  assert.equal(s.getItem(DEVICE_KEY), "{not json");

  // Saving keeps a copy of the unreadable value instead of overwriting it.
  await new DeviceRecipeStore(s, clock).createRecipe(soup);
  const kept = [...s.data].filter(([k]) => k.startsWith(`${DEVICE_KEY}-unreadable-`));
  assert.deepEqual(kept.map(([, v]) => v), ["{not json"]);
  assert.equal(readDeviceData(s)?.recipes.length, 3);
});

test("editing is version-checked: a stale edit changes nothing and reports what's there now", async () => {
  const s = new MemoryStorage();
  const tabA = new DeviceRecipeStore(s, clock);
  const tabB = new DeviceRecipeStore(s, clock);
  const r = await tabA.createRecipe(soup);
  assert.equal(r.version, 1);

  const a = await tabA.updateRecipe(r.id, 1, { ...soup, instructions: "Simmer 20 min" });
  assert.ok(a.ok);
  assert.equal(a.recipe.version, 2);

  const b = await tabB.updateRecipe(r.id, 1, { ...soup, title: "Overwrite!" });
  assert.equal(b.ok, false);
  assert.equal(!b.ok && b.current?.instructions, "Simmer 20 min");
  const now = await tabA.getRecipe(r.id);
  assert.equal(now?.recipe.title, "Cheese Drawer Soup");
  assert.equal(now?.recipe.id, r.id);

  const gone = await tabA.updateRecipe("no-such-id", 1, soup);
  assert.deepEqual(gone, { ok: false, current: null });
});

test("Cheese Drawer Soup on one device: save, cook, favourite, cook again — the recipe stays the plan", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage(), clock);
  const r = await store.createRecipe(soup);
  await store.addCookingEntry(r.id, cook({
    cookedOn: "2026-10-10", ingredientsUsed: "Cheddar, brie end, gouda rind, stock, potato, leek",
    substitutions: "Leek instead of onion; gouda rind for parmesan", familyReaction: "Kids asked for seconds; Kathy wants more pepper",
    improveNextTime: "Less salt — the rinds are salty", rating: 8,
  }));
  await store.setFavourite(r.id, true);
  await store.addCookingEntry(r.id, cook({ cookedOn: "2026-10-24", cookName: "Kathy", substitutions: "Half milk, half stock", improveNextTime: "Add croutons" }));

  const d = await store.getRecipe(r.id);
  assert.ok(d);
  assert.equal(d.favourite, true);
  assert.deepEqual(d.entries.map((e) => [e.cookedOn, e.cookName]), [["2026-10-24", "Kathy"], ["2026-10-10", "Lorne"]]);
  assert.equal(d.recipe.ingredients, soup.ingredients, "planned ingredients untouched by what was used");
  assert.equal(d.recipe.version, 1);
  const [summary] = await store.listRecipes();
  assert.deepEqual([summary.title, summary.timesCooked, summary.lastCookedOn, summary.favourite], ["Cheese Drawer Soup", 2, "2026-10-24", true]);

  await store.removeCookingEntry(d.entries[0].id);
  assert.equal((await store.getRecipe(r.id))?.entries.length, 1);
  await assert.rejects(store.addCookingEntry("missing", cook({})), /isn't on this device/);
});

test("export → import onto another device carries everything; importing again adds nothing", async () => {
  const phoneStorage = new MemoryStorage();
  phoneStorage.setItem(LEGACY_KEY, JSON.stringify(LEGACY));
  const phone = new DeviceRecipeStore(phoneStorage, clock);
  const r = await phone.createRecipe(soup);
  await phone.addCookingEntry(r.id, cook({ familyReaction: "Loved it" }));
  await phone.setFavourite(r.id, true);
  const file = JSON.stringify(await phone.exportAll());

  const exported = JSON.parse(file);
  assert.equal(exported.app, "elk-kitchen");
  assert.deepEqual(exported.legacyBrowserRecipes, LEGACY, "the raw old data rides along in every export");

  const laptopStorage = new MemoryStorage();
  laptopStorage.setItem(DEVICE_KEY, JSON.stringify({ recipes: [], entries: [], favouriteRecipeIds: [] }));
  const laptop = new DeviceRecipeStore(laptopStorage, clock);
  const plan = planImport(parseImportFile(file, clock()), await laptop.existingKeys());
  assert.deepEqual(plan.map((x) => [x.recipe.title, x.status, x.selected]).sort(), [
    ["Cheese Drawer Soup", "new", true], ["ELK Crunch Bowl v1", "new", true], ["Kathy's Chili", "new", true],
  ]);
  assert.deepEqual(await laptop.importItems(plan, exported.favouriteRecipeIds), { recipesAdded: 3, entriesAdded: 3, failed: [] });

  const moved = await laptop.getRecipe(r.id);
  assert.equal(moved?.recipe.title, "Cheese Drawer Soup");
  assert.equal(moved?.entries[0].familyReaction, "Loved it");
  assert.equal(moved?.favourite, true);

  const again = planImport(parseImportFile(file, clock()), await laptop.existingKeys());
  assert.ok(again.every((x) => x.status === "already-here" && !x.selected && x.newEntries.length === 0));
  assert.deepEqual(await laptop.importItems(again, []), { recipesAdded: 0, entriesAdded: 0, failed: [] });
  assert.equal((await laptop.listRecipes()).length, 3);
});

test("duplicate prevention: same id is never overwritten; same title with a new id is held back", async () => {
  const s = new MemoryStorage();
  const store = new DeviceRecipeStore(s, clock);
  const mine = await store.createRecipe(soup);
  await store.updateRecipe(mine.id, 1, { ...soup, notes: "Edited here" });

  const incoming = {
    recipes: [
      { ...mine, notes: "Older copy from a file" },            // same id
      { ...mine, id: "other-id", title: "  cheese drawer SOUP " }, // same title, different id
      { ...mine, id: "dup", title: "Dup" }, { ...mine, id: "dup", title: "Dup again" }, // twice in one file
    ],
    entries: [{ id: "e1", recipeId: mine.id, cookedOn: "2026-01-01", cookName: "", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "from file", rating: null, createdAt: "", mine: true }],
    favouriteRecipeIds: [],
  };
  const plan = planImport(incoming, await store.existingKeys());
  assert.deepEqual(plan.map((x) => [x.recipe.id, x.status, x.selected, x.newEntries.length]), [
    [mine.id, "already-here", true, 1],
    ["other-id", "same-title", false, 0],
    ["dup", "new", true, 0],
  ]);
  assert.equal(plan[1].sameTitleAs, mine.id);

  assert.deepEqual(await store.importItems(plan, []), { recipesAdded: 1, entriesAdded: 1, failed: [] });
  const after = await store.getRecipe(mine.id);
  assert.equal(after?.recipe.notes, "Edited here", "existing recipe not overwritten by the file");
  assert.equal(after?.entries.length, 1, "missing history from the file was added");
  assert.equal(await store.getRecipe("other-id"), null, "the likely copy was not imported");
});

test("import accepts the old app's raw array and rejects anything else clearly", () => {
  const data = parseImportFile(JSON.stringify(LEGACY), "2026-10-10T00:00:00Z");
  assert.equal(data.recipes.length, 2);
  assert.equal(data.entries.length, 2);
  assert.throws(() => parseImportFile("nope", ""), /isn't valid JSON/);
  assert.throws(() => parseImportFile(JSON.stringify({ hello: 1 }), ""), /isn't an ELK Kitchen export/);
  assert.throws(() => parseImportFile(JSON.stringify({ app: "elk-kitchen", format: 9, recipes: [] }), ""), /format 9/);
  // Recipes without an id or title are skipped, not invented.
  assert.equal(parseImportFile(JSON.stringify([{ title: "no id" }, { id: "x" }]), "").recipes.length, 0);
});
