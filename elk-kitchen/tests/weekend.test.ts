// The weekend scenario: save a beef jerky recipe, photograph the process,
// record batches, and get everything back later — on this device, through a
// backup file, and in the shared database (PGlite).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { DeviceRecipeStore, DEVICE_KEY } from "../src/lib/recipeStorage";
import { parseImportFile, planImport } from "../src/lib/recipeModel";
import { blankDetails, safetyChecks, safetyGuidance, seasoningLines, yieldPercent } from "../src/lib/meat";
import { MemoryPhotoStore, addPhoto, bundleWithPhotos, importPhotos, photoIdsOf } from "../src/lib/photos";
import { toRecipe } from "../src/lib/sharedRecipeStore";
import type { CookingEntryInput, RecipeInput } from "../src/types/recipe";
import { ENTRY_EXTRA } from "./defaults.ts";
import { supabaseLikeDb, runFile, asUser, addMember, inventoryStubs } from "./supabase-harness";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 7, 9, 0, tick++)).toISOString();
const png = (n: number) => new Blob([new Uint8Array([137, 80, 78, 71, n])], { type: "image/png" });
const noShrink = async (b: Blob) => b;

const jerky = (photos: RecipeInput["photos"] = []): RecipeInput => ({
  title: "Beef Jerky", authorName: "Lorne", ingredients: "1 kg eye of round\nSoy sauce", instructions: "Slice 5 mm, marinate overnight, dry.",
  notes: "", tags: ["jerky", "beef"], suggestedTags: [], approxCalories: null, kind: "jerky", category: "Jerky", photos,
  details: { ...blankDetails(), meatType: "beef eye of round", meatWeightG: 1000, fatPercent: 5, seasoning: "Salt 2%\nBlack pepper 0.5%", marinade: "Soy, Worcestershire, overnight in fridge", cookTempC: 70 },
});
const batch = (over: Partial<CookingEntryInput> = {}): CookingEntryInput => ({
  cookedOn: "2026-11-08", cookName: "Lorne", ingredientsUsed: "1 kg eye of round", substitutions: "Tamari for soy", familyReaction: "", improveNextTime: "Less salt",
  notes: "", rating: 8, ...ENTRY_EXTRA, equipment: "Dehydrator, probe", timesAndTemps: "70°C for 5 h", yieldNote: "40 strips", tastingNotes: "Chewy, a bit salty",
  details: { ...blankDetails(), meatType: "beef", meatWeightG: 1000, internalTempC: 74, finishedWeightG: 380, cookTempC: 70 }, ...over,
});

test("jerky recipe with photos survives closing the app and reopening it", async () => {
  const s = new MemoryStorage();
  const photos = new MemoryPhotoStore();
  const ref = await addPhoto(photos, png(1), clock(), noShrink);
  const r = await new DeviceRecipeStore(s, clock).createRecipe(jerky([ref]));

  const reopened = new DeviceRecipeStore(s, clock); // fresh object, same storage
  const got = (await reopened.getRecipe(r.id))!.recipe;
  assert.equal(got.kind, "jerky");
  assert.equal(got.details.meatWeightG, 1000);
  assert.deepEqual(got.photos.map((p) => p.id), [ref.id]);
  assert.ok(await photos.has(ref.id), "the picture itself is stored");
});

test("batches never change the recipe; several batches per recipe", async () => {
  const s = new MemoryStorage();
  const store = new DeviceRecipeStore(s, clock);
  const r = await store.createRecipe(jerky());
  const before = JSON.stringify((await store.getRecipe(r.id))!.recipe);
  await store.addCookingEntry(r.id, batch());
  await store.addCookingEntry(r.id, batch({ cookedOn: "2026-11-09", substitutions: "Brown sugar instead of honey", rating: 9 }));
  const d = (await store.getRecipe(r.id))!;
  assert.equal(JSON.stringify(d.recipe), before, "recipe untouched, same version");
  assert.equal(d.entries.length, 2);
  assert.equal(d.entries[0].cookedOn, "2026-11-09", "newest first");
  assert.equal(d.entries[1].details.finishedWeightG, 380);
  assert.equal(d.entries[1].equipment, "Dehydrator, probe");
  assert.equal(d.entries[1].tastingNotes, "Chewy, a bit salty");
  assert.equal(d.entries[1].substitutions, "Tamari for soy");
});

test("records saved before this release load with empty photos and details, not lost", async () => {
  const s = new MemoryStorage();
  const old = { recipes: [{ id: "old", title: "Old soup", authorName: "", ingredients: "x", instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null, version: 3, createdAt: "a", updatedAt: "b" }],
    entries: [{ id: "e", recipeId: "old", cookedOn: "2026-01-01", cookName: "", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "n", rating: 7, createdAt: "a", mine: true }], favouriteRecipeIds: [] };
  s.setItem(DEVICE_KEY, JSON.stringify(old));
  const d = (await new DeviceRecipeStore(s, clock).getRecipe("old"))!;
  assert.equal(d.recipe.version, 3);
  assert.equal(d.recipe.kind, "general");
  assert.deepEqual(d.recipe.photos, []);
  assert.equal(d.entries[0].notes, "n");
  assert.deepEqual(d.entries[0].photos, []);
});

test("backup file carries the photos; restoring into a fresh phone brings back everything and overwrites nothing", async () => {
  const s = new MemoryStorage();
  const photos = new MemoryPhotoStore();
  const store = new DeviceRecipeStore(s, clock);
  const p1 = await addPhoto(photos, png(1), clock(), noShrink);
  const p2 = await addPhoto(photos, png(2), clock(), noShrink);
  const r = await store.createRecipe(jerky([p1]));
  await store.addCookingEntry(r.id, batch({ photos: [p2] }));

  const file = JSON.stringify(await bundleWithPhotos(store, photos));
  const data = parseImportFile(file, clock());
  assert.equal(data.photos.length, 2);

  const s2 = new MemoryStorage();
  const photos2 = new MemoryPhotoStore();
  const store2 = new DeviceRecipeStore(s2, clock);
  const items = planImport(data, await store2.existingKeys());
  const res = await store2.importItems(items, data.favouriteRecipeIds);
  assert.equal(res.recipesAdded, 1);
  assert.equal(await importPhotos(photos2, data.photos.filter((p) => new Set(photoIdsOf(items)).has(p.id))), 2);
  const back = (await store2.getRecipe(r.id))!;
  assert.equal(back.recipe.details.meatWeightG, 1000);
  assert.equal(back.entries.length, 1);
  const bytes = new Uint8Array(await (await photos2.get(p2.id))!.arrayBuffer());
  assert.deepEqual([...bytes], [137, 80, 78, 71, 2]);
  // importing again adds nothing, photos included
  assert.equal(await importPhotos(photos2, data.photos), 0);
});

test("a missing photo is reported in the backup, never silently dropped", async () => {
  const store = new DeviceRecipeStore(new MemoryStorage(), clock);
  await store.createRecipe(jerky([{ id: "ghost", caption: "", addedAt: "" }]));
  const b = await bundleWithPhotos(store, new MemoryPhotoStore());
  assert.deepEqual(b.missingPhotoIds, ["ghost"]);
});

test("a photo isn't reported saved unless it reads back", async () => {
  const liar = new MemoryPhotoStore();
  liar.has = async () => false;
  await assert.rejects(addPhoto(liar, png(1), clock(), noShrink), /didn't save/);
});

test("seasoning ratios become grams; yield is computed", () => {
  const l = seasoningLines("Salt 2%\nBlack pepper: 0.5 %\nSugar", 1000);
  assert.deepEqual(l.map((x) => [x.name, x.percent, x.grams]), [["Salt", 2, 20], ["Black pepper", 0.5, 5], ["Sugar", null, null]]);
  assert.equal(yieldPercent({ meatWeightG: 1000, finishedWeightG: 380 }), 38);
  assert.equal(yieldPercent({ meatWeightG: null, finishedWeightG: 380 }), null);
});

test("food safety: USDA minimums flag unsafe batches and stay quiet on good ones", () => {
  const d = { ...blankDetails(), meatType: "beef", cookTempC: 70, internalTempC: 74 };
  assert.deepEqual(safetyChecks("jerky", d), []);
  assert.match(safetyChecks("jerky", { ...d, internalTempC: 60 })[0].text, /below the 71 °C \(160 °F\)/);
  assert.match(safetyChecks("sausage", { ...d, meatType: "chicken", internalTempC: 72 })[0].text, /74 °C \(165 °F\) USDA minimum for poultry/);
  assert.match(safetyChecks("jerky", { ...d, internalTempC: null })[0].text, /No internal temperature recorded/);
  assert.match(safetyChecks("jerky", { ...d, cookTempC: 45 }).map((n) => n.text).join(" "), /below 54 °C/);
  assert.deepEqual(safetyChecks("general", { ...d, internalTempC: 10 }), []);
  assert.ok(safetyGuidance("jerky").some((n) => /160 °F/.test(n.text)));
  assert.equal(safetyGuidance("general").length, 0);
});

// ── Shared database ──────────────────────────────────────────────────────────
const LORNE = "00000000-0000-0000-0000-0000000000a1";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";
let db: PGlite;
let as: ReturnType<typeof asUser>;
before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${LORNE}', 'l@example.com'), ('${STRANGER}', 's@example.com');`);
  await db.exec(inventoryStubs);
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await addMember(db, LORNE, "Lorne");
});

test("kitchen.sql v3 is additive and re-runnable; photos/details persist and every edit keeps the old version", async () => {
  await runFile(db, "supabase/kitchen.sql");
  await runFile(db, "supabase/kitchen.sql"); // safe to re-run
  const extra = JSON.stringify({ kind: "jerky", category: "Jerky", photos: [{ id: "p1", caption: "sliced", addedAt: "t" }], details: { ...blankDetails(), meatWeightG: 1000 } });
  await as(LORNE, `INSERT INTO kitchen_recipes (id, title, extra) VALUES ('j1', 'Beef Jerky', '${extra}')`);
  await as(LORNE, `UPDATE kitchen_recipes SET notes = 'v2' WHERE id = 'j1'`);
  const row = (await db.query<{ extra: unknown; version: number }>("SELECT extra, version FROM kitchen_recipes WHERE id = 'j1'")).rows[0];
  assert.equal(row.version, 2);
  const recipe = toRecipe({ ...(row as object), id: "j1", title: "Beef Jerky", author_name: "", ingredients: "", instructions: "", notes: "v2", tags: [], suggested_tags: [],
    approx_calories: null, legacy: null, created_at: "", updated_at: "", removed_at: null } as unknown as Parameters<typeof toRecipe>[0]);
  assert.equal(recipe.kind, "jerky");
  assert.equal(recipe.photos[0].id, "p1");
  assert.equal(recipe.details.meatWeightG, 1000);
  const rev = (await db.query<{ snapshot: { extra: { kind: string } } }>("SELECT snapshot FROM kitchen_recipe_revisions WHERE recipe_id = 'j1'")).rows;
  assert.equal(rev[0].snapshot.extra.kind, "jerky", "the previous version, photos and all, is kept");
  await as(LORNE, `INSERT INTO kitchen_cooking_entries (id, recipe_id, extra) VALUES ('b1', 'j1', '{"yieldNote":"40 strips"}')`);
  assert.equal((await db.query<{ extra: { yieldNote: string } }>("SELECT extra FROM kitchen_cooking_entries WHERE id='b1'")).rows[0].extra.yieldNote, "40 strips");
  assert.equal((await as(STRANGER, "SELECT id FROM kitchen_recipes")).length, 0, "a stranger sees nothing");
});

test("kitchen-photos.sql: private bucket, family-only read and add, no delete", async () => {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]);
    CREATE TABLE IF NOT EXISTS storage.objects (id SERIAL PRIMARY KEY, bucket_id TEXT, name TEXT);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`);
  await runFile(db, "supabase/kitchen-photos.sql");
  await runFile(db, "supabase/kitchen-photos.sql");
  const b = (await db.query<{ public: boolean }>("SELECT public FROM storage.buckets WHERE id='kitchen-photos'")).rows;
  assert.deepEqual(b, [{ public: false }]);
  const types = (await db.query<{ allowed_mime_types: string[] }>("SELECT allowed_mime_types FROM storage.buckets WHERE id='kitchen-photos'")).rows[0].allowed_mime_types;
  for (const t of ["image/jpeg", "video/mp4", "video/webm", "video/quicktime", "audio/webm", "audio/mp4"]) assert.ok(types.includes(t), t);
  assert.equal(new Set(types).size, types.length, "re-running adds no duplicates");
  const pols = (await db.query<{ cmd: string; qual: string; with_check: string }>("SELECT cmd, qual, with_check FROM pg_policies WHERE tablename='objects' AND policyname LIKE '%kitchen photos'")).rows;
  assert.deepEqual(pols.map((p) => p.cmd).sort(), ["INSERT", "SELECT"]);
  for (const p of pols) assert.match(`${p.qual} ${p.with_check}`, /elk_is_family_member/);
  assert.ok(readFileSync("supabase/kitchen-photos.sql", "utf8").indexOf("FOR DELETE") < 0);
});
