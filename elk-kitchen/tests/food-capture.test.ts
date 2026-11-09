// ELK Kitchen — effortless food capture (M640). The acceptance workflow, end to
// end, against Inventory's real SQL (production's version and the next one):
// photograph two frozen pork bones, add them by describing them, add
// homemade stock, ask Kitchen for soup, match against what Pantry really
// holds, cook it, use the bones up, and check the history keeps the meal.
// Plus partial use, duplicate photos, uncertain amounts, undo, moving food
// and plain-language commands.
process.env.TZ = "UTC";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { supabaseAs } from "./supabase-client";
import { ENTRY_EXTRA } from "./defaults.ts";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { cookingHistory } from "../src/lib/cooking/history";
import { newSession, recordPantry } from "../src/lib/cooking/session";
import { recipeFromSession } from "../src/lib/cooking/summary";
import { chef } from "../src/lib/chef/chef";
import { kitchenIdeas } from "../src/lib/chef/ideas";
import { buildKnowledge, recentlyMade } from "../src/lib/chef/knowledge";
import { familyTaste } from "../src/lib/chef/familyTaste";
import { addToShoppingList, loadPantry } from "../src/lib/pantry";
import { candidates, loadStock, type StockItem, type StockResult } from "../src/lib/pantryStock";
import { newId } from "../src/lib/recipeModel";
import { parseFoodDescription } from "../src/lib/food/describe";
import { FoodStore, fingerprintBytes, netUsed } from "../src/lib/food/notes";
import { addFood, identify, planAdd } from "../src/lib/food/capture";
import { moveFood, returnUnused, undoFood, useFood } from "../src/lib/food/consume";
import { parseCommand, resolveCommand } from "../src/lib/food/commands";
import { foodHistory } from "../src/lib/food/history";
import { checkFoodPhotoReply, askFoodPhoto } from "../src/lib/food/vision";
import { deviceRecordPhotoIds, hasDeviceRecords, mergeDeviceRecords, parseDeviceRecords, readDeviceRecords } from "../src/lib/deviceRecords";
import { handle } from "../api/companion";
import type { CookDraft } from "../src/types/cooking";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const TODAY = "2026-11-08";
const NOW = "2026-11-08T17:00:00.000Z";
const at = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }
const photo = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { ref: { id: newId(), caption: text, addedAt: NOW }, fingerprint: await fingerprintBytes(bytes.buffer as ArrayBuffer) };
};
const act = (r: StockResult) => { assert.ok(r.ok, r.ok ? "" : r.error); return (r as Extract<StockResult, { ok: true }>).action; };
const noTaste = () => familyTaste({ recipes: [], feedback: [] });

// ── The description parser ────────────────────────────────────────────────
test("descriptions become drafts: real household food, descriptive amounts, nothing invented", () => {
  const one = (s: string) => parseFoodDescription(s, TODAY)[0];
  const bones = one("Two frozen pork shoulder bones with meat attached");
  assert.deepEqual([bones.name, bones.count, bones.unit, bones.location, bones.locationFrom, bones.notes], ["Pork shoulder bones", 2, "bones", "Freezer", "frozen", "with meat attached"]);
  const stock = one("I made three containers of chicken stock");
  assert.deepEqual([stock.name, stock.count, stock.unit, stock.kinds, stock.location], ["Homemade chicken stock", 3, "containers", ["homemade"], ""]);
  const peas = one("half a bag of split peas in the pantry");
  assert.deepEqual([peas.count, peas.unit, peas.approximate, peas.location], [1, "half bag", true, "Pantry"]);
  const meat = one("approximately two pounds of stew meat");
  assert.deepEqual([meat.count, meat.unit, meat.approximate, meat.quantityText], [2, "lb", true, "about 2 pounds"]);
  const unknown = one("some leftover chili in the fridge");
  assert.deepEqual([unknown.name, unknown.amountKnown, unknown.count, unknown.unit, unknown.kinds], ["Leftover chili", false, 1, "portion", ["leftover"]]);
  assert.equal(one("a batch of homemade sausages").unit, "batch");
  assert.deepEqual(one("garden tomatoes").kinds, ["garden"]);
  assert.equal(one("it"), undefined, "nothing to add when no food was named");
  const two = parseFoodDescription("two pork bones and three containers of chicken stock in the chest freezer", TODAY);
  assert.deepEqual(two.map((d) => [d.name, d.count, d.location]), [["Pork bones", 2, "Chest freezer"], ["Chicken stock", 3, "Chest freezer"]]);
  assert.equal(one("I made soup yesterday").madeOn, "2026-11-07");
});

// ── Against Inventory's SQL ───────────────────────────────────────────────
for (const [label, pantrySql, hasNext] of [["production Pantry (main)", "tests/fixtures/inventory-main-supabase-pantry.sql", false], ["next Pantry (pantry-family-kitchen)", "tests/fixtures/inventory-next-supabase-pantry.sql", true]] as const) {
  let db: PGlite;
  before(async () => {
    db = await supabaseLikeDb();
    await runFile(db, "tests/fixtures/inventory-main-supabase-schema.sql");
    await runFile(db, "tests/fixtures/elk-family-access.sql");
    await runFile(db, pantrySql);
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'alice@example.com');
      INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
      VALUES ('peas-01', 'Split peas', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Pantry', 0, '{"unit":"bags"}');
    `);
    await addMember(db, ALICE, "Alice");
    await asUser(db)(ALICE, "SELECT pantry_receive('peas-01', 1, 'Pantry', '2027-06-01', '2026-10-01')");
  });
  const client = () => supabaseAs(db, ALICE);
  const stockNow = async (): Promise<StockItem[]> => { const r = await loadStock(client()); assert.equal(r.status, "ready"); return (r as { items: StockItem[] }).items; };
  const find = (items: StockItem[], name: string) => items.find((i) => i.name === name);
  const ids = () => ({ requestId: newId(), newItemId: newId(), newId });

  test(`${label}: photograph, describe, store, ask for soup, cook, use up — the whole workflow`, async () => {
    const store = new FoodStore(new Mem());

    // 1–2. A photo of two frozen pork shoulder bones; the AI only suggests "pork bones" with low confidence.
    const shot = await photo("photo-of-two-pork-bones");
    const suggestion = { name: "Pork bones", confidence: "low" as const };
    const bones = parseFoodDescription("Two frozen pork shoulder bones with meat attached", TODAY)[0];
    const plan0 = planAdd(bones, await stockNow(), store.list(), [shot.fingerprint], NOW);
    assert.equal(plan0.existing, null);
    assert.deepEqual(plan0.duplicates, []);
    assert.ok(plan0.summary.some((l) => /Put in: Freezer \(you said it's frozen\)/.test(l)));
    const added = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: bones, itemId: null, photos: [shot], identification: identify(bones.name, suggestion), now: NOW, addedBy: "Alice" });
    assert.ok(added.ok, !added.ok ? added.error : "");
    const inv = find(await stockNow(), "Pork shoulder bones")!;
    assert.deepEqual([inv.onHand, inv.unit, inv.lots.map((l) => l.location)], [2, "bones", ["Freezer"]]);
    const n = store.get(added.ok ? added.note.id : "")!;
    assert.equal(n.description, "Two frozen pork shoulder bones with meat attached");
    assert.equal(n.nameFrom, "photo-suggested-edited", "the person changed the AI's guess; the record says so");
    assert.deepEqual([n.suggestedName, n.confidence, n.photos.length, n.notes], ["Pork bones", "low", 1, "with meat attached"]);

    // 3. Homemade chicken stock, by voice, with a place picked afterwards.
    const stockDraft = { ...parseFoodDescription("I made three containers of chicken stock", TODAY)[0], location: "Freezer" };
    const s = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: stockDraft, itemId: null, now: at(2) });
    assert.ok(s.ok, !s.ok ? s.error : "");
    assert.equal(find(await stockNow(), "Homemade chicken stock")!.onHand, 3);

    // 4–5. Ask Kitchen for soup: it finds the bones, the stock and the split peas, and says what's missing.
    const pantry = await loadPantry(client());
    assert.equal(pantry.status, "ready");
    const items = (pantry as { items: Parameters<typeof chef>[0]["pantry"] & object }).items;
    const answer = chef({ text: "I want to make soup with those pork bones", earlier: [], picked: [], recipes: [], pantry: items, recent: [], feedback: [], profiles: [], taste: noTaste(), today: TODAY });
    const soup = answer.ideas.find((i) => /split pea soup/i.test(i.title))!;
    assert.ok(soup, `ideas: ${answer.ideas.map((i) => i.title).join(" | ")}`);
    assert.match(soup.title, /pork shoulder bones/i);
    const status = Object.fromEntries(soup.ingredients.map((i) => [i.name, i.status]));
    assert.equal(status["Pork shoulder bones"], "have");
    assert.equal(status["Split peas"], "have");
    assert.equal(status["Homemade chicken stock"], "have");
    assert.match(soup.ingredients.find((i) => i.name === "Pork shoulder bones")!.evidence, /2 bones · Freezer/);
    assert.match(soup.ingredients.find((i) => i.name === "Homemade chicken stock")!.evidence, /3 containers · Freezer/);
    assert.deepEqual(soup.missing, ["onion"], "the only missing thing is one Pantry has no record of");
    // Never invented: every ingredient marked "have" is a real Pantry product.
    for (const i of soup.ingredients.filter((x) => x.status === "have")) assert.ok(items.some((p) => p.name === i.name && p.onHand > 0), i.name);
    assert.ok(soup.safety.some((x) => /frozen: thaw/.test(x)));
    // Stock and bones are never "the meat" in a dish.
    assert.ok(!answer.ideas.some((i) => /nachos|pizza|stuffed|chicken stock/i.test(i.title)));
    if (hasNext) {
      const shop = await addToShoppingList(client(), soup.missing, soup.title);
      assert.deepEqual(shop, { ok: true, added: 1 });
    }

    // 6–7. Choose it and cook it.
    const draft: CookDraft = { origin: "kitchen-idea", title: soup.title, question: "I want to make soup with those pork bones", ingredients: soup.ingredients.map((i) => ({ name: i.name, amount: i.amount, status: i.status, evidence: i.evidence })), steps: soup.steps, safety: soup.safety, why: soup.why, model: "", createdAt: at(10) };
    let session = newSession({ recipe: null, title: soup.title, cookName: "Alice", now: at(10), draft });
    const planned = draft.ingredients.filter((d) => d.status === "have" && d.evidence.startsWith("Pantry"));
    assert.deepEqual(planned.map((d) => d.name).sort(), ["Homemade chicken stock", "Pork shoulder bones", "Split peas"]);

    // 8. After cooking: what was actually used. Both bones: "Use all".
    const why = { label: soup.title, sessionId: session.id };
    const boneUse = await useFood(client(), store, { item: find(await stockNow(), "Pork shoulder bones")!, quantity: "all", why, now: at(200) });
    assert.ok(boneUse.ok, !boneUse.ok ? boneUse.error : "");
    assert.equal(boneUse.ok && boneUse.action.quantity, 2);
    session = recordPantry(session, act(boneUse), at(200));
    // Stock: used 2 of 3 containers, then "we didn't need the second" — return one (undo + use the one that was).
    const stockUse = await useFood(client(), store, { item: find(await stockNow(), "Homemade chicken stock")!, quantity: 2, why, now: at(201) });
    assert.ok(stockUse.ok);
    const back = await returnUnused(client(), store, { action: act(stockUse), returning: 1, why, now: at(202) });
    assert.ok(back.ok, !back.ok ? back.error : "");
    assert.equal(find(await stockNow(), "Homemade chicken stock")!.onHand, 2, "3 − 1 actually used");
    session = recordPantry(session, back.remaining!, at(202));

    // 9. The bones no longer appear as available — in Inventory, in Kitchen's knowledge, in what's-in-my-freezer.
    const after = await stockNow();
    assert.equal(find(after, "Pork shoulder bones")!.onHand, 0);
    const pantry2 = (await loadPantry(client())) as { items: NonNullable<Parameters<typeof chef>[0]["pantry"]> };
    assert.ok(!buildKnowledge({ pantry: pantry2.items, recent: [], said: [], today: TODAY }).have.some((h) => /bone/i.test(h.name)));
    const later = chef({ text: "soup with the pork bones please", earlier: [], picked: [], recipes: [], pantry: pantry2.items, recent: [], feedback: [], profiles: [], taste: noTaste(), today: TODAY });
    assert.ok(!later.ideas.some((i) => /bone/i.test(i.title)), "no soup is offered from bones that are used up");
    const freezer = resolveCommand(parseCommand("What's in my freezer?", TODAY), after, store.list(), TODAY);
    assert.equal(freezer.kind, "answer");
    const lines = freezer.kind === "answer" ? freezer.lines.join("\n") : "";
    assert.match(lines, /Homemade chicken stock — 2 containers · Freezer/);
    assert.ok(!/bone/i.test(lines));
    // …but the history keeps them, with the meal they went into.
    const hist = foodHistory(store.list(), after);
    const gone = hist.usedUp.find((h) => h.itemName === "Pork shoulder bones")!;
    assert.ok(gone, "used-up food stays in the history");
    assert.deepEqual([gone.used, gone.lastFor], [2, soup.title]);
    assert.ok(!hist.inStock.some((h) => h.itemName === "Pork shoulder bones"));
    assert.equal(hist.inStock.find((h) => h.itemName === "Homemade chicken stock")!.used, 1);

    // 10. The cooking history retains the meal, with what came out of Pantry.
    const recipeStore = new DeviceRecipeStore(new Mem(), () => at(210));
    const recipe = await recipeStore.createRecipe(recipeFromSession(session, ""));
    await recipeStore.addCookingEntry(recipe.id, { cookedOn: TODAY, cookName: "Alice", ingredientsUsed: "Pork shoulder bones, split peas, chicken stock", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA, session: { ...session, recipeId: recipe.id } });
    const history = await cookingHistory(recipeStore, 10);
    assert.equal(history[0].recipe.title, soup.title, "newest first: the soup is in the cooking history");
    const receipts = history[0].entry.session!.events.flatMap((e) => (e.kind === "pantry" ? [e.action] : []));
    assert.deepEqual(receipts.map((a) => [a.itemName, a.quantity, a.kind]).sort(), [["Homemade chicken stock", 1, "used"], ["Pork shoulder bones", 2, "used"]].sort());
    assert.equal(recentlyMade(history, [], pantry2.items, TODAY)[0].title, soup.title);
  });

  test(`${label}: undo puts the bones back once, and the history says so`, async () => {
    const store = new FoodStore(new Mem());
    const d = parseFoodDescription("two pork ribs in the freezer", TODAY)[0];
    const a = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: d, itemId: null, now: NOW });
    assert.ok(a.ok);
    const item = find(await stockNow(), "Pork ribs")!;
    const used = await useFood(client(), store, { item, quantity: 1, why: { label: "supper" }, now: at(1) });
    assert.ok(used.ok);
    const u = act(used);
    assert.ok((await undoFood(client(), store, u, at(2))).ok);
    assert.equal(find(await stockNow(), "Pork ribs")!.onHand, 2);
    assert.equal(netUsed(store.byItem(item.id)[0]), 0, "undone use no longer counts");
    const again = await undoFood(client(), store, u, at(3));
    assert.equal(again.ok, false, "a second undo is refused");
    assert.equal(find(await stockNow(), "Pork ribs")!.onHand, 2);
    // Using more than there is changes nothing.
    const over = await useFood(client(), store, { item: find(await stockNow(), "Pork ribs")!, quantity: 5, why: { label: "x" } });
    assert.equal(over.ok, false);
    assert.equal(find(await stockNow(), "Pork ribs")!.onHand, 2);
    // Returning more than was used is refused before Inventory is touched.
    const u2 = await useFood(client(), store, { item: find(await stockNow(), "Pork ribs")!, quantity: 1, why: { label: "y" }, now: at(4) });
    const r = await returnUnused(client(), store, { action: act(u2), returning: 3, why: { label: "y" } });
    assert.equal(r.ok, false);
    assert.equal(find(await stockNow(), "Pork ribs")!.onHand, 1);
  });

  test(`${label}: duplicate photos and double taps never add twice`, async () => {
    const store = new FoodStore(new Mem());
    const shot = await photo("photo-of-garden-tomatoes");
    const d = parseFoodDescription("garden tomatoes in the fridge", TODAY)[0];
    const args = { ...ids(), stock: await stockNow(), draft: d, itemId: null, photos: [shot], now: NOW };
    const first = await addFood(client(), store, args);
    assert.ok(first.ok);
    // A retry with the same request id (reply lost): same result, one note, one batch.
    const retry = await addFood(client(), store, { ...args, stock: await stockNow() });
    assert.ok(retry.ok);
    assert.equal(store.list().filter((n) => n.itemName === "Garden tomatoes").length, 1);
    assert.equal(find(await stockNow(), "Garden tomatoes")!.onHand, 1);
    // The same picture again, as a new add: asked first, and nothing changes.
    const dup = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: d, itemId: null, photos: [shot], now: at(5) });
    assert.equal(dup.ok, false);
    assert.equal(!dup.ok && dup.duplicates?.[0].kind, "photo");
    assert.equal(find(await stockNow(), "Garden tomatoes")!.onHand, 1);
    // A different picture of the same food in the same place moments later: also asked.
    const other = await photo("another-photo-of-tomatoes");
    const near = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: d, itemId: null, photos: [other], now: at(5) });
    assert.equal(!near.ok && near.duplicates?.[0].kind, "recent");
    // …and the person can say it really is more: it joins the same Inventory product as a second batch.
    const more = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: d, itemId: find(await stockNow(), "Garden tomatoes")!.id, photos: [other], now: at(5), allowDuplicate: true });
    assert.ok(more.ok, !more.ok ? more.error : "");
    const t = find(await stockNow(), "Garden tomatoes")!;
    assert.deepEqual([t.onHand, t.lots.length], [2, 2]);
  });

  test(`${label}: uncertain amounts are kept as uncertain, and a near-match is offered, never merged`, async () => {
    const store = new FoodStore(new Mem());
    const chili = parseFoodDescription("some leftover chili in the fridge", TODAY)[0];
    const a = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: chili, itemId: null, now: NOW });
    assert.ok(a.ok);
    const n = a.ok ? a.note : null;
    assert.deepEqual([n?.amountKnown, n?.quantityText], [false, ""]);
    const inv = find(await stockNow(), "Leftover chili")!;
    assert.deepEqual([inv.onHand, inv.unit], [1, "portion"]);
    const plan = planAdd(chili, await stockNow(), store.list(), [], at(120));
    assert.ok(plan.summary[0].startsWith("Amount not known"));

    const meat = parseFoodDescription("approximately two pounds of stew meat in the freezer", TODAY)[0];
    const m = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: meat, itemId: null, now: NOW });
    assert.ok(m.ok);
    assert.deepEqual([m.ok && m.note.approximate, m.ok && m.note.quantityText], [true, "about 2 pounds"]);
    // "Beef stew meat" is not "Stew meat": offered as similar, not joined.
    const beef = parseFoodDescription("one pound of beef stew meat in the freezer", TODAY)[0];
    const p = planAdd(beef, await stockNow(), store.list(), [], at(120));
    assert.equal(p.existing, null);
    assert.deepEqual(p.similar.map((i) => i.name), ["Stew meat"]);
    // Same name but Pantry counts it in another unit: said so before anything is added.
    const lbs = planAdd({ ...meat, unit: "packs" }, await stockNow(), store.list(), [], at(120));
    assert.equal(lbs.unitMismatch, "lb");
    assert.deepEqual(candidates("stew meat", await stockNow()).map((i) => i.name), ["Stew meat"]);
  });

  test(`${label}: plain-language commands — nothing changes without a plan, and ambiguity becomes a question`, async () => {
    const store = new FoodStore(new Mem());
    const put = async (text: string, now = NOW) => { const r = await addFood(client(), store, { ...ids(), stock: await stockNow(), draft: parseFoodDescription(text, TODAY)[0], itemId: null, now }); assert.ok(r.ok, text); };
    await put("two pounds of pork roast in the freezer");
    await put("one pound of beef roast in the freezer");
    await put("three containers of chicken broth in the fridge");
    const before = await stockNow();

    const add = parseCommand("Add these two pork bones to my freezer.", TODAY);
    assert.deepEqual(add.kind === "add" && add.drafts.map((d) => [d.name, d.count, d.location]), [["Pork bones", 2, "Freezer"]]);
    const made = parseCommand("I made three containers of chicken stock.", TODAY);
    assert.equal(made.kind === "add" && made.drafts[0].name, "Homemade chicken stock");
    assert.deepEqual(parseCommand("Show me what needs using.", TODAY), { kind: "needs-using" });
    assert.deepEqual(parseCommand("What's in my freezer?", TODAY), { kind: "list", where: "Freezer", zone: "freezer" });

    // "I used the last of the stew meat" matches two products: ask, change nothing.
    const used = resolveCommand(parseCommand("I used the last of the roast.", TODAY), before, store.list(), TODAY);
    assert.equal(used.kind, "used");
    assert.equal(used.kind === "used" && used.plan.status, "ask");
    assert.deepEqual(used.kind === "used" && used.plan.status === "ask" && used.plan.options.map((o) => o.name).sort(), ["Beef roast", "Pork roast"]);
    // Named exactly, it is one product: a plan to confirm, all of it.
    const one = resolveCommand(parseCommand("I used the last of the beef roast", TODAY), before, store.list(), TODAY);
    assert.ok(one.kind === "used" && one.plan.status === "ready" && one.plan.quantity === 1 && one.plan.item.name === "Beef roast");
    // No count: asks how many. Too many: refuses.
    const nocount = resolveCommand(parseCommand("I used the chicken broth", TODAY), before, store.list(), TODAY);
    assert.ok(nocount.kind === "used" && nocount.plan.status === "ask" && nocount.plan.needsCount);
    const many = resolveCommand(parseCommand("I used 9 containers of chicken broth", TODAY), before, store.list(), TODAY);
    assert.ok(many.kind === "used" && many.plan.status === "none");
    const nothing = resolveCommand(parseCommand("I used the last of the saffron", TODAY), before, store.list(), TODAY);
    assert.ok(nothing.kind === "used" && nothing.plan.status === "none");
    assert.deepEqual(await stockNow(), before, "no command above changed Inventory");

    // Executing the confirmed plan, then undoing it.
    if (one.kind === "used" && one.plan.status === "ready") {
      const r = await useFood(client(), store, { item: one.plan.item, quantity: one.plan.quantity, why: { label: "eaten" } });
      assert.ok(r.ok);
      assert.equal(find(await stockNow(), "Beef roast")!.onHand, 0);
      assert.ok(resolveCommand(parseCommand("I used the last of the roast.", TODAY), await stockNow(), store.list(), TODAY).kind === "used");
      assert.ok((await undoFood(client(), store, act(r))).ok);
      assert.equal(find(await stockNow(), "Beef roast")!.onHand, 1);
    }

    // Needs using: leftovers and anything dated soon, read-only.
    await put("some leftover chili in the fridge");
    const need = resolveCommand({ kind: "needs-using" }, await stockNow(), store.list(), TODAY);
    assert.ok(need.kind === "answer" && need.lines.some((l) => /Leftover chili/.test(l)));

    // Moving: only in the newer Pantry; production says so and changes nothing.
    const mv = resolveCommand(parseCommand("Move one container of chicken broth to the fridge", TODAY), await stockNow(), store.list(), TODAY);
    assert.ok(mv.kind === "move");
    const broth = find(await stockNow(), "Chicken broth")!;
    const plan = mv.kind === "move" ? mv.plan : null;
    assert.equal(plan?.status, "ready");
    const moved = await moveFood(client(), store, { item: broth, lot: broth.lots[0], quantity: 1, toLocation: "Garage freezer" });
    if (hasNext) {
      assert.ok(moved.ok, !moved.ok ? moved.error : "");
      const b = find(await stockNow(), "Chicken broth")!;
      assert.deepEqual(b.lots.map((l) => [l.location, l.remaining]).sort(), [["Fridge", 2], ["Garage freezer", 1]]);
      assert.equal(b.onHand, 3, "moving doesn't change the total");
      assert.ok((await undoFood(client(), store, act(moved))).ok);
      assert.equal(find(await stockNow(), "Chicken broth")!.lots.length, 1);
    } else {
      assert.equal(moved.ok, false);
      assert.match(!moved.ok ? moved.error : "", /isn't switched on in ELK Pantry yet/);
      assert.equal(find(await stockNow(), "Chicken broth")!.onHand, 3);
    }
  });
}

test("stock, broth and bones are never the meat in a dish — dishes other than soup don't treat them as the meat", () => {
  const item = (name: string, unit: string, location: string) => ({ name, onHand: 2, unit, location, bestBefore: null, places: [{ location, quantity: 2, bestBefore: null }], lowStockAt: null });
  const k = buildKnowledge({ pantry: [item("Homemade chicken stock", "containers", "Freezer"), item("Pork bones", "bones", "Freezer"), item("Nacho chips", "bags", "Pantry"), item("Cheddar cheese", "blocks", "Fridge")], recent: [], said: [], today: TODAY });
  const ideas = kitchenIdeas(k, { meal: null, occasion: null, snack: false, quick: false, avoid: [] }, 10);
  for (const i of ideas.filter((x) => !/soup/i.test(x.title))) {
    assert.ok(!i.ingredients.some((g) => g.status === "have" && /stock|bone/i.test(g.name)), `${i.title} used stock or bones as an ingredient`);
  }
});

test("the food notes backup round-trips and restoring adds, never overwrites", async () => {
  const store = new FoodStore(new Mem());
  assert.equal(store.add({ id: "a", itemId: "i1", itemName: "Pork bones", description: "two", nameFrom: "you-said", suggestedName: "", confidence: null, quantityText: "", amountKnown: false, approximate: false, kinds: ["raw"], notes: "", location: "", madeOn: null, photos: [], fingerprints: ["f"], addedAt: NOW, addedBy: "", origin: "kitchen", uses: [] }), true);
  assert.equal(store.add({ ...store.list()[0], itemName: "Changed" }), false, "same id: left exactly as it is");
  assert.equal(store.list()[0].itemName, "Pork bones");
  assert.equal(store.byFingerprint("f")?.id, "a");
});

test("backup: food notes and their photos travel with Backup & import; restoring adds and never overwrites", () => {
  const phone = new Mem();
  const store = new FoodStore(phone);
  store.add({ id: "n1", itemId: "i1", itemName: "Pork shoulder bones", description: "two", nameFrom: "photo-suggested", suggestedName: "Pork bones", confidence: "low", quantityText: "two bones", amountKnown: true, approximate: false, kinds: ["raw"], notes: "", location: "Freezer", madeOn: null, photos: [{ id: "ph1", caption: "", addedAt: NOW }], fingerprints: ["f1"], addedAt: NOW, addedBy: "Alice", origin: "kitchen", uses: [{ id: "u1", at: NOW, kind: "used", quantity: 2, unit: "bones", requestId: "r1", for: "Split pea soup", sessionId: null }] });
  const records = readDeviceRecords(phone);
  assert.equal(hasDeviceRecords(records), true);
  assert.deepEqual(deviceRecordPhotoIds(records), ["ph1"]);
  const parsed = parseDeviceRecords(JSON.parse(JSON.stringify(records)))!;
  const other = new Mem();
  assert.equal(mergeDeviceRecords(other, parsed).food, 1);
  assert.equal(mergeDeviceRecords(other, parsed).food, 0);
  assert.deepEqual(new FoodStore(other).get("n1")!.uses.map((u) => [u.kind, u.for]), [["used", "Split pea soup"]]);
  assert.equal(parseDeviceRecords({ foodNotes: [{ nope: true }, null] })!.foodNotes!.length, 0, "unreadable notes are dropped, never guessed");
});

// ── The photo helper (ADR 0003): suggestions only, family only, bounded ───
const ENV = { openaiKey: "test-key", supabaseUrl: "https://db.example", anonKey: "anon" };
const IMG = `data:image/jpeg;base64,${Buffer.from("not-really-a-jpeg").toString("base64")}`;
const post = (body: unknown, token: string | null = "tok") =>
  new Request("https://kitchen.example/api/companion", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test("photo helper: family-only before the key is touched; the answer is bounded to names and confidence", async () => {
  const calls: { url: string; body?: string }[] = [];
  const model = { cannotTell: false, suggestions: [
    { name: "pork shoulder bones", confidence: "high", note: "two bones with meat" },
    { name: "Pork shoulder bones", confidence: "low", note: "dup" },
    { name: "ham hock", confidence: "certain!", note: "x".repeat(400), quantity: "2 lb", brand: "Acme" },
    { name: "x", confidence: "low", note: "" }, { name: "a", confidence: "low", note: "" }, { name: "b b", confidence: "low", note: "" }, { name: "c c", confidence: "low", note: "" }, { name: "d d", confidence: "low", note: "" },
  ] };
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string });
    if (String(url).includes("elk_is_family_member")) return new Response(JSON.stringify(!String((init?.headers as Record<string, string>).Authorization).includes("stranger")), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(model) } }] }), { status: 200 });
  }) as typeof fetch;
  const req = { mode: "food-photo", image: IMG, hint: "pork" };
  assert.equal((await handle(post(req, "stranger"), { ...ENV, fetchImpl: f })).status, 403);
  assert.ok(!calls.some((c) => c.url.includes("openai")), "a stranger never reaches the model");
  assert.equal((await handle(post(req), { ...ENV, openaiKey: undefined, fetchImpl: f })).status, 503);
  assert.equal((await handle(post({ ...req, image: "https://evil.example/x.jpg" }), { ...ENV, fetchImpl: f })).status, 400, "only an inline image is accepted");
  assert.equal((await handle(post({ ...req, image: `data:image/jpeg;base64,${"A".repeat(1_500_000)}` }), { ...ENV, fetchImpl: f })).status, 413);

  const res = await handle(post(req), { ...ENV, fetchImpl: f });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("test-key"));
  const body = JSON.parse(text);
  assert.deepEqual(body.reply.suggestions.map((s: { name: string }) => s.name), ["Pork shoulder bones", "Ham hock", "B b", "C c"], "duplicates and one-letter names are dropped, four at most");
  assert.equal(body.reply.suggestions[1].confidence, "low", "an unknown confidence is treated as low");
  assert.ok(body.reply.suggestions.every((s: object) => Object.keys(s).sort().join() === "confidence,name,note"), "no quantity or brand survives");
  assert.ok(body.reply.suggestions[1].note.length <= 160);
  const sent = JSON.parse(calls.find((c) => c.url.includes("openai"))!.body!);
  assert.equal(sent.response_format.json_schema.name, "kitchen_food_photo");
  assert.equal(sent.messages[1].content[1].image_url.detail, "low");
  assert.match(sent.messages[0].content, /cannotTell to true/);
});

test("photo helper: 'cannot tell' and unreadable answers become no suggestion, and the browser falls back to describing", async () => {
  assert.deepEqual(checkFoodPhotoReply({ cannotTell: true, suggestions: [{ name: "Something", confidence: "high", note: "" }] }).cannotTell, true);
  assert.deepEqual(checkFoodPhotoReply("nonsense"), { suggestions: [], cannotTell: true });
  const off = await askFoodPhoto({ mode: "food-photo", image: IMG, hint: "" }, "t", (async () => new Response(JSON.stringify({ error: "Kitchen's AI isn't switched on yet." }), { status: 503 })) as typeof fetch);
  assert.deepEqual([off.ok, !off.ok && off.off], [false, true]);
  const down = await askFoodPhoto({ mode: "food-photo", image: IMG, hint: "" }, "t", (async () => { throw new Error("net"); }) as typeof fetch);
  assert.equal(down.ok, false);
  // A bad name never becomes the record by itself: identify() says whether the person changed it.
  assert.equal(identify("Pork shoulder bones", { name: "Pork shoulder bones", confidence: "medium" }).nameFrom, "photo-suggested");
  assert.equal(identify("Ham hock", { name: "Pork shoulder bones", confidence: "medium" }).nameFrom, "photo-suggested-edited");
  assert.equal(identify("Ham hock", null).nameFrom, "you-said");
});
