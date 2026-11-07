// Sausage Day live (M632): the owner's real purchases and the four handwritten
// recipes from the M632 brief, the live conversation, batch planning,
// seasoning scaling, safety, costs, and the batches kept as Kitchen records.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { PlanStore } from "../src/lib/sausage/preferences";
import { SEED_PLAN_ID, SEED_PREFS, SEED_RECIPES, ensureSausageDay, seedPurchases } from "../src/lib/sausage/today";
import {
  applyRecommendation, approveDay, batchEntryInput, dayOf, finishedCount, hearDay, markStep, meatTotals, nextAction, openQuestions,
  progressOf, recipePlanOf, repeatBatch, setUsable, stepStates, type Ctx,
} from "../src/lib/sausage/day";
import { demandOf, fatComparison, originalFat, recommend, substitutionNotes, todayFat } from "../src/lib/sausage/allocate";
import { costsFor, neededItems, seasoningsOf, usableOf } from "../src/lib/sausage/plan";
import type { Recipe } from "../src/types/recipe";
import type { SausagePlan } from "../src/types/sausage";

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const T0 = "2026-11-07T19:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

async function setup() {
  const storage = new MemoryStorage();
  const store = new DeviceRecipeStore(storage, () => T0);
  const plans = new PlanStore(storage);
  const plan = await ensureSausageDay(store, plans, T0, "Lorne");
  const recipes = (await store.listRecipes()).filter((r) => plan.recipeIds.includes(r.id)) as Recipe[];
  const byTitle = (t: string) => recipes.find((r) => r.title === t)!;
  return { storage, store, plans, plan, recipes, byTitle };
}
const ctxFor = (recipes: Recipe[], min = 0): Ctx => ({ recipes, now: at(min), by: "Lorne", prefs: SEED_PREFS });

function say(plan: SausagePlan, recipes: Recipe[], ...lines: string[]) {
  let p = plan;
  const replies: string[] = [];
  lines.forEach((l, i) => { const h = hearDay(p, l, ctxFor(recipes, i + 1)); p = h.plan; replies.push(h.reply); });
  return { plan: p, replies };
}

test("today's meat is recorded exactly: 15.501 kg for $194.36, as bought, not usable", () => {
  const ps = seedPurchases();
  assert.deepEqual(ps.map((p) => [p.name, p.weightG, p.price]), [
    ["Pork butt #1", 3705, 31.45], ["Pork butt #2", 4928, 41.84], ["Beef eye of round", 4248, 88.87], ["Chicken thighs, bone-in, skin-on", 2620, 32.2],
  ]);
  const t = meatTotals({ purchases: ps, alloc: {}, day: undefined } as unknown as SausagePlan);
  assert.equal(t.bought, 15501);
  assert.equal(t.paid, 194.36);
  // Nothing has been weighed after trimming, so no usable weight is claimed.
  assert.ok(ps.every((p) => p.usableG === null && !usableOf(p).measured));
});

test("opening Kitchen starts Sausage Day once: four recipes in the book, today's stage known, nothing re-entered", async () => {
  const { store, plans, plan, recipes } = await setup();
  assert.equal(plan.id, SEED_PLAN_ID);
  assert.deepEqual(recipes.map((r) => r.title).sort(), ["Bratwurst", "Breakfast Sausage", "Dinner Sausage", "Smokies"]);
  const d = dayOf(plan);
  assert.equal(d.meat["p-butt-1"], "ground");
  assert.equal(d.meat["p-butt-2"], "ground");
  assert.equal(d.meat["p-chicken"], "grinding");
  assert.equal(d.meat["p-beef"], "unknown"); // beef not yet confirmed
  // The current step is "finish grinding", and the assistant knows why.
  const prog = progressOf(stepStates(plan, recipes), recipes.length);
  assert.equal(prog.current?.key, "grind");
  const next = nextAction(plan, recipes);
  assert.match(next.text, /chicken.*grinder/i);
  assert.match(next.text, /beef ground yet/i);
  // Opening again (another visit, or React running the effect twice) adds nothing.
  const again = await Promise.all([ensureSausageDay(store, plans, at(5), "Lorne"), ensureSausageDay(store, plans, at(5), "Lorne")]);
  assert.equal(again[0].id, plan.id);
  assert.equal((await store.listRecipes()).filter((r) => r.kind === "sausage").length, 4);
  assert.equal(plans.list().length, 1);
});

test("a recipe already typed in under the same name is used as it is, not duplicated", async () => {
  const storage = new MemoryStorage();
  const store = new DeviceRecipeStore(storage, () => T0);
  const mine = await store.createRecipe({ ...SEED_RECIPES[2], title: "Bratwurst", notes: "My own copy" });
  const plan = await ensureSausageDay(store, new PlanStore(storage), T0, "");
  assert.ok(plan.recipeIds.includes(mine.id));
  assert.equal((await store.listRecipes()).filter((r) => /brat/i.test(r.title)).length, 1);
});

test("the cards are stored as written: every amount, the optional extras, and the handwritten notes word for word", async () => {
  const { byTitle } = await setup();
  const bk = byTitle("Breakfast Sausage");
  assert.equal(bk.ingredients, "5 lb pork tenderloin\n3 lb pork belly\n1 lb chicken thigh");
  assert.match(bk.details.seasoning, /^Salt: 72 g$/m);
  assert.match(bk.notes, /"A little less salt\."/);
  const sm = byTitle("Smokies");
  for (const line of ["Cayenne can be used for additional heat.", "Original cook used both chili and cayenne.", "Ice water: 80–100 ml.", "Cheese added near the end."]) assert.ok(sm.notes.includes(line), line);
  // No cayenne amount is invented anywhere in the recipe.
  assert.ok(!/cayenne\s*:?\s*\d/i.test(sm.details.seasoning + sm.ingredients));
  // Totals on the cards: 9, 4.5, 4.5 and 5.5 lb.
  assert.deepEqual(["Breakfast Sausage", "Dinner Sausage", "Bratwurst", "Smokies"].map((t) => Math.round(demandOf(byTitle(t)).totalG / 4.53592) / 100), [9, 4.5, 4.5, 5.5]);
  const bs = seasoningsOf(bk);
  assert.equal(bs.length, 9);
  assert.equal(bs.find((s) => s.name === "Maple syrup")?.optional, true);
  assert.equal(seasoningsOf(byTitle("Bratwurst")).find((s) => s.name === "Mace")?.optional, true);
  assert.equal(seasoningsOf(byTitle("Dinner Sausage")).find((s) => s.name === "Cheddar cubes")?.optional, true);
});

test("the conversation from the brief: chicken done → weigh it → 2.1 kg → ready to divide", async () => {
  const { plan, recipes } = await setup();
  let h = hearDay(plan, "Chicken is done.", ctxFor(recipes, 1));
  assert.match(h.reply, /^Great! Let's weigh the chicken\. How much usable meat did we get\?/);
  assert.equal(dayOf(h.plan).meat["p-chicken"], "ground");
  h = hearDay(h.plan, "2.1 kilograms.", ctxFor(recipes, 2));
  assert.match(h.reply, /^Perfect\. I've updated your available meat: chicken thighs, bone-in, skin-on 2\.1 kg usable \(520 g of bone, skin and trim — 20% of the 2\.62 kg bought\)\./);
  assert.match(h.reply, /Ready to divide the batches\?$/);
  const chicken = h.plan.purchases.find((p) => p.id === "p-chicken")!;
  assert.equal(chicken.usableG, 2100);
  // The trimming loss is recorded and costed.
  const t = meatTotals(h.plan);
  assert.equal(t.lossG, 520);
  assert.equal(t.lossCost, 6.39);
  // What was said is kept word for word.
  assert.deepEqual(dayOf(h.plan).log.filter((e) => e.kind === "said").map((e) => e.text), ["Chicken is done.", "2.1 kilograms."]);
  // "Yes" divides the batches.
  h = hearDay(h.plan, "Yes", ctxFor(recipes, 3));
  assert.match(h.reply, /Here's the split, keeping each card's meat ratios, as written on the cards/);
  assert.ok(recipes.every((r) => Object.values(h.plan.alloc[r.id] ?? {}).some((g) => g > 0)));
  assert.equal(h.plan.status, "draft"); // nothing final until approved
});

test("pork weighed together is shared by bought weight; spelled-out numbers work", async () => {
  const { plan, recipes } = await setup();
  const { plan: p } = say(plan, recipes, "the pork weighs eight point two kilos");
  const [a, b] = p.purchases;
  assert.equal(a.usableG! + b.usableG!, 8200);
  assert.equal(a.usableG, Math.round((8200 * 3705) / 8633));
  const one = say(plan, recipes, "pork butt 2 is 4.6 kg").plan;
  assert.equal(one.purchases[1].usableG, 4600);
  assert.equal(one.purchases[0].usableG, null);
});

function weighedPlan(plan: SausagePlan) {
  let p = setUsable(plan, ["p-butt-1", "p-butt-2"], 8200);
  p = setUsable(p, ["p-chicken"], 2100);
  p = setUsable(p, ["p-beef"], 4100);
  return p;
}

test("batch plan: original ratios kept, made as written when there's enough, leftovers reported, not all meat used", async () => {
  const { plan, recipes, byTitle } = await setup();
  const p = weighedPlan(plan);
  const rec = recommend(p, recipes);
  assert.equal(rec.scale, 1);
  // Pork limits it: 8.2 kg against the cards' 16.9 lb (7.666 kg) of pork.
  assert.equal(rec.limitedBy, "pork");
  assert.equal(rec.maxScale, 1.06);
  const a = applyRecommendation(p, recipes);
  const sum = (rid: string) => Object.values(a.alloc[rid]).reduce((n, g) => n + g, 0);
  // 9 lb and 5.5 lb, to the gram (each card line is rounded to a whole gram).
  assert.ok(Math.abs(sum(byTitle("Breakfast Sausage").id) - 9 * 453.592) < 2);
  assert.ok(Math.abs(sum(byTitle("Smokies").id) - 5.5 * 453.592) < 2);
  // Breakfast keeps its 8 : 1 pork-to-chicken ratio.
  const bk = a.alloc[byTitle("Breakfast Sausage").id];
  const pork = (bk["p-butt-1"] ?? 0) + (bk["p-butt-2"] ?? 0);
  assert.ok(Math.abs(pork / bk["p-chicken"] - 8) < 0.02);
  // Both pork butts are used evenly.
  assert.ok(Math.abs(bk["p-butt-1"] / bk["p-butt-2"] - 3705 / 4928) < 0.01);
  // Bratwurst has no beef or chicken; dinner has all three.
  assert.deepEqual(Object.keys(a.alloc[byTitle("Bratwurst").id]).sort(), ["p-butt-1", "p-butt-2"]);
  // Not all the meat is used: most of the beef is left over and reported.
  const left = recommend(a, recipes).leftover;
  const beefLeft = left.find((x) => x.purchase.id === "p-beef")!.g;
  const beefUsed = recipes.reduce((n, r) => n + (a.alloc[r.id]["p-beef"] ?? 0), 0);
  assert.ok(Math.abs(beefUsed - 3.1 * 453.592) < 2); // the cards' 1 + 2.1 lb of beef
  assert.equal(beefLeft, 4100 - beefUsed);
  // "Use as much as we can" scales every batch evenly to what the pork allows.
  const big = say(a, recipes, "use as much as we can").plan;
  assert.equal(dayOf(big).scale, 1.06);
});

test("substitutions are explained, fat is an estimate with a range", async () => {
  const { plan, recipes, byTitle } = await setup();
  const a = applyRecommendation(weighedPlan(plan), recipes);
  const bk = byTitle("Breakfast Sausage");
  const notes = substitutionNotes(bk, a);
  assert.ok(notes.some((n) => /pork butt.*in place of 2\.3 kg pork tenderloin \+ 1\.4 kg pork belly.*between lean tenderloin/i.test(n)), notes.join("|"));
  const sm = byTitle("Smokies");
  assert.ok(substitutionNotes(sm, a).some((n) => /leaner than belly/.test(n)));
  assert.ok(substitutionNotes(sm, a).some((n) => /eye of round/i.test(n)));
  const o = originalFat(sm)!, t = todayFat(a, sm.id)!;
  assert.ok(o.low < o.mid && o.mid < o.high);
  assert.ok(t.mid < o.mid - 3); // butt for belly makes smokies leaner
  assert.match(fatComparison(sm, a), /leaner than the original.*estimates/);
});

test("seasonings scale exactly with the meat; the card's numbers are never changed silently", async () => {
  const { plan, recipes, byTitle } = await setup();
  const a = applyRecommendation(weighedPlan(plan), recipes);
  const bk = recipePlanOf(a, byTitle("Breakfast Sausage"));
  const g = (rp: ReturnType<typeof recipePlanOf>, n: string) => rp.seasonings.find((x) => x.s.name === n)!;
  // As written (9 lb): the card's own grams come back.
  assert.equal(g(bk, "Salt").text, "72 g");
  assert.equal(g(bk, "Black pepper").text, "18 g");
  assert.equal(g(bk, "Red pepper flakes").text, "3 g");
  // Optional maple syrup is out until the cook says.
  assert.equal(g(bk, "Maple syrup").included, false);
  // Bigger batches scale every seasoning by the same factor.
  const big = recipePlanOf(applyRecommendation(a, recipes, 1.06), byTitle("Breakfast Sausage"));
  assert.equal(g(big, "Salt").grams, Math.round(72 * 1.06 * 1000) / 1000 > 0 ? g(big, "Salt").grams : 0);
  assert.ok(Math.abs(g(big, "Salt").grams! - 72 * 1.06) < 0.1);
  // Bratwurst beer: ½ cup for 4.5 lb, by volume.
  assert.match(g(recipePlanOf(a, byTitle("Bratwurst")), "Beer").text, /^0\.5 cup/);
  // Smokies ice water is a range, scaled at both ends.
  assert.equal(g(recipePlanOf(a, byTitle("Smokies")), "Ice water").text, "80–100 ml");
});

test("handwritten notes become questions: less salt is the cook's choice, cayenne is asked, never invented", async () => {
  const { plan, recipes, byTitle } = await setup();
  let p = applyRecommendation(weighedPlan(plan), recipes);
  const q = openQuestions(p, recipes);
  assert.ok(q.some((x) => x.key === "salt" && /a little less salt/.test(x.text)));
  assert.ok(q.some((x) => x.key === "cayenne" && /no amount/.test(x.text)));
  // "Approve" first asks the open questions instead of locking in.
  let h = hearDay(p, "approve", ctxFor(recipes));
  assert.equal(h.plan.status, "draft");
  assert.match(h.reply, /Before I lock it in: Breakfast Sausage: the card's note says “a little less salt”/);
  // "A little less salt" with no number → Kitchen asks how much.
  h = hearDay(h.plan, "breakfast a little less salt", ctxFor(recipes));
  assert.match(h.reply, /How much less salt in the Breakfast Sausage\? 5, 10 or 15 percent\?/);
  h = hearDay(h.plan, "10%", ctxFor(recipes));
  assert.match(h.reply, /Breakfast Sausage: 10% less salt today\. The card itself is unchanged\./);
  p = h.plan;
  const salt = recipePlanOf(p, byTitle("Breakfast Sausage")).seasonings.find((x) => x.s.name === "Salt")!;
  assert.equal(salt.recipeText, "72 g");
  assert.equal(salt.text, "64.8 g");
  assert.match(salt.tweak!.reason, /a little less salt/);
  // The recipe in the book still says 72 g.
  assert.match(byTitle("Breakfast Sausage").details.seasoning, /Salt: 72 g/);
  // Cayenne: the cook's amount, kept as "added today".
  h = hearDay(p, "smokies 2 grams of cayenne", ctxFor(recipes));
  const cay = recipePlanOf(h.plan, byTitle("Smokies")).seasonings.find((x) => x.s.name === "Cayenne")!;
  assert.equal(cay.text, "2 g");
  assert.equal(cay.addedToday, true);
  // Optional extras by voice.
  h = hearDay(h.plan, "add the maple syrup to the breakfast", ctxFor(recipes));
  assert.match(h.reply, /maple syrup in — 120 ml/);
  h = hearDay(h.plan, "skip the mace", ctxFor(recipes));
  h = hearDay(h.plan, "no cheese in the dinner", ctxFor(recipes));
  assert.deepEqual(openQuestions(h.plan, recipes), []);
  h = hearDay(h.plan, "approve", ctxFor(recipes));
  assert.equal(h.plan.status, "approved");
  assert.match(h.reply, /Plan locked in — let's season!/);
  // The approved snapshot carries today's changes; the session's helper uses them.
  const snap = h.plan.snapshots[byTitle("Breakfast Sausage").id];
  assert.equal(snap.tweaks?.find((t) => t.name === "Salt")?.percent, -10);
  assert.deepEqual(snap.excluded, []);
  assert.deepEqual(h.plan.snapshots[byTitle("Bratwurst").id].excluded, ["mace"]);
  // Shopping list: skipped extras aren't asked for.
  const needed = neededItems(recipes.map((r) => recipePlanOf(h.plan, r))).map((n) => n.name.toLowerCase());
  assert.ok(needed.includes("maple syrup") && !needed.includes("mace") && !needed.includes("cheddar cubes"));
  assert.ok(needed.includes("cayenne"));
});

test("safety: 74 °C for anything with chicken, 71 °C otherwise; smokies are not shelf-stable", async () => {
  const { plan, recipes, byTitle } = await setup();
  const a = applyRecommendation(weighedPlan(plan), recipes);
  const temps = (t: string) => recipePlanOf(a, byTitle(t)).safety.map((s) => s.text).join(" ");
  for (const t of ["Breakfast Sausage", "Dinner Sausage", "Smokies"]) assert.match(temps(t), /74 °C/);
  assert.match(temps("Bratwurst"), /71 °C/);
  assert.doesNotMatch(temps("Bratwurst"), /74 °C/);
  const h = hearDay(a, "what temperature", ctxFor(recipes));
  assert.match(h.reply, /Bratwurst: 71 °C/);
  assert.match(h.reply, /Smokies: 74 °C/);
  const f = hearDay(a, "smokies in the fridge", ctxFor(recipes));
  assert.match(f.reply, /not shelf-stable or ready-to-eat/);
  // No cure is ever suggested.
  assert.ok(recipes.every((r) => !recipePlanOf(a, r).seasonings.some((x) => x.s.cure)));
});

test("batch steps by voice: later steps imply earlier ones, celebrations when every batch is done", async () => {
  const { plan, recipes, byTitle } = await setup();
  let p = approveDay(applyRecommendation(weighedPlan(say(plan, recipes, "chicken is done", "beef is done").plan), recipes), recipes, SEED_PREFS, "Lorne", at(4));
  const r = say(p, recipes, "breakfast is stuffed");
  const marks = dayOf(r.plan).done[byTitle("Breakfast Sausage").id];
  assert.ok(["weigh-seasonings", "mix", "bind", "sample", "adjust", "stuff"].every((k) => marks.includes(k as never)));
  assert.match(r.replies[0], /Breakfast Sausage: stuffed\./);
  // Which batch? asked when it's unclear.
  const which = hearDay(p, "it's mixed", ctxFor(recipes));
  assert.match(which.reply, /Which batch/);
  // "All mixed" covers every batch and is celebrated.
  const all = hearDay(p, "all mixed", ctxFor(recipes));
  assert.match(all.reply, /Every batch is mixed\./);
  assert.ok(dayOf(all.plan).log.some((e) => e.kind === "celebrate"));
  p = all.plan;
  // Breakfast's liquids step is skipped while the maple syrup is out.
  const liq = stepStates(p, recipes).find((s) => s.key === "liquids")!;
  assert.ok(liq.skipped.includes(byTitle("Breakfast Sausage").id));
});

test("finished weights, sausage counter and real costs", async () => {
  const { plan, recipes, byTitle } = await setup();
  let p = applyRecommendation(weighedPlan(plan), recipes);
  const h = hearDay(p, "breakfast made 32 sausages, 3.9 kilos", ctxFor(recipes));
  p = h.plan;
  const bk = byTitle("Breakfast Sausage");
  assert.deepEqual(p.results[bk.id], { finishedG: 3900, count: 32, servings: null });
  assert.equal(finishedCount(p), 32);
  const c = costsFor(recipePlanOf(p, bk), p.results[bk.id]);
  // Meat cost uses the price per usable kg (bone and trim are paid for too).
  const pork = 31.45 + 41.84, chicken = 32.2;
  const a = p.alloc[bk.id];
  const expected = (pork / 8200) * (a["p-butt-1"] + a["p-butt-2"]) + (chicken / 2100) * a["p-chicken"];
  assert.ok(Math.abs(c.meatCost! - expected) < 0.02, `${c.meatCost} vs ${expected}`);
  assert.equal(c.perKgBasis, "finished");
  assert.ok(Math.abs(c.perSausage! - c.meatCost! / 32) < 0.01);
  assert.match(h.reply, /per sausage/);
  assert.match(hearDay(p, "how many sausages", ctxFor(recipes)).reply, /32 sausages so far/);
});

test("a finished batch is kept as a Kitchen batch with photos, rated by the family, and can be made again", async () => {
  const { store, plan, recipes, byTitle } = await setup();
  let p = say(plan, recipes, "chicken is done", "2.1 kg", "beef is done", "4.1 kilos", "the pork is 8.2 kilos", "divide the batches",
    "breakfast keep the salt", "no cayenne in the smokies", "skip the maple syrup", "skip the mace", "skip the cheese", "approve").plan;
  assert.equal(p.status, "approved");
  const bk = byTitle("Breakfast Sausage");
  p = markStep(p, bk.id, "link");
  p = { ...p, day: { ...dayOf(p), photos: [{ id: "ph-before", caption: "", addedAt: at(1), phase: "before", recipeId: null }, { id: "ph-bk", caption: "", addedAt: at(30), phase: "after", recipeId: bk.id }] } };
  p = say(p, recipes, "breakfast made 30 sausages, 3.95 kg", "breakfast in the freezer").plan;
  const input = batchEntryInput(p, bk, "Lorne", at(40));
  assert.equal(input.cookedOn, "2026-11-07");
  assert.match(input.ingredientsUsed, /Salt: 72 g \(card: 72 g; kept the card's amount\)/);
  assert.match(input.substitutions, /in place of/);
  assert.match(input.yieldNote, /30 sausages · 3\.95 kg finished/);
  assert.match(input.notes, /74 °C/);
  assert.equal(input.details.finishedWeightG, 3950);
  assert.equal(input.details.internalTempC, null); // no reading was taken, so none is recorded
  assert.deepEqual(input.photos.map((x) => x.id), ["ph-before", "ph-bk"]);
  const entry = await store.addCookingEntry(bk.id, input);
  // Ratings go through Kitchen's own family feedback, per person.
  await store.saveFeedback(entry.id, { authorName: "Lorne", rating: 9, comment: "Best yet", improvement: "", makeAgain: "yes", photos: [] }, null);
  await store.saveFeedback(entry.id, { authorName: "Sam", rating: 8, comment: "", improvement: "More sage", makeAgain: "yes", photos: [] }, null);
  const fb = await store.listFeedback();
  assert.equal(fb.status === "ready" && fb.items.filter((f) => f.entryId === entry.id).length, 2);
  const states = stepStates(p, recipes, { [bk.id]: 2 });
  assert.ok(!states.find((s) => s.key === "ratings")!.pending.includes(bk.id));
  assert.ok(!states.find((s) => s.key === "photo")!.pending.includes(bk.id));
  // The recipe page shows the batch.
  const detail = await store.getRecipe(bk.id);
  assert.equal(detail!.entries.length, 1);
  // Repeat this batch: same recipe and choices, meat to buy from today's real trim.
  const again = repeatBatch(p, bk, at(60));
  assert.deepEqual(again.recipeIds, [bk.id]);
  assert.equal(dayOf(again).tweaks[bk.id][0].reason, "kept the card's amount");
  const porkBuy = again.purchases.find((x) => /pork butt/i.test(x.name))!;
  const pa = p.alloc[bk.id];
  assert.equal(porkBuy.weightG, Math.round(pa["p-butt-1"] / (p.purchases[0].usableG! / 3705)) + Math.round(pa["p-butt-2"] / (p.purchases[1].usableG! / 4928)));
  assert.equal(porkBuy.usableG, null);
  assert.equal(porkBuy.price, null);
});

test("unknown words are kept as notes, never guessed at; questions answer from the plan", async () => {
  const { plan, recipes } = await setup();
  const a = applyRecommendation(weighedPlan(plan), recipes);
  const h = hearDay(a, "the dog stole a sausage", ctxFor(recipes));
  assert.match(h.reply, /kept that as a note/);
  assert.equal(h.plan.alloc, a.alloc);
  assert.match(hearDay(a, "how much salt for the bratwurst", ctxFor(recipes)).reply, /Bratwurst salt: 35 g/);
  // A change with no batch named, when several have that seasoning: Kitchen asks which.
  const which = hearDay(a, "more pepper 10%", ctxFor(recipes));
  assert.match(which.reply, /^Which batch — Breakfast Sausage, Dinner Sausage, Bratwurst and Smokies\?/);
  assert.deepEqual(dayOf(which.plan).tweaks, {});
  assert.deepEqual(which.chips[0], "Breakfast more pepper 10%");
  const m = hearDay(a, which.chips[2], ctxFor(recipes));
  assert.match(m.reply, /Bratwurst: 10% more black pepper today/);
  assert.match(hearDay(a, "what's next", ctxFor(recipes)).reply, /chicken/i);
  const t = hearDay(a, "start a 20 minute timer for the casings", ctxFor(recipes));
  assert.equal(dayOf(t.plan).timers.length, 1);
  assert.equal(dayOf(t.plan).timers[0].seconds, 1200);
});

test("the plan record survives a reload with its day; older plans without one still load", async () => {
  const { storage, plan } = await setup();
  const again = new PlanStore(storage).get(plan.id)!;
  assert.deepEqual(dayOf(again).meat, dayOf(plan).meat);
  storage.setItem("elk-kitchen-sausage-plans-v1", JSON.stringify([{ format: 1, id: "old", purchases: [], title: "Old" }]));
  const old = new PlanStore(storage).get("old")!;
  assert.equal(old.day, undefined);
  assert.equal(dayOf(old).log.length, 0);
});


test("smoked paprika or the name “Smokies” doesn't make a sausage smoked; no smoking or curing process is given", async () => {
  const { plan, recipes, byTitle } = await setup();
  const a = applyRecommendation(weighedPlan(plan), recipes);
  for (const t of ["Dinner Sausage", "Smokies"]) {
    const rp = recipePlanOf(a, byTitle(t));
    assert.equal(rp.kind, "fresh", t);
    assert.ok(!rp.safety.some((s) => /smoker|hot-smoke|cure #|curing salt|cure:/i.test(s.text)), t);
  }
  const entry = batchEntryInput(a, byTitle("Smokies"), "Lorne", at(1));
  assert.match(entry.notes, /not shelf-stable or ready-to-eat/);
});
