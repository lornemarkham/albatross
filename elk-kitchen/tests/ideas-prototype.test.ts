// "What should we cook?" prototype — the honesty rules: nothing claimed
// without evidence, reasons only from real data, simulated replies never
// pretend, nutrition never invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pantryFit, possibleMatches, ingredientStatus } from "../src/prototype/ideas/pantryMatch";
import { samplePantry } from "../src/prototype/ideas/samplePantry";
import { SAMPLE_IDEAS, sampleById } from "../src/prototype/ideas/sampleIdeas";
import { shelfFor } from "../src/prototype/ideas/suggest";
import { simulateReply, peopleIn, groundingFor } from "../src/prototype/ideas/conversation";
import { upcomingHolidays, seasonOf } from "../src/prototype/ideas/context";
import { formatQty, ingredientLine, scaleIngredient } from "../src/prototype/ideas/scale";
import { nutritionForSample, nutritionForSaved, formatNutrient } from "../src/prototype/ideas/nutrition";
import { stepsFromText, timerIn } from "../src/prototype/ideas/cookSteps";
import type { Moment } from "../src/prototype/ideas/types";
import type { RecipeSummary } from "../src/types/recipe";

const TODAY = "2026-10-10";
const pantry = samplePantry(TODAY);
const moment = (over: Partial<Moment> = {}): Moment => ({ today: TODAY, weather: null, minutes: null, equipment: [], people: null, ...over });
const bowls = sampleById("burrito-bowls")!;

const saved = (over: Partial<RecipeSummary>): RecipeSummary => ({
  id: "r1", title: "Kathy's Chili", authorName: "Kathy", ingredients: "2 cans black beans\n1 lb beef", instructions: "", notes: "",
  tags: [], suggestedTags: [], approxCalories: null, version: 1, createdAt: TODAY, updatedAt: TODAY,
  lastCookedOn: "", timesCooked: 0, favourite: false, ...over,
});

test("pantry: only claims an ingredient with evidence, asks about the rest", () => {
  const fit = pantryFit(bowls.ingredients, pantry, {}, TODAY);
  const by = (name: string) => fit.statuses.find((s) => s.ingredient.name === name)!.status;
  assert.deepEqual(by("black beans"), { state: "have", source: "pantry", evidence: "Pantry: 3 cans · Pantry shelf", useSoon: null });
  assert.equal(by("salsa").state, "out");                         // tracked, none left
  assert.equal(fit.headline, "Missing 1 thing · 4 to check");
  assert.deepEqual(by("cheddar cheese"), { state: "ask", question: "Do you have cheddar cheese?" });
  assert.equal(by("salt").state, "basic");                        // never claimed
  assert.notEqual(fit.headline, "You have everything for this");
});

test("pantry: 'you have everything' needs every non-basic ingredient confirmed", () => {
  const trail = sampleById("trail-mix")!;
  assert.notEqual(pantryFit(trail.ingredients, pantry, {}, TODAY).headline, "You have everything for this");
  const allYes = Object.fromEntries(trail.ingredients.map((i) => [i.name, "yes" as const]));
  assert.equal(pantryFit(trail.ingredients, pantry, allYes, TODAY).headline, "You have everything for this");
  // An answer outranks Pantry, and is labelled as the person's word.
  const s = ingredientStatus(bowls.ingredients[0], pantry, { "chicken thighs": "no" }, TODAY);
  assert.equal(s.state, "out");
});

test("pantry: with no Pantry at all, everything is a question — nothing is assumed", () => {
  const fit = pantryFit(bowls.ingredients, [], {}, TODAY);
  assert.equal(fit.have, 0);
  assert.equal(fit.ask, fit.total);
});

test("pantry: use-soon comes from best-before, not purchase order", () => {
  const soup = sampleById("lentil-veg-soup")!;
  const fit = pantryFit(soup.ingredients, pantry, {}, TODAY);
  assert.deepEqual(fit.useSoon, [{ name: "chicken stock", bestBefore: "2026-10-13" }]);
});

test("pantry: free-text family recipes only get 'possible' matches", () => {
  const m = possibleMatches("2 cans black beans\n1 lb beef\nSalsa", pantry);
  assert.deepEqual(m.map((x) => x.item.name), ["Black Beans"]); // salsa is tracked but out
});

test("suggestions: every sample comes with at least one reason", () => {
  for (const key of ["tonight", "pantry", "protein", "healthy", "quick", "bbq", "surprise"] as const) {
    const shelf = shelfFor(key, { samples: SAMPLE_IDEAS, saved: [], pantry, answers: {}, moment: moment(), seed: 7 });
    assert.ok(shelf.samples.length > 0, key);
    for (const s of shelf.samples) assert.ok(s.reasons.length > 0, `${key}: ${s.idea.id}`);
  }
});

test("suggestions: quick means quick, and the time the person gave is respected", () => {
  const quick = shelfFor("quick", { samples: SAMPLE_IDEAS, saved: [], pantry, answers: {}, moment: moment(), seed: 1 });
  assert.ok(quick.samples.every((s) => s.idea.minutes <= 30));
  const tonight = shelfFor("tonight", { samples: SAMPLE_IDEAS, saved: [], pantry, answers: {}, moment: moment({ minutes: 20 }) });
  assert.ok(tonight.samples[0].idea.minutes <= 20);
});

test("suggestions: favourites never invented — empty until the family records some", () => {
  const empty = shelfFor("favourites", { samples: SAMPLE_IDEAS, saved: [saved({})], pantry, answers: {}, moment: moment() });
  assert.equal(empty.samples.length, 0);
  assert.equal(empty.saved.length, 0);
  assert.match(empty.note!, /won't guess/);
  const fav = shelfFor("favourites", { samples: SAMPLE_IDEAS, saved: [saved({ favourite: true, timesCooked: 3, lastCookedOn: "2026-09-30" })], pantry, answers: {}, moment: moment() });
  assert.deepEqual(fav.saved[0].reasons, ["★ You marked it a favourite", "Cooked 3 times · last Sep 30"]);
});

test("suggestions: weather only counts when the person said so", () => {
  const none = shelfFor("tonight", { samples: SAMPLE_IDEAS, saved: [], pantry, answers: {}, moment: moment() });
  assert.ok(none.samples.every((s) => !s.reasons.some((r) => /hot day|chilly|rainy/.test(r))));
  const hot = shelfFor("tonight", { samples: SAMPLE_IDEAS, saved: [], pantry, answers: {}, moment: moment({ weather: "hot" }) });
  assert.ok(hot.samples[0].reasons.includes("Light and fresh for a hot day"));
});

test("conversation: the five example requests each lead to cards", () => {
  for (const ask of [
    "I need snacks for Emi's ski trip.",
    "Help me plan Thanksgiving dinner for eight.",
    "It's hot outside. What should we BBQ?",
    "I have black beans and chicken.",
    "Something healthy with lots of vegetables.",
  ]) {
    const r = simulateReply(ask, SAMPLE_IDEAS, [], TODAY);
    assert.ok(r.understood, ask);
    assert.ok(r.sampleIds.length >= 2, ask);
  }
});

test("conversation: Thanksgiving for eight is a menu scaled to 8", () => {
  const r = simulateReply("Help me plan Thanksgiving dinner for eight.", SAMPLE_IDEAS, [], TODAY);
  assert.equal(r.serves, 8);
  assert.equal(sampleById(r.sampleIds[0])!.course, "main");
  assert.ok(r.sampleIds.slice(1).every((id) => sampleById(id)!.course === "side"));
  assert.match(r.text, /Thanksgiving \(Canada\) is on Monday/);
});

test("conversation: 'I have chicken' confirms chicken, not chicken stock", () => {
  const r = simulateReply("I have black beans and chicken.", SAMPLE_IDEAS, [], TODAY);
  assert.deepEqual(r.answers, {
    "black beans": { said: "black beans" }, "chicken thighs": { said: "chicken" }, "chicken breasts": { said: "chicken" },
  });
  // …and Pantry check quotes their words, not a more specific claim.
  const s = ingredientStatus(bowls.ingredients[0], [], r.answers, TODAY);
  assert.deepEqual(s, { state: "have", source: "you-said", evidence: "You said you have chicken", useSoon: null });
  assert.equal(r.why["burrito-bowls"], "Uses black beans and chicken");
  // Merely mentioning an ingredient isn't saying you have it.
  assert.deepEqual(simulateReply("Something with chicken?", SAMPLE_IDEAS, [], TODAY).answers, {});
});

test("conversation: hot + BBQ sets the weather the person stated, and avoids the oven", () => {
  const r = simulateReply("It's hot outside. What should we BBQ?", SAMPLE_IDEAS, [], TODAY);
  assert.equal(r.moment.weather, "hot");
  assert.ok(r.sampleIds.every((id) => !sampleById(id)!.equipment.includes("oven")));
});

test("conversation: follow-ups build on the last request; unknown asks are answered honestly", () => {
  const r = simulateReply("We only have 30 minutes", SAMPLE_IDEAS, [], TODAY, "Something healthy with lots of vegetables.");
  assert.ok(r.sampleIds.every((id) => sampleById(id)!.minutes <= 30));
  const u = simulateReply("What wine goes with fish?", SAMPLE_IDEAS, [], TODAY);
  assert.equal(u.understood, false);
  assert.match(u.text, /only a prototype/);
});

test("conversation: grounding never invents preferences or weather", () => {
  const g = groundingFor(moment(), [], [], {});
  assert.ok(g.includes("Weather: not known (no weather feed)."));
  assert.ok(g.includes("Pantry: not connected."));
  assert.ok(g.includes("Preferences: none recorded — Kitchen won't assume any."));
  assert.equal(peopleIn("dinner for eight"), 8);
});

test("context: season and holidays from the date only", () => {
  assert.equal(seasonOf(TODAY), "autumn");
  assert.deepEqual(upcomingHolidays(TODAY).map((h) => [h.name, h.date]), [["Thanksgiving (Canada)", "2026-10-12"]]);
});

test("scaling is plain arithmetic with kitchen-friendly fractions", () => {
  assert.equal(formatQty(0.5), "½");
  assert.equal(formatQty(1.333), "1⅓");
  assert.equal(formatQty(2.0), "2");
  assert.equal(ingredientLine(scaleIngredient({ name: "rice", qty: 1.5, unit: "cups", kind: "pantry" }, 2)), "3 cups rice");
  assert.equal(ingredientLine(scaleIngredient({ name: "salt", qty: null, unit: "", kind: "basic" }, 2)), "salt");
});

test("nutrition: samples have none; a saved recipe's calories are labelled as typed in", () => {
  assert.deepEqual(nutritionForSample().perServing, {});
  for (const s of SAMPLE_IDEAS) assert.ok(!("nutrition" in s), s.id);
  const n = nutritionForSaved({ approxCalories: 550 });
  assert.equal(n.perServing.calories!.provenance, "entered");
  assert.equal(n.servingKnown, false);
  assert.equal(formatNutrient(n.perServing.calories!, "kcal"), "~550 kcal");
  assert.deepEqual(nutritionForSaved({ approxCalories: null }).perServing, {});
});

test("cook mode: free-text methods split into steps; timers take the low end of a range", () => {
  assert.deepEqual(stepsFromText("1. Chop onions\n\nStep 2: Fry them\n3) Serve"), ["Chop onions", "Fry them", "Serve"]);
  assert.equal(timerIn("Simmer 25 minutes, stirring"), 25);
  assert.equal(timerIn("Cook 6–7 minutes a side"), 6);
  assert.equal(timerIn("Roast about 1½ hours"), 90);
  assert.equal(timerIn("Season to taste"), null);
});
