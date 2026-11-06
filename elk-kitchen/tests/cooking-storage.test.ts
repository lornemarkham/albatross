// A saved cooking session comes back complete: on this phone after a reload,
// through a backup file onto another phone (clips and voice notes included),
// and in shared mode inside the batch's `extra` column, within its size cap.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { parseImportFile, planImport } from "../src/lib/recipeModel";
import { MemoryPhotoStore, bundleWithPhotos, importPhotos, photoIdsOf } from "../src/lib/photos";
import { SharedRecipeStore } from "../src/lib/sharedRecipeStore";
import { storeMedia } from "../src/lib/cooking/media";
import { addMedia, finish, hear, newSession } from "../src/lib/cooking/session";
import { batchFromSession, SESSION_MAX_CHARS, sessionSize } from "../src/lib/cooking/summary";
import { blankDetails } from "../src/lib/meat";
import type { RecipeInput } from "../src/types/recipe";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
const T0 = "2026-11-07T15:00:00.000Z";
const at = (m: number) => new Date(Date.parse(T0) + m * 60_000).toISOString();
const noShrink = async (b: Blob) => b;

const sausage: RecipeInput = {
  title: "Garlic pork sausage", authorName: "Lorne", ingredients: "3 kg pork shoulder", instructions: "Grind\nStuff",
  notes: "", tags: [], suggestedTags: [], approxCalories: null, kind: "sausage", category: "Sausage", photos: [],
  details: { ...blankDetails(), meatType: "pork shoulder", meatWeightG: 3000, seasoning: "Salt 1.8%" },
};

async function cooked(store: DeviceRecipeStore, photos: MemoryPhotoStore) {
  const recipe = await store.createRecipe(sausage);
  let s = newSession({ recipe, cookName: "Lorne", now: T0 });
  for (const [m, t] of [[1, "Add 40 grams of salt"], [2, "Change that to 35 grams"], [3, "The casing is a bit dry"]] as const) {
    s = hear(s, t, { recipe, source: "voice", now: at(m) }).session;
  }
  const photo = await storeMedia(photos, new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "photo", { now: at(4), finished: true, shrink: noShrink });
  const clip = await storeMedia(photos, new Blob([new Uint8Array([9, 9])], { type: "video/webm" }), "video", { now: at(5) });
  const voice = await storeMedia(photos, new Blob([new Uint8Array([7])], { type: "audio/webm;codecs=opus" }), "voice", { now: at(6) });
  for (const m of [photo, clip, voice]) s = addMedia(s, m, m.addedAt);
  s = finish(s, at(60));
  const entry = await store.addCookingEntry(recipe.id, { ...batchFromSession(s, recipe), session: s });
  return { recipe, entry, s, photo, clip, voice };
}

test("saved on this phone: the session is part of the batch and survives a reload", async () => {
  const mem = new MemoryStorage();
  const photos = new MemoryPhotoStore();
  const { recipe, entry, s, clip, voice } = await cooked(new DeviceRecipeStore(mem), photos);
  assert.match(clip.id, /\.webm$/);
  assert.match(voice.id, /\.webm$/);
  const back = (await new DeviceRecipeStore(mem).getRecipe(recipe.id))!.entries.find((e) => e.id === entry.id)!;
  assert.deepEqual(back.session, s);
  assert.deepEqual(back.session!.transcript.map((l) => l.text), ["Add 40 grams of salt", "Change that to 35 grams", "The casing is a bit dry"]);
  assert.equal(back.ingredientsUsed, "salt — 35 g (said 40 g, corrected → 35 g)");
  assert.equal(back.photos.length, 1, "session photos become the batch's photos");
});

test("backup → another phone: transcript, photo, clip and voice note all come back", async () => {
  const photos = new MemoryPhotoStore();
  const store = new DeviceRecipeStore(new MemoryStorage());
  const { recipe, entry, s, clip, voice } = await cooked(store, photos);
  const file = JSON.stringify(await bundleWithPhotos(store, photos));
  const data = parseImportFile(file, at(90));
  assert.equal(data.photos.length, 3);

  const store2 = new DeviceRecipeStore(new MemoryStorage());
  const photos2 = new MemoryPhotoStore();
  const items = planImport(data, await store2.existingKeys());
  await store2.importItems(items, []);
  const ids = new Set(photoIdsOf(items));
  assert.ok(ids.has(clip.id) && ids.has(voice.id));
  assert.equal(await importPhotos(photos2, data.photos.filter((p) => ids.has(p.id))), 3);
  const back = (await store2.getRecipe(recipe.id))!.entries.find((e) => e.id === entry.id)!;
  assert.deepEqual(back.session?.transcript, s.transcript);
  assert.deepEqual([...new Uint8Array(await (await photos2.get(clip.id))!.arrayBuffer())], [9, 9]);
});

test("clips over the family bucket's 15 MB limit are refused before storing", async () => {
  const photos = new MemoryPhotoStore();
  const big = new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "video/mp4" });
  await assert.rejects(storeMedia(photos, big, "video"), /up to 15 MB/);
  assert.equal(photos.blobs.size, 0);
});

test("shared mode: the session rides in the batch's extra column and comes back from it", async () => {
  const photos = new MemoryPhotoStore();
  const { s } = await cooked(new DeviceRecipeStore(new MemoryStorage()), photos);
  let inserted: Record<string, unknown> | null = null;
  const client = {
    from() {
      const b: Record<string, unknown> = {
        insert: (p: Record<string, unknown>) => { inserted = p; return b; },
        select: () => b, single: () => b,
        then: (res: (r: unknown) => unknown) => Promise.resolve({
          data: { id: "e1", recipe_id: "r1", cooked_on: "2026-11-07", cook_name: "Lorne", ingredients_used: "", substitutions: "", family_reaction: "", improve_next_time: "", notes: "", rating: null, extra: inserted!.extra, created_by: "me", created_at: at(61) },
          error: null,
        }).then(res),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  const store = new SharedRecipeStore(client, "me");
  const saved = await store.addCookingEntry("r1", { ...batchFromSession(s, null), session: s });
  assert.deepEqual((inserted!.extra as { session: unknown }).session, s);
  assert.deepEqual(saved.session, s);
  assert.ok(JSON.stringify(inserted!.extra).length < 200_000);
});

test("a long cook still fits: ten hours at the smoker, a note every minute", () => {
  let s = newSession({ recipe: null, cookName: "", now: T0 });
  for (let i = 0; i < 600; i++) s = hear(s, `The smoker is holding steady and the colour is getting darker on the top rack, check ${i}`, { recipe: null, source: "voice", now: at(i) }).session;
  assert.ok(sessionSize(s) < SESSION_MAX_CHARS, `${sessionSize(s)} chars`);
  // The summary fields stay inside the table's text limits; the session keeps everything.
  const b = batchFromSession(s, null);
  assert.ok(b.notes.length <= 10000);
  assert.match(b.notes, /shortened — everything is in the cooking journal\)$/);
  assert.equal(s.transcript.length, 600);
});

test("kitchen.sql v4: a batch can carry a long session (up to 1 000 000 characters), not more", async () => {
  const { supabaseLikeDb, runFile, asUser, addMember, inventoryStubs } = await import("./supabase-harness.ts");
  const ME = "00000000-0000-0000-0000-0000000000c1";
  const db = await supabaseLikeDb();
  const as = asUser(db);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ME}', 'me@example.com');`);
  await db.exec(inventoryStubs);
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await addMember(db, ME, "Me");
  await runFile(db, "supabase/kitchen.sql");
  await runFile(db, "supabase/kitchen.sql");
  await as(ME, "INSERT INTO kitchen_recipes (id, title) VALUES ('r1', 'Sausage')");
  const big = (n: number) => JSON.stringify({ session: { transcript: "x".repeat(n) } });
  await as(ME, "INSERT INTO kitchen_cooking_entries (id, recipe_id, extra) VALUES ('e1', 'r1', $1::jsonb)", [big(600_000)]);
  await assert.rejects(as(ME, "INSERT INTO kitchen_cooking_entries (id, recipe_id, extra) VALUES ('e2', 'r1', $1::jsonb)", [big(1_000_001)]), /extra_size/);
});
