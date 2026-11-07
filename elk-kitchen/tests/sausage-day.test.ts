// Sausage day (M631): the owner's real cook on 2026-11-07 — 15.501 kg of
// pork butt, beef eye of round and bone-in skin-on chicken thighs — into
// breakfast sausage, dinner sausage, bratwurst and smokies. The recipe texts
// below are TEST FIXTURES shaped like handwritten cards, not the owner's
// recipes (those haven't been entered yet).
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountFor, approve, costPerUsableKg, costsFor, fatAdvice, kindOf, leftoverOf, neededItems, newPlan, originalMeats, parsePurchases,
  planProblems, planRecipe, recipeBaseG, seasoningsOf, suggestSplit, usableOf, CURE1_G_PER_KG,
} from "../src/lib/sausage/plan";
import { cutOf } from "../src/lib/sausage/cuts";
import { parseProgress, weighedMeat, STAGES, STAGE_SAY } from "../src/lib/sausage/stages";
import { PlanStore, PLANS_KEY, blankPrefs, grindPhrase, loadPrefs, savePrefs } from "../src/lib/sausage/preferences";
import { hear, newSession } from "../src/lib/cooking/session";
import { batchFromSession } from "../src/lib/cooking/summary";
import { normalizeSession } from "../src/lib/cooking/drafts";
import { parseCommand } from "../src/lib/cooking/parse";
import { blankDetails } from "../src/lib/meat";
import type { Recipe } from "../src/types/recipe";
import type { Preferences } from "../src/types/sausage";

const T0 = "2026-11-07T18:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

function recipe(id: string, title: string, ingredients: string, extra: Partial<Recipe["details"]> = {}, more: Partial<Recipe> = {}): Recipe {
  return {
    id, title, authorName: "Lorne", ingredients, instructions: "1. Cube and chill\n2. Grind\n3. Mix\n4. Stuff", notes: "", tags: [], suggestedTags: [],
    approxCalories: null, kind: "sausage", category: "Sausage", photos: [], details: { ...blankDetails(), ...extra }, version: 3,
    createdAt: T0, updatedAt: T0, ...more,
  };
}

const breakfast = recipe("r-bk", "Breakfast sausage", "2 lb pork tenderloin\n1 lb pork belly\n18 g salt\n1 tbsp rubbed sage\n2 tsp black pepper\n1 tbsp maple syrup", { fatPercent: 25 });
const dinner = recipe("r-dn", "Dinner sausage", "1.5 kg chicken thighs\n0.5 kg pork belly\n36 g salt\n4 cloves garlic\nHog casings 32-35 mm", { fatPercent: 22 });
const brat = recipe("r-br", "Bratwurst", "2 kg pork tenderloin\n1 kg pork belly", { fatPercent: 28, seasoning: "Salt 1.8%\nWhite pepper 0.3%\nNutmeg 1 g/kg\nIce water 10%", casing: "Hog casings" });
const smokies = recipe("r-sm", "Smokies", "1 kg beef\n1 kg pork belly\nSalt 2%\nCure #1 2.5 g/kg\nPaprika 6 g/kg\nSheep casings", { fatPercent: 25, smokeTempC: 107 });
const recipes = [breakfast, dinner, brat, smokies];

const PURCHASE_TEXT = `Pork butt 3.705 kg $31.45
Pork butt 4.928 kg $41.84
Beef eye of round 4.248 kg $88.87
Chicken thighs bone-in skin-on 2.620 kg $32.20`;

test("purchases: the four packages are read exactly, nothing invented", () => {
  const ps = parsePurchases(PURCHASE_TEXT);
  assert.equal(ps.length, 4);
  assert.deepEqual(ps.map((p) => [p.name, p.weightG, p.price]), [
    ["Pork butt", 3705, 31.45], ["Pork butt", 4928, 41.84], ["Beef eye of round", 4248, 88.87], ["Chicken thighs bone-in skin-on", 2620, 32.2],
  ]);
  assert.equal(ps.reduce((n, p) => n + p.weightG!, 0), 15501);
  assert.equal(Math.round(ps.reduce((n, p) => n + p.price!, 0) * 100) / 100, 194.36);
  assert.equal(ps[3].boneIn, true);
  assert.equal(ps[3].skinOn, true);
  // No best-before or date was given, so none is made up.
  assert.ok(ps.every((p) => p.bestBefore === null && p.purchasedOn === null));
  // A line without a weight keeps the weight blank.
  const [noWeight] = parsePurchases("Hog casings $12.99");
  assert.equal(noWeight.weightG, null);
  assert.equal(noWeight.price, 12.99);
  // Pounds convert.
  assert.equal(parsePurchases("Pork shoulder 8 lb")[0].weightG, 3629);
});

test("usable meat: bone-in chicken is an estimate until weighed; a weighed figure replaces it", () => {
  const [, , beef, chicken] = parsePurchases(PURCHASE_TEXT);
  const est = usableOf(chicken);
  assert.equal(est.measured, false);
  assert.equal(est.g, Math.round(2620 * 0.72));
  assert.deepEqual(est.range, [Math.round(2620 * 0.65), Math.round(2620 * 0.8)]);
  const weighed = usableOf({ ...chicken, usableG: 1890 });
  assert.equal(weighed.measured, true);
  assert.equal(weighed.g, 1890);
  // Cost per usable kg counts the bone you paid for.
  assert.equal(costPerUsableKg({ ...chicken, usableG: 1890 }), Math.round((32.2 / 1890) * 1000 * 1000) / 1000);
  assert.equal(cutOf(beef.name).fat[2], 5);
  assert.equal(cutOf("Pork butt").fat[2], 25);
  assert.notEqual(cutOf("Pork butt").fat[2], cutOf("Pork tenderloin").fat[2], "cuts don't share one fat figure");
});

test("recipes: original meat, base weight and seasonings per kg from a handwritten-style card", () => {
  assert.deepEqual(originalMeats(breakfast).map((m) => [m.name, m.g]), [["pork tenderloin", 907], ["pork belly", 454]]);
  assert.equal(recipeBaseG(breakfast), 1361);
  const s = seasoningsOf(breakfast);
  assert.deepEqual(s.map((x) => [x.name, x.basis]), [["salt", "scaled"], ["rubbed sage", "volume"], ["black pepper", "volume"], ["maple syrup", "volume"]]);
  assert.equal(amountFor(s[0], 2722).text, "36 g", "18 g for 1361 g → 36 g for twice the meat");
  assert.match(amountFor(s[1], 2722).text, /^2 tbsp/);
  const b = seasoningsOf(brat);
  assert.deepEqual(b.map((x) => [x.name, x.gPerKg]), [["Salt", 18], ["White pepper", 3], ["Nutmeg", 1], ["Ice water", 100]]);
  const sm = seasoningsOf(smokies);
  assert.equal(sm.find((x) => x.cure)?.gPerKg, CURE1_G_PER_KG);
  assert.equal(kindOf(smokies), "cured");
  assert.equal(kindOf(breakfast), "fresh");
});

test("split: each meat goes to the recipes whose original used that kind of meat", () => {
  const ps = parsePurchases(PURCHASE_TEXT);
  const split = suggestSplit(ps, recipes);
  const [butt1, butt2, beef, chicken] = ps;
  // Beef only goes to smokies (the only original with beef).
  assert.equal(split.alloc["r-sm"][beef.id], usableOf(beef).g);
  assert.equal(split.alloc["r-bk"][beef.id], undefined);
  // Chicken only to the dinner sausage.
  assert.equal(split.alloc["r-dn"][chicken.id], usableOf(chicken).g);
  // Pork goes to all four, in the originals' proportions, and adds up exactly.
  for (const b of [butt1, butt2]) {
    const total = recipes.reduce((n, r) => n + (split.alloc[r.id][b.id] ?? 0), 0);
    assert.equal(total, usableOf(b).g);
  }
  assert.ok(split.alloc["r-br"][butt1.id] > split.alloc["r-dn"][butt1.id], "bratwurst's original had more pork than dinner's");
  assert.ok(split.reasons["r-sm"].some((r) => /Beef eye of round/.test(r)));
  assert.deepEqual(split.leftover, []);
});

test("plan per recipe: substitution, fat check, seasonings in grams, safety, cost", () => {
  const ps = parsePurchases(PURCHASE_TEXT);
  const split = suggestSplit(ps, recipes);
  const sm = planRecipe(smokies, ps, split.alloc["r-sm"]);
  assert.match(sm.substitutions[0], /Beef eye of round.*in place of beef \+ pork belly/);
  // Eye of round is lean, so the blend is under the 25% target and Kitchen says how to fix it.
  assert.ok(sm.fatPercent! < 23);
  assert.match(sm.fatAdvice, /leaner than the 25%.*pork back fat/);
  assert.equal(sm.kind, "cured");
  assert.ok(sm.safety.some((x) => /USDA limit for Cure #1/.test(x.text)));
  assert.ok(sm.safety.some((x) => /71 °C/.test(x.text)));
  const salt = sm.seasonings.find((x) => x.s.name === "Salt")!;
  assert.equal(salt.grams, Math.round(sm.meatG * 0.02 * 1000) / 1000);
  assert.ok(sm.meatCost! > 0);

  const dn = planRecipe(dinner, ps, split.alloc["r-dn"]);
  assert.equal(dn.poultry, true);
  assert.ok(dn.safety.some((x) => /74 °C \(165 °F\)/.test(x.text)));
  assert.equal(dn.casing, "Hog casings 32-35 mm");
  assert.equal(dn.measured, false, "chicken not weighed yet");

  // A cure above the USDA limit is flagged, never silently used.
  const hot = planRecipe(recipe("x", "Too much cure", "1 kg pork butt\nCure #1 5 g/kg"), ps, { [ps[0].id]: 1000 });
  assert.ok(hot.safety.some((x) => x.level === "warn" && /USDA limit/.test(x.text)));
  const two = planRecipe(recipe("w", "Cure 2 card", "1 kg pork butt\nCure #2 2.5 g/kg"), ps, { [ps[0].id]: 1000 });
  assert.ok(two.safety.some((x) => x.level === "warn" && /Cure #2 is for long dry-cured/.test(x.text)));
  const spoon = planRecipe(recipe("v", "Spoon cure", "1 kg pork butt\n1 tsp pink salt"), ps, { [ps[0].id]: 1000 });
  assert.ok(spoon.safety.some((x) => x.level === "warn" && /don't measure it by spoon/.test(x.text)));
  // Smoked without cure: hot smoke only.
  const smoked = planRecipe(recipe("y", "Smoked garlic", "1 kg pork butt\nSalt 2%\nSmoke at 110 C"), ps, { [ps[0].id]: 1000 });
  assert.equal(smoked.kind, "smoked");
  assert.ok(smoked.safety.some((x) => /Never cold-smoke/.test(x.text)));
  // A recipe without its meat weight can't scale its gram amounts, and says so.
  const noBase = planRecipe(recipe("z", "Card with no meat weight", "Pork\n20 g salt"), ps, { [ps[0].id]: 1000 });
  assert.match(noBase.unscaled, /how much meat they're for/);
  assert.equal(noBase.seasonings[0].text, "");
});

test("fat advice: back fat to add is worked out, and a missing target is said plainly", () => {
  assert.match(fatAdvice(4000, 10, 25, true), /about 1 kg of pork back fat/);
  assert.match(fatAdvice(4000, 25, 25, false), /on target/);
  assert.match(fatAdvice(4000, 20, null, true), /doesn't say a fat %/);
});

test("needed items, costs from finished yield, approval, problems", () => {
  const ps = parsePurchases(PURCHASE_TEXT);
  const split = suggestSplit(ps, recipes);
  let plan = { ...newPlan(T0), purchases: ps, recipeIds: recipes.map((r) => r.id), alloc: split.alloc };
  const plans = recipes.map((r) => planRecipe(r, ps, plan.alloc[r.id]));
  const need = neededItems(plans).map((n) => n.name.toLowerCase());
  assert.ok(need.includes("hog casings") && need.includes("sheep casings") && need.includes("salt"));
  assert.ok(!need.includes("ice water"));
  // Meat cost across all four recipes = everything paid (the whole purchase is used).
  const allCost = plans.reduce((n, p) => n + p.meatCost!, 0);
  assert.ok(Math.abs(allCost - 194.36) < 0.05, `${allCost}`);
  const c = costsFor(plans[2], { finishedG: 3000, count: 30, servings: 15 });
  assert.equal(c.perKgBasis, "finished");
  assert.equal(c.perSausage, Math.round((plans[2].meatCost! / 30) * 1000) / 1000);
  assert.equal(costsFor(plans[2], undefined).perKgBasis, "raw mix");
  assert.deepEqual(planProblems(plan), []);
  plan = { ...plan, alloc: { ...plan.alloc, "r-bk": { ...plan.alloc["r-bk"], [ps[0].id]: 99_999 } } };
  assert.ok(planProblems(plan).some((p) => /planned but only/.test(p)));
  assert.ok(leftoverOf(plan, ps[0]) < 0);
  const prefs: Preferences = { grind: "coarse", plate: "large plate", seasoningsInGrams: true, goals: "" };
  const ok = approve({ ...plan, alloc: split.alloc }, plans, prefs, "Lorne", at(5));
  assert.equal(ok.status, "approved");
  assert.equal(ok.snapshots["r-br"].recipeVersion, 3);
  assert.equal(ok.snapshots["r-br"].prefs.grind, "coarse");
  // The recipe objects were not touched.
  assert.equal(brat.details.seasoning, "Salt 1.8%\nWhite pepper 0.3%\nNutmeg 1 g/kg\nIce water 10%");
});

test("progress: the owner's own words are understood", () => {
  assert.deepEqual(parseProgress("I've finished grinding the pork. Now I'm grinding the chicken."), [
    { stage: "grind", subject: "pork", action: "finished" }, { stage: "grind", subject: "chicken", action: "started" },
  ]);
  assert.deepEqual(parseProgress("The pork is ground"), [{ stage: "grind", subject: "pork", action: "finished" }]);
  assert.deepEqual(parseProgress("Done stuffing the bratwurst"), [{ stage: "stuff", subject: "bratwurst", action: "finished" }]);
  assert.deepEqual(parseProgress("Starting to mix the breakfast sausage"), [{ stage: "mix", subject: "breakfast sausage", action: "started" }]);
  // Every big stage button on the cooking screen goes through the same rules.
  for (const st of STAGES) assert.deepEqual(parseProgress(STAGE_SAY[st]), [{ stage: st, subject: "", action: "finished" }], st);
  // Amounts, timers and ordinary notes are left to their own rules.
  assert.equal(parseProgress("Add 40 grams of salt"), null);
  assert.equal(parseProgress("Start a 20 minute timer"), null);
  assert.equal(parseProgress("I'm using the large plate"), null);
  assert.deepEqual(parseCommand("The pork weighs 8.2 kilos"), { kind: "add", name: "pork", qty: { value: 8.2, unit: "kg" } });
  assert.deepEqual(parseCommand("chicken came to 1.9 kg"), { kind: "add", name: "chicken", qty: { value: 1.9, unit: "kg" } });
});

test("live cook: plan → progress → weights → seasonings for the real weight → batch keeps the adaptation", () => {
  const ps = parsePurchases(PURCHASE_TEXT);
  const split = suggestSplit(ps, recipes);
  const plans = recipes.map((r) => planRecipe(r, ps, split.alloc[r.id]));
  const prefs: Preferences = { grind: "coarse", plate: "large plate", seasoningsInGrams: true, goals: "" };
  const approved = approve({ ...newPlan(T0), purchases: ps, recipeIds: recipes.map((r) => r.id), alloc: split.alloc }, plans, prefs, "Lorne", at(1));
  let s = newSession({ recipe: dinner, cookName: "Lorne", now: at(2), plan: approved.snapshots["r-dn"] });
  assert.equal(s.plan?.recipeTitle, "Dinner sausage");

  let r = hear(s, "I've finished grinding the pork. Now I'm grinding the chicken.", { recipe: dinner, source: "voice", now: at(3), prefs });
  s = r.session;
  assert.match(r.reply, /Grind done: pork/);
  assert.match(r.reply, /Coarse grind through the large plate/);
  assert.match(r.reply, /74 °C \(165 °F\)/);
  assert.equal(s.stageLog?.length, 2);
  assert.ok(s.events.some((e) => e.kind === "note" && e.text === "Finished grinding: pork"));
  assert.equal(s.transcript[0].text, "I've finished grinding the pork. Now I'm grinding the chicken.", "transcript kept word for word");

  r = hear(s, "The pork weighs 1.2 kilos", { recipe: dinner, source: "voice", now: at(20), prefs });
  s = r.session;
  assert.match(r.reply, /Still to weigh: chicken/);
  r = hear(s, "the chicken weighs 1.8 kilos", { recipe: dinner, source: "voice", now: at(25), prefs });
  s = r.session;
  assert.match(r.reply, /All the meat is weighed: 3 kg/);
  assert.match(r.reply, /salt 54 g/, "36 g per 2 kg of meat → 54 g for 3 kg");
  assert.deepEqual(weighedMeat(s, s.plan!).complete, true);

  r = hear(s, "How much salt do I need?", { recipe: dinner, source: "voice", now: at(26), prefs });
  assert.match(r.reply, /salt: 54 g for 3 kg of meat, as weighed/);
  r = hear(s, "Internal temp is 72 C", { recipe: dinner, source: "voice", now: at(90), prefs });
  assert.match(r.reply, /below the 74 °C/);
  s = r.session;

  // Survives a reload.
  const back = normalizeSession(JSON.parse(JSON.stringify(s)));
  assert.equal(back?.plan?.planId, approved.id);

  const batch = batchFromSession(s, dinner);
  assert.match(batch.substitutions, /in place of chicken thighs \+ pork belly/);
  assert.equal(batch.details.meatWeightG, 3000);
  assert.match(batch.notes, /Seasonings for 3 kg of meat, as weighed: salt 54 g/);
  assert.match(batch.notes, /Meat cost: \$/);
  assert.match(batch.ingredientsUsed, /pork/);
});

test("preferences and plans are kept on this device, editable, never deleted", () => {
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.deepEqual(loadPrefs(kv), blankPrefs(), "nothing assumed until the cook sets it");
  savePrefs(kv, { grind: "coarse", plate: "large plate", seasoningsInGrams: true, goals: "Reproduce and improve old recipes" });
  assert.equal(loadPrefs(kv).grind, "coarse");
  assert.equal(grindPhrase(loadPrefs(kv)), "coarse grind through the large plate");
  savePrefs(kv, { ...loadPrefs(kv), grind: "medium" });
  assert.equal(loadPrefs(kv).grind, "medium");
  const store = new PlanStore(kv);
  const p = newPlan(T0);
  store.put(p);
  store.put({ ...p, title: "Sausage day 2", updatedAt: at(1) });
  assert.equal(store.list().length, 1);
  assert.equal(store.get(p.id)?.title, "Sausage day 2");
  mem.set(PLANS_KEY, "not json");
  assert.deepEqual(store.list(), []);
});
