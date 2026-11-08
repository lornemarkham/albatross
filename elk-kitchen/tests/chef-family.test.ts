// The chef loop end to end, through the app's own code, as two family members
// and a stranger, against the real SQL: ELK Inventory's Pantry (verbatim
// fixture, pantry-family-kitchen @ 8bf1753) and kitchen.sql v6.
//
//   Lorne asks the game-day question → Kitchen reads Inventory (fridge / freezer /
//   pantry, opened, past-date) → Kathy confirms adding the nacho chips she found to
//   Inventory → the missing items go on Pantry's shopping list (stock unchanged) →
//   Lorne cooks the idea, saves it as a recipe, confirms the sour cream he used
//   (Inventory's stock goes down once, retry-safe) → both rate it on their own,
//   with flavour / seasoning / texture / juiciness → Kitchen learns from it → a
//   stranger sees and changes nothing.
process.env.TZ = "UTC";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { supabaseAs } from "./supabase-client";
import { SharedRecipeStore } from "../src/lib/sharedRecipeStore";
import { addToShoppingList, loadPantry } from "../src/lib/pantry";
import { loadOpenShopping } from "../src/lib/companion/shopping";
import { loadStock, receiveFinished, useStock } from "../src/lib/pantryStock";
import { cookingHistory } from "../src/lib/cooking/history";
import { newSession } from "../src/lib/cooking/session";
import { recipeFromSession } from "../src/lib/cooking/summary";
import { chef } from "../src/lib/chef/chef";
import { recentlyMade } from "../src/lib/chef/knowledge";
import { familyTaste } from "../src/lib/chef/familyTaste";
import { RECIPE_EXTRA, ENTRY_EXTRA } from "./defaults.ts";
import type { CookDraft } from "../src/types/cooking";
import type { PantryItem } from "../src/lib/pantry";

const LORNE = "00000000-0000-0000-0000-0000000000a1";
const KATHY = "00000000-0000-0000-0000-0000000000a2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";
const TODAY = "2026-11-08";
const GAME_DAY = "I made bratwurst yesterday. I also have nacho chips and cheese. What can I make for game day?";
let db: PGlite;
const as = () => asUser(db);
const noScores = { flavour: null, seasoning: null, texture: null, juiciness: null };

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "tests/fixtures/inventory-main-supabase-schema.sql");
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await runFile(db, "tests/fixtures/inventory-next-supabase-pantry.sql");
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${LORNE}', 'l@example.com'), ('${KATHY}', 'k@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes) VALUES
      ('sc', 'Sour cream', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"tubs"}'),
      ('jal', 'Jalapeños', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Pantry shelf', 0, '{"unit":"jars","opened":"opened"}'),
      ('sal', 'Salsa', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"jars"}'),
      ('bun', 'Hamburger buns', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Chest freezer', 0, '{"unit":"bags"}');`);
  await addMember(db, LORNE, "Lorne");
  await addMember(db, KATHY, "Kathy");
  await runFile(db, "supabase/kitchen.sql");
  const l = as();
  await l(LORNE, "SELECT pantry_receive('sc', 2, 'Fridge', '2026-11-10', '2026-11-03')");
  await l(LORNE, "SELECT pantry_receive('jal', 1, 'Pantry shelf', NULL, '2026-10-01')");
  await l(LORNE, "SELECT pantry_receive('sal', 1, 'Fridge', '2026-11-01', '2026-10-20')");
  await l(LORNE, "SELECT pantry_receive('bun', 1, 'Chest freezer', '2027-01-15', '2026-10-25')");
});

const stockOf = async (id: string) => Number((await db.query<{ q: number }>("SELECT quantity AS q FROM inventory_items WHERE id = $1", [id])).rows[0].q);

test("P0 + P4 + P5: the game-day loop across two family accounts, against Inventory's real functions", async () => {
  const lorne = new SharedRecipeStore(supabaseAs(db, LORNE), LORNE);
  const kathy = new SharedRecipeStore(supabaseAs(db, KATHY), KATHY);

  // Sausage Day's bratwurst is a family recipe with yesterday's batch (what "Save this batch" writes).
  const brat = await lorne.createRecipe({ title: "Bratwurst", authorName: "Lorne", ingredients: "Pork butt\nSalt\nMace", instructions: "Grind, mix, stuff.", notes: "", tags: [], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA, kind: "sausage" });
  await lorne.addCookingEntry(brat.id, { cookedOn: "2026-11-07", cookName: "Lorne", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA, yieldNote: "30 sausages" });

  // 1–5. Read Inventory: fridge / freezer / pantry, opened, past-date — with Lorne's own token.
  const p = await loadPantry(supabaseAs(db, LORNE));
  assert.equal(p.status, "ready");
  const pantry: PantryItem[] = p.status === "ready" ? p.items : [];
  assert.equal(pantry.find((x) => x.name === "Jalapeños")!.opened, true);
  const recent = recentlyMade(await cookingHistory(lorne, 40), [], pantry, TODAY);
  const recipes = await lorne.listRecipes();
  let a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry, recent, feedback: [], profiles: [], taste: familyTaste({ recipes, feedback: [] }), today: TODAY });
  assert.deepEqual(a.knowledge.byZone.fridge.map((h) => h.name).sort(), ["Salsa", "Sour cream"]);
  assert.deepEqual(a.knowledge.byZone.freezer.map((h) => h.name), ["Hamburger buns"]);
  assert.deepEqual(a.knowledge.byZone.pantry.map((h) => h.name), ["Jalapeños"]);
  assert.deepEqual(a.knowledge.expired.map((h) => h.name), ["Salsa"]);
  assert.equal(a.understood[0].source, "recent");
  assert.match(a.understood[0].how, /^made yesterday — Kitchen's cooking history/);
  assert.equal(a.ideas[0].title, "Loaded bratwurst nachos");
  assert.ok(a.ideas[0].ingredients.some((x) => x.name === "Sour cream" && x.evidence === "Pantry: 2 tubs · Fridge · best before in 2 days"));
  assert.deepEqual(a.offerToInventory.map((m) => m.name), ["bratwurst", "nacho chips", "cheese"]);

  // P1. Kathy found the nacho chips: she confirms adding them to Inventory. A retry (same request id) adds nothing.
  const kStock = await loadStock(supabaseAs(db, KATHY));
  assert.equal(kStock.status, "ready");
  const req = { item: null, newName: "Nacho chips", unit: "bags", quantity: 1, location: "Pantry", bestBefore: null, madeOn: TODAY, requestId: "11111111-1111-4111-8111-111111111111", newItemId: "chips-1" };
  const added = await receiveFinished(supabaseAs(db, KATHY), req);
  assert.ok(added.ok, JSON.stringify(added));
  await receiveFinished(supabaseAs(db, KATHY), req);
  assert.equal(await stockOf("chips-1"), 1, "a retried confirmation doesn't add twice");
  const p2 = await loadPantry(supabaseAs(db, LORNE));
  const pantry2 = p2.status === "ready" ? p2.items : [];
  a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: pantry2, recent, feedback: [], profiles: [], taste: familyTaste({ recipes, feedback: [] }), today: TODAY });
  assert.deepEqual(a.understood.map((u) => [u.name, u.source]), [["Bratwurst", "recent"], ["Nacho chips", "inventory"], ["cheese", "said"]]);
  assert.deepEqual(a.offerToInventory.map((m) => m.name), ["bratwurst", "cheese"], "chips are in Inventory now");

  // 6–7. The nice-to-haves go on Pantry's shopping list, after the person ticks them. Stock doesn't move.
  const before = await stockOf("sal");
  const shop = await addToShoppingList(supabaseAs(db, LORNE), ["salsa", "onion"], a.ideas[0].title);
  assert.deepEqual(shop, { ok: true, added: 2 });
  assert.deepEqual(await addToShoppingList(supabaseAs(db, KATHY), ["Onion"], ""), { ok: true, added: 0 }, "already on the list");
  const open = await loadOpenShopping(supabaseAs(db, KATHY));
  assert.ok(open.status === "ready" && open.names.includes("salsa") && open.names.includes("onion"));
  assert.equal(await stockOf("sal"), before);

  // P5. Lorne cooks the idea: saved as a new, labelled recipe; the batch is recorded.
  const idea = a.ideas[0];
  const draft: CookDraft = { origin: "kitchen-idea", title: idea.title, question: GAME_DAY, ingredients: idea.ingredients.map((i) => ({ name: i.name, amount: i.amount, status: i.status, evidence: i.evidence })), steps: idea.steps, safety: idea.safety, why: idea.why, model: "", createdAt: "2026-11-08T21:00:00.000Z" };
  const s = newSession({ recipe: null, title: idea.title, cookName: "Lorne", now: "2026-11-08T21:00:00.000Z", draft });
  const nachos = await lorne.createRecipe(recipeFromSession(s, ""));
  assert.deepEqual(nachos.tags, ["kitchen-idea"]);
  const entry = await lorne.addCookingEntry(nachos.id, { cookedOn: TODAY, cookName: "Lorne", ingredientsUsed: "Bratwurst, nacho chips, cheese, sour cream", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA, session: { ...s, recipeId: nachos.id } });

  // 8. Confirm what was used: one tub of sour cream, through Inventory's pantry_use, once even if retried.
  const st = await loadStock(supabaseAs(db, LORNE));
  const sour = st.status === "ready" ? st.items.find((x) => x.name === "Sour cream")! : null;
  const use = { item: sour!, lot: null, quantity: 1, requestId: "22222222-2222-4222-8222-222222222222" };
  assert.ok((await useStock(supabaseAs(db, LORNE), use)).ok);
  await useStock(supabaseAs(db, LORNE), use);
  assert.equal(await stockOf("sc"), 1);
  assert.ok(!(await useStock(supabaseAs(db, LORNE), { item: sour!, lot: null, quantity: 5 })).ok, "not enough: Inventory refuses and changes nothing");
  assert.equal(await stockOf("sc"), 1);

  // P3 / P4. Both rate it on their own, with detail scores (kitchen.sql v6). Nobody edits anyone else's.
  const mine = await lorne.saveFeedback(entry.id, { authorName: "", rating: 9, scores: { ...noScores, flavour: 9, juiciness: 8 }, comment: "Brilliant", improvement: "", makeAgain: "yes", photos: [] }, null);
  assert.equal(mine.scoresNotSaved, undefined);
  await kathy.saveFeedback(entry.id, { authorName: "", rating: 6, scores: { ...noScores, seasoning: 4 }, comment: "", improvement: "A little less salt on the brats next time", makeAgain: "maybe", photos: [{ id: "ph-k", caption: "", addedAt: TODAY }] }, null);
  await lorne.saveFeedback(entry.id, { authorName: "", rating: 9, scores: { ...noScores, flavour: 10, juiciness: 8 }, comment: "Brilliant", improvement: "", makeAgain: "yes", photos: [] }, mine);
  for (const store of [lorne, kathy]) {
    const fb = await store.listFeedback();
    const items = fb.status === "ready" ? fb.items.filter((f) => f.entryId === entry.id) : [];
    assert.deepEqual(items.map((f) => [f.authorName, f.rating, f.scores.flavour, f.scores.seasoning]).sort(), [["Kathy", 6, null, 4], ["Lorne", 9, 10, null]]);
    assert.equal(items.find((f) => f.authorName === "Lorne")!.history[0].scores!.flavour, 9, "the earlier scores are kept");
  }
  const kathysRow = ((await lorne.listFeedback()) as { items: Awaited<ReturnType<typeof lorne.saveFeedback>>[] }).items.find((f) => f.authorName === "Kathy")!;
  await assert.rejects(lorne.saveFeedback(entry.id, { authorName: "", rating: 1, scores: noScores, comment: "", improvement: "", makeAgain: null, photos: [] }, kathysRow));
  const raw = await db.query<{ v: string }>("SELECT scores::text AS v FROM kitchen_meal_feedback WHERE author_name = 'Kathy'");
  assert.deepEqual(JSON.parse(raw.rows[0].v), { flavour: null, seasoning: 4, texture: null, juiciness: null });
  await assert.rejects(as()(KATHY, `UPDATE kitchen_meal_feedback SET scores = '{"seasoning": 11}' WHERE author_name = 'Kathy'`), /check/i);

  // Learn: one person's rating is theirs; Kathy's salt note shapes the next game-day idea.
  const fb = await kathy.listFeedback();
  const items = fb.status === "ready" ? fb.items : [];
  const all = await kathy.listRecipes();
  const taste = familyTaste({ recipes: all, feedback: items });
  assert.deepEqual(taste.people.find((x) => x.name === "Kathy")!.leanings.map((l) => [l.about, l.direction]), [["salt", "less"]]);
  assert.deepEqual(taste.favourites, [], "a 9 and a 6 average 7.5, but Kathy's 6 means it isn't a household favourite");
  const next = chef({ text: GAME_DAY, earlier: [], picked: [], recipes: all, pantry: pantry2, recent: recentlyMade(await cookingHistory(kathy, 40), [], pantry2, TODAY), feedback: items, profiles: [], taste, today: TODAY });
  assert.ok(next.ideas.some((i) => i.familyNotes.some((n) => /Kathy on Loaded bratwurst nachos: “A little less salt on the brats next time”/.test(n))), JSON.stringify(next.ideas.map((i) => i.familyNotes)));

  // Backups carry the scores; importing the same feedback again adds nothing.
  const bundle = await kathy.exportAll();
  assert.equal(bundle.mealFeedback!.find((f) => f.authorName === "Kathy")!.scores.seasoning, 4);
  assert.equal(await lorne.importFeedback(bundle.mealFeedback!), 0);
});

test("a signed-in stranger, through the same code, can't read Inventory or add to it, the list, or anyone's ratings", async () => {
  const c = supabaseAs(db, STRANGER);
  const p = await loadPantry(c);
  assert.ok(p.status === "ready" && p.items.length === 0);
  assert.equal((await addToShoppingList(c, ["caviar"], "")).ok, false);
  assert.equal((await receiveFinished(c, { item: null, newName: "Caviar", unit: "tins", quantity: 1, location: "Fridge", bestBefore: null, madeOn: TODAY })).ok, false);
  const stranger = new SharedRecipeStore(c, STRANGER);
  const fb = await stranger.listFeedback();
  assert.ok(fb.status === "ready" && fb.items.length === 0);
});

test("a family database still on kitchen.sql v5: ratings still save; detail scores are flagged as not shared, never silently lost; v6 then upgrades it in place", async () => {
  const db5 = await supabaseLikeDb();
  await db5.exec(`INSERT INTO auth.users (id, email) VALUES ('${LORNE}', 'l@example.com');
    CREATE TABLE public.inventory_items (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE public.purchase_drafts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), raw_text TEXT);`);
  await runFile(db5, "tests/fixtures/elk-family-access.sql");
  await addMember(db5, LORNE, "Lorne");
  await runFile(db5, "tests/fixtures/kitchen-v5.sql");
  const store = new SharedRecipeStore(supabaseAs(db5, LORNE), LORNE);
  const r = await store.createRecipe({ title: "Chili", authorName: "Lorne", ingredients: "", instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA });
  const e = await store.addCookingEntry(r.id, { cookedOn: TODAY, cookName: "Lorne", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA });
  const f = await store.saveFeedback(e.id, { authorName: "", rating: 8, scores: { ...noScores, flavour: 9 }, comment: "Good", improvement: "", makeAgain: "yes", photos: [] }, null);
  assert.equal(f.rating, 8);
  assert.equal(f.scoresNotSaved, true);
  const list = await store.listFeedback();
  assert.ok(list.status === "ready" && list.items[0].rating === 8 && list.items[0].scores.flavour === null);
  // Without detail scores, nothing is flagged.
  const plain = await store.saveFeedback(e.id, { authorName: "", rating: 7, scores: noScores, comment: "Good", improvement: "", makeAgain: "yes", photos: [] }, list.status === "ready" ? list.items[0] : null);
  assert.equal(plain.scoresNotSaved, undefined);
  // Running v6 over it keeps every rating and its history; scores work from then on (a fresh store, as after a reload).
  await runFile(db5, "supabase/kitchen.sql");
  const after = new SharedRecipeStore(supabaseAs(db5, LORNE), LORNE);
  const kept = await after.listFeedback();
  assert.ok(kept.status === "ready" && kept.items.length === 1 && kept.items[0].rating === 7 && kept.items[0].history.length === 1);
  const scored = await after.saveFeedback(e.id, { authorName: "", rating: 7, scores: { ...noScores, flavour: 9 }, comment: "Good", improvement: "", makeAgain: "yes", photos: [] }, kept.status === "ready" ? kept.items[0] : null);
  assert.equal(scored.scores.flavour, 9);
  assert.equal(scored.scoresNotSaved, undefined);
});
