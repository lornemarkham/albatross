// Finishing Sausage Day (M635): closing an interrupted day without losing it,
// honest ingredients, tasting cards, family ratings, learning, versions.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { PlanStore } from "../src/lib/sausage/preferences";
import { SessionDrafts } from "../src/lib/cooking/drafts";
import { newSession } from "../src/lib/cooking/session";
import { SEED_PLAN_ID, ensureSausageDay } from "../src/lib/sausage/today";
import { dayOf, addDayPhoto, hearDay, applyRecommendation, setUsable, approveDay } from "../src/lib/sausage/day";
import { SEED_PREFS } from "../src/lib/sausage/today";
import { correctIngredients, madeOf, reconcile } from "../src/lib/sausage/finish";
import { ensureEntry, finishSausageDay, mirrorToFeedback } from "../src/lib/sausage/record";
import { TastingStore, dayStage, familyView, sausageState } from "../src/lib/sausage/tasting";
import { learningFor } from "../src/lib/sausage/learning";
import { VersionStore, makeNewVersion } from "../src/lib/sausage/versions";
import type { Recipe } from "../src/types/recipe";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const T0 = "2026-11-07T19:00:00.000Z";
const T1 = "2026-11-08T20:00:00.000Z";
const PICKS = [{ title: "Potato Sausage" }, { title: "Breakfast Sausage" }, { title: "Bratwurst" }];

async function setup() {
  const storage = new Mem();
  const store = new DeviceRecipeStore(storage, () => T0);
  const plans = new PlanStore(storage);
  const drafts = new SessionDrafts(storage);
  const plan0 = await ensureSausageDay(store, plans, T0, "Lorne");
  return { storage, store, plans, drafts, plan0 };
}

test("completing an interrupted day: three made, nothing tasted, history kept", async () => {
  const { store, plans, drafts, plan0 } = await setup();
  // An interrupted session is still open, with a note and a photo in the day.
  const open = newSession({ recipe: null, title: "Breakfast Sausage", cookName: "Lorne", now: T0 });
  drafts.put(open);
  let busy = addDayPhoto(plan0, { id: "ph1", caption: "grinding", addedAt: T0, phase: "during", recipeId: null });
  busy = { ...busy, sessions: { x: open.id } };
  plans.put(busy);
  const logBefore = dayOf(busy).log.length;

  const done = await finishSausageDay(store, plans, drafts, busy, PICKS, T1, "Lorne");
  const c = dayOf(done).completion!;
  assert.deepEqual(c.made.map((m) => m.title), ["Potato Sausage", "Breakfast Sausage", "Bratwurst"]);
  assert.ok(c.made.every((m) => m.status === "made-awaiting-tasting"));
  assert.equal(dayOf(done).finishedAt, T1);
  // History preserved (log only grows), photo kept, session closed not deleted.
  assert.ok(dayOf(done).log.length > logBefore);
  assert.deepEqual(dayOf(done).log.slice(0, logBefore), dayOf(busy).log);
  assert.equal(dayOf(done).photos[0].id, "ph1");
  const s = drafts.get(open.id)!;
  assert.ok(s.endedAt);
  assert.equal(s.events[0].kind, "started");
  assert.deepEqual(c.closedSessionIds, [open.id]);
  // Not tasted, not rated.
  assert.equal(dayStage(done, []), "completed");
  assert.equal((await store.listFeedback()).status === "ready" && (await store.listFeedback() as { items: unknown[] }).items.length, 0);
  // Smokies and Dinner Sausage stay in the library and are listed as not made.
  const titles = (await store.listRecipes()).map((r) => r.title);
  assert.ok(titles.includes("Smokies") && titles.includes("Dinner Sausage"));
  assert.equal(c.notMade.length, 2);
  assert.deepEqual(c.notMade.map((n) => n.title).sort(), ["Dinner Sausage", "Smokies"]);
  // Running it again changes nothing.
  assert.equal(await finishSausageDay(store, plans, drafts, done, PICKS, T1, "Lorne"), done);
  // Each made sausage is in cooking history exactly once.
  const all = await store.listRecipes();
  for (const m of c.made) assert.equal((await store.getRecipe(m.recipeId))!.entries.length, 1, m.title);
  assert.equal(all.filter((r) => r.title === "Potato Sausage").length, 1);
});

test("uncertain ingredients are labelled, never invented, and the original is kept", async () => {
  const { store, plans, drafts, plan0 } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  const made = madeOf(done);
  const potato = made.find((m) => m.title === "Potato Sausage")!;
  // No card, nothing recorded: one honest "unknown" line, no quantity.
  assert.equal(potato.ingredients.length, 1);
  assert.equal(potato.ingredients[0].certainty, "unknown");
  assert.equal(potato.ingredients[0].amount, "");
  const brat = made.find((m) => m.title === "Bratwurst")!;
  assert.ok(brat.ingredients.every((l) => l.certainty === "card" || l.certainty === "unknown"));
  assert.ok(brat.ingredients.find((l) => l.name === "Salt")!.amount === "35 g");
  // Purchased meat is not assigned to the sausages.
  assert.ok(!made.flatMap((m) => m.ingredients).some((l) => /butt|eye of round|thighs/i.test(l.name)));

  // The cook fills in what they remember; the reconstruction and the change are both kept.
  const fixed = correctIngredients(done, potato.recipeId, [{ id: "a", name: "Potato", amount: "about 1 kg", certainty: "estimate", source: "cook's memory" }], "Lorne", T1);
  const p2 = madeOf(fixed).find((m) => m.title === "Potato Sausage")!;
  assert.equal(p2.ingredients[0].amount, "about 1 kg");
  assert.equal(p2.original[0].certainty, "unknown");
  assert.equal(p2.corrections.length, 1);
  assert.equal(p2.corrections[0].before[0].certainty, "unknown");
  // The recipe in the library was not touched.
  assert.equal((await store.getRecipe(potato.recipeId))!.recipe.version, 1);
});

test("when a plan divided weighed meat, those figures are 'planned', not 'used'", async () => {
  const { store, plan0 } = await setup();
  const recipes = (await store.listRecipes()).filter((r) => plan0.recipeIds.includes(r.id)) as Recipe[];
  let p = setUsable(plan0, ["p-butt-1", "p-butt-2", "p-chicken", "p-beef"], 2000);
  p = applyRecommendation(p, recipes);
  p = approveDay(p, recipes, SEED_PREFS, "Lorne", T0);
  const brat = recipes.find((r) => r.title === "Bratwurst")!;
  const lines = reconcile(p, brat, 3);
  const meat = lines.filter((l) => l.certainty === "planned" && /pork|beef|chicken/i.test(l.name));
  assert.ok(meat.length > 0);
  assert.ok(meat.every((l) => /not confirmed|more recipes|plan/i.test(l.source)));
  assert.ok(lines.every((l) => l.certainty !== "known"));
});

test("tasting cards: partial save, return later, edit, history, validation", async () => {
  const { store, plans, drafts, plan0, storage } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  const m = madeOf(done)[1];
  const ts = new TastingStore(storage, () => T1);
  assert.equal(sausageState(m, done.id, ts.list()), "awaiting");
  const partial = ts.save(done.id, m.recipeId, { author: "Lorne", scores: { overall: 8, seasoning: null, texture: null, juiciness: null }, makeAgain: null, change: "", notes: "good", photos: [] }, null);
  assert.equal(partial.status, "partial");
  assert.equal(sausageState(m, done.id, ts.list()), "partial");
  assert.equal(dayStage(done, ts.list()), "tasting");
  // Later: finish it.
  const full = ts.save(done.id, m.recipeId, { author: "Lorne", scores: { overall: 8, seasoning: 7, texture: 9, juiciness: 6 }, makeAgain: "yes", change: "less salt", notes: "good", photos: [] }, partial);
  assert.equal(full.status, "complete");
  assert.equal(full.version, 2);
  assert.equal(full.history.length, 1);
  assert.equal(full.history[0].scores.seasoning, null);
  // Edit again; a stale copy is refused.
  const edited = ts.save(done.id, m.recipeId, { ...full, scores: { ...full.scores, overall: 9 } }, full);
  assert.equal(edited.scores.overall, 9);
  assert.equal(ts.forSausage(done.id, m.recipeId).length, 1);
  assert.throws(() => ts.save(done.id, m.recipeId, { ...full }, full), /changed first/);
  // Out-of-range scores are dropped, not stored.
  const odd = ts.save(done.id, m.recipeId, { author: "Sam", scores: { overall: 11, seasoning: 0, texture: 5.5, juiciness: 10 }, makeAgain: null, change: "", notes: "", photos: [] }, null);
  assert.deepEqual(odd.scores, { overall: null, seasoning: null, texture: null, juiciness: 10 });
  assert.throws(() => ts.save(done.id, m.recipeId, { author: "lorne", scores: edited.scores, makeAgain: null, change: "", notes: "", photos: [] }, null), /already has a card/);
  assert.throws(() => ts.save(done.id, m.recipeId, { author: " ", scores: edited.scores, makeAgain: null, change: "", notes: "", photos: [] }, null), /who/);
  // Only that sausage is rated; the others are still awaiting.
  assert.equal(sausageState(madeOf(done)[0], done.id, ts.list()), "awaiting");
  assert.equal(dayStage(done, ts.list()), "tasting");
});

test("family ratings are independent, averaged over who rated, and never invented", async () => {
  const a = { id: "1", planId: "p", recipeId: "r", author: "Lorne", scores: { overall: 8, seasoning: 7, texture: null, juiciness: null }, makeAgain: "yes" as const, change: "", notes: "", photos: [], status: "partial" as const, version: 1, history: [], createdAt: "", updatedAt: "" };
  const b = { ...a, id: "2", author: "Sam", scores: { overall: 5, seasoning: null, texture: null, juiciness: null } };
  const v = familyView([a, b], [{ name: "Jo", rating: 9, makeAgain: null }, { name: "lorne", rating: 2, makeAgain: null }, { name: "Kid", rating: null, makeAgain: null }]);
  assert.deepEqual(v.people.map((p) => p.name), ["Lorne", "Sam", "Jo"]);
  assert.equal(v.average.overall, 7.3);
  assert.equal(v.average.seasoning, 7);
  assert.equal(v.average.texture, null);
  assert.equal(v.raters, 3);
  assert.equal(familyView([]).average.overall, null);
});

test("overall rating flows to existing dinner feedback so ratings, history and the family view still work", async () => {
  const { store, plans, drafts, plan0 } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  const m = madeOf(done)[2];
  const { entryId } = await ensureEntry(store, plans, done, m.recipeId, "Lorne");
  assert.equal(entryId, m.entryId);
  const ts = new TastingStore(new Mem(), () => T1);
  const t1 = ts.save(done.id, m.recipeId, { author: "Lorne", scores: { overall: 8, seasoning: null, texture: null, juiciness: null }, makeAgain: "yes", change: "more nutmeg", notes: "great", photos: [] }, null);
  await mirrorToFeedback(store, entryId, t1);
  // Editing the card changes the same feedback; it doesn't add a second one.
  const t2 = ts.save(done.id, m.recipeId, { ...t1, scores: { ...t1.scores, overall: 9 } }, t1);
  await mirrorToFeedback(store, entryId, t2);
  const fb = await store.listFeedback();
  assert.ok(fb.status === "ready" && fb.items.length === 1);
  assert.equal(fb.status === "ready" && fb.items[0].rating, 9);
  assert.equal(fb.status === "ready" && fb.items[0].improvement, "more nutmeg");
  assert.equal(fb.status === "ready" && fb.items[0].history.length, 1);
  // No overall rating yet: nothing is sent.
  const t3 = ts.save(done.id, m.recipeId, { author: "Sam", scores: { overall: null, seasoning: 5, texture: null, juiciness: null }, makeAgain: null, change: "", notes: "", photos: [] }, null);
  await mirrorToFeedback(store, entryId, t3);
  assert.equal((await store.listFeedback() as { items: unknown[] }).items.length, 1);
});

test("recipe learning: previous ratings, ingredients, improvements, family feedback, photos", async () => {
  const { store, plans, drafts, plan0, storage } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  const m = madeOf(done).find((x) => x.title === "Bratwurst")!;
  const ts = new TastingStore(storage, () => T1);
  ts.save(done.id, m.recipeId, { author: "Lorne", scores: { overall: 8, seasoning: 5, texture: 9, juiciness: 7 }, makeAgain: "yes", change: "a little less salt", notes: "snappy", photos: [{ id: "tp", caption: "plated", addedAt: T1 }] }, null);
  await store.saveFeedback(m.entryId!, { authorName: "Sam", rating: 6, comment: "bit salty", improvement: "", makeAgain: "maybe", photos: [] }, null);
  const detail = (await store.getRecipe(m.recipeId))!;
  const fb = await store.listFeedback();
  const l = learningFor(detail.recipe, ts.list(), fb.status === "ready" ? fb.items : [], detail.entries, [done]);
  assert.equal(l.family.average.overall, 7);
  assert.deepEqual(l.family.people.map((p) => p.name), ["Lorne", "Sam"]);
  assert.equal(l.madeBefore.length, 1);
  assert.ok(l.madeBefore[0].ingredients.some((i) => i.name === "Salt"));
  assert.deepEqual(l.improvements.map((i) => i.text), ["a little less salt"]);
  assert.ok(l.comments.some((c) => c.name === "Sam" && /salty/.test(c.text)));
  assert.ok(l.nudges.some((n) => /Seasoning/.test(n)));
  assert.ok(l.photos.some((p) => p.id === "tp"));
});

test("a material change makes a new version; the original is never overwritten", async () => {
  const { store, plans, drafts, plan0, storage } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  const brat = (await store.getRecipe(madeOf(done).find((x) => x.title === "Bratwurst")!.recipeId))!.recipe;
  const versions = new VersionStore(storage);
  const v2 = await makeNewVersion(store, versions, brat, { details: { ...brat.details, seasoning: brat.details.seasoning.replace("Salt: 35 g", "Salt: 32 g") } }, "Too salty", "Lorne", T1);
  const v3 = await makeNewVersion(store, versions, v2, {}, "Again", "Lorne", T1);
  assert.equal(v2.title, "Bratwurst v2");
  assert.equal(v3.title, "Bratwurst v3");
  const orig = (await store.getRecipe(brat.id))!.recipe;
  assert.equal(orig.title, "Bratwurst");
  assert.equal(orig.version, brat.version);
  assert.match(orig.details.seasoning, /Salt: 35 g/);
  assert.match(v2.details.seasoning, /Salt: 32 g/);
  assert.match(v2.notes, /made from "Bratwurst"/);
  assert.deepEqual(versions.chain(v2.id), [brat.id, v2.id, v3.id]);
  assert.deepEqual(versions.chain(brat.id), [brat.id, v2.id, v3.id]);
  assert.equal(versions.parentOf(v2.id)!.reason, "Too salty");
});

test("existing Kitchen features keep working after the day is finished", async () => {
  const { store, plans, drafts, plan0 } = await setup();
  const done = await finishSausageDay(store, plans, drafts, plan0, PICKS, T1, "Lorne");
  // The live conversation still works on the stored plan (nothing is lost), the library lists every recipe, favourites and backups work.
  const recipes = (await store.listRecipes()) as Recipe[];
  const heard = hearDay(done, "what is the plan", { recipes: recipes.filter((r) => done.recipeIds.includes(r.id)), now: T1, by: "Lorne", prefs: SEED_PREFS });
  assert.ok(heard.reply.length > 0);
  await store.setFavourite(madeOf(done)[0].recipeId, true);
  const bundle = await store.exportAll();
  assert.ok(bundle.recipes.length >= 5);
  assert.equal(plans.get(SEED_PLAN_ID)!.day!.completion!.made.length, 3);
  // Plans saved before this release (no completion) still load.
  const old = JSON.parse(JSON.stringify(plan0));
  delete old.day.completion;
  assert.equal(dayOf(old).completion, undefined);
});
