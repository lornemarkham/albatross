// Start cooking: what was said → what Kitchen understood, did, and said back.
// The acceptance walk-through (a sausage cook, spoken quantities, a spoken
// correction, observations, a timer, a scale question) runs end to end on
// the pure session logic the cooking screen uses.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, durationIn, quantityAt, wordsToDigits } from "../src/lib/cooking/parse";
import { activeTimers, answer, finish, hear, newSession, scaleAnswer, setIngredient, stepsOf } from "../src/lib/cooking/session";
import { batchFromSession, recipeFromSession, sessionMediaIds, ingredientLines } from "../src/lib/cooking/summary";
import { SessionDrafts, DRAFTS_KEY, normalizeSession } from "../src/lib/cooking/drafts";
import { blankDetails } from "../src/lib/meat";
import type { Recipe } from "../src/types/recipe";
import type { CookingSession } from "../src/types/cooking";

const T0 = "2026-11-07T15:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const sausage: Recipe = {
  id: "r-sausage", title: "Garlic pork sausage", authorName: "Lorne",
  ingredients: "3 kg pork shoulder\n15 g black pepper\n4 cloves garlic\nHog casings",
  instructions: "1. Cube and chill the pork\n2. Grind through the 8 mm plate\n3. Mix in the seasoning for 2 minutes\n4. Stuff and link",
  notes: "", tags: [], suggestedTags: [], approxCalories: null, kind: "sausage", category: "Sausage", photos: [],
  details: { ...blankDetails(), meatType: "pork shoulder", meatWeightG: 3000, fatPercent: 25, seasoning: "Salt 1.8%\nBlack pepper 0.5%" },
  version: 1, createdAt: T0, updatedAt: T0,
};

function say(s: CookingSession, text: string, min: number, recipe: Recipe | null = sausage) {
  return hear(s, text, { recipe, source: "voice", now: at(min) });
}

test("parse: the brief's commands", () => {
  assert.deepEqual(parseCommand("Add 40 grams of salt."), { kind: "add", name: "salt", qty: { value: 40, unit: "g" } });
  assert.deepEqual(parseCommand("Change that to 35 grams."), { kind: "correct", target: null, qty: { value: 35, unit: "g" } });
  assert.deepEqual(parseCommand("Start a 20-minute timer."), { kind: "timer", seconds: 1200, label: "" });
  assert.deepEqual(parseCommand("What's the next step?"), { kind: "next-step" });
  assert.deepEqual(parseCommand("Read that again."), { kind: "repeat" });
  assert.deepEqual(parseCommand("Make a note for next time."), { kind: "note-prompt", category: "next-time" });
  assert.deepEqual(parseCommand("How much pepper do I need for 3 kilograms?"), { kind: "scale", ingredient: "pepper", amount: { value: 3, unit: "kg" } });
});

test("parse: everyday variations", () => {
  assert.equal(wordsToDigits("add forty grams of salt"), "add 40 grams of salt");
  assert.equal(wordsToDigits("two hundred and twenty five degrees"), "225 degrees");
  assert.deepEqual(parseCommand("add forty grams of salt"), { kind: "add", name: "salt", qty: { value: 40, unit: "g" } });
  assert.deepEqual(parseCommand("I added 2.5 kg pork shoulder"), { kind: "add", name: "pork shoulder", qty: { value: 2.5, unit: "kg" } });
  assert.deepEqual(parseCommand("half a teaspoon of cayenne"), { kind: "add", name: "cayenne", qty: { value: 0.5, unit: "tsp" } });
  assert.deepEqual(parseCommand("add salt, 40 grams"), { kind: "add", name: "salt", qty: { value: 40, unit: "g" } });
  assert.deepEqual(parseCommand("make the salt 30 grams"), { kind: "correct", target: "salt", qty: { value: 30, unit: "g" } });
  assert.deepEqual(parseCommand("no, 35 grams"), { kind: "correct", target: null, qty: { value: 35, unit: "g" } });
  assert.deepEqual(parseCommand("That should be 45 grams"), { kind: "correct", target: null, qty: { value: 45, unit: "g" } });
  assert.deepEqual(parseCommand("smoker at 225 degrees fahrenheit"), { kind: "temperature", what: "smoker", value: 225, unit: "F" });
  assert.deepEqual(parseCommand("internal temp is 152"), { kind: "temperature", what: "internal", value: 152, unit: null });
  assert.deepEqual(parseCommand("Using the number 8 plate"), { kind: "note", category: "equipment", text: "Number 8 plate" });
  assert.deepEqual(parseCommand("using 2 kg of pork"), { kind: "add", name: "pork", qty: { value: 2, unit: "kg" } });
  assert.deepEqual(parseCommand("It tastes a bit salty"), { kind: "note", category: "tasting", text: "It tastes a bit salty" });
  assert.deepEqual(parseCommand("Make a note for next time: less fennel"), { kind: "note", category: "next-time", text: "Less fennel" });
  assert.deepEqual(parseCommand("the casing split on the second link"), { kind: "note", category: "observation", text: "The casing split on the second link" });
  assert.deepEqual(parseCommand("stop listening"), { kind: "stop" });
  assert.equal(durationIn("set a timer for 1 hour 30 minutes"), 5400);
  assert.equal(durationIn("an hour and a half timer"), 5400);
  assert.deepEqual(quantityAt("1 1/2 tsp fennel"), { qty: { value: 1.5, unit: "tsp" }, rest: "fennel" });
});

test("acceptance: speak quantities, correct one by voice, observe, time, ask — nothing silent", () => {
  let s = newSession({ recipe: sausage, cookName: "Lorne", now: T0 });
  let r = say(s, "Add 3 kilograms of pork shoulder", 1);
  assert.equal(r.reply, "Added pork shoulder, 3 kilograms.");
  r = say(r.session, "Add 40 grams of salt.", 2);
  assert.equal(r.reply, "Added salt, 40 grams.");
  r = say(r.session, "Change that to 35 grams.", 3);
  assert.equal(r.reply, "Changed salt from 40 grams to 35 grams.");
  s = r.session;
  const salt = s.ingredients.find((i) => i.name === "salt")!;
  assert.deepEqual(salt.qty, { value: 35, unit: "g" });
  assert.deepEqual(salt.history.map((h) => [h.why, h.qty?.value]), [["said", 40], ["corrected", 35]]);
  // The original words are kept as heard.
  assert.deepEqual(s.transcript.map((l) => l.text), ["Add 3 kilograms of pork shoulder", "Add 40 grams of salt.", "Change that to 35 grams."]);
  assert.equal(s.transcript[2].understood, "Corrected salt: 40 g → 35 g");

  r = say(s, "What's the next step?", 4);
  assert.equal(r.reply, "Step 1 of 4. Cube and chill the pork");
  r = say(r.session, "Read that again.", 5);
  assert.equal(r.reply, "Step 1 of 4. Cube and chill the pork");
  r = say(r.session, "Start a 20-minute timer.", 6);
  assert.equal(r.reply, "Timer set for 20 minutes.");
  assert.equal(activeTimers(r.session)[0].label, "Step 1");
  r = say(r.session, "How much pepper do I need for 3 kilograms?", 7);
  assert.equal(r.reply, "Black pepper is 0.5% of the meat weight, so for 3 kilograms you need 15 grams.");
  r = say(r.session, "Using the 8 mm plate", 8);
  r = say(r.session, "The fat smeared a little on the second grind", 9);
  r = say(r.session, "Make a note for next time.", 10);
  assert.equal(r.reply, "Okay. What should we do differently next time?");
  r = say(r.session, "Chill the grinder head in the freezer first", 11);
  assert.equal(r.reply, "Note for next time saved.");
  r = say(r.session, "Tasting note: garlic is perfect, a touch more pepper", 40);
  r = say(r.session, "Internal temperature is 160 fahrenheit", 70);
  assert.match(r.reply, /^Internal 160 °F \(71 °C\) noted\.$/);
  s = finish(r.session, at(75));

  const b = batchFromSession(s, sausage);
  assert.equal(b.cookedOn, "2026-11-07");
  assert.equal(b.ingredientsUsed, "pork shoulder — 3 kg\nsalt — 35 g (said 40 g, corrected → 35 g)");
  assert.equal(b.substitutions, "");
  assert.equal(b.equipment, "8 mm plate");
  assert.equal(b.improveNextTime, "Chill the grinder head in the freezer first");
  assert.equal(b.tastingNotes, "Garlic is perfect, a touch more pepper");
  assert.equal(b.timesAndTemps, "15:06 Timer 20 minutes (Step 1)\n16:10 Internal 160 °F (71 °C)");
  assert.match(b.notes, /^Cooking session 15:00–16:15, 13 things said or typed\.\n15:09 The fat smeared a little on the second grind$/);
  assert.equal(b.details.internalTempC, 71.1);
  assert.equal(b.details.meatWeightG, 3000);
});

test("ambiguity: Kitchen asks, and only yes applies it", () => {
  let s = newSession({ recipe: sausage, cookName: "", now: T0 });
  // No unit.
  let r = say(s, "add 40 salt", 1);
  assert.equal(r.reply, "I heard 40 salt with no unit. Did you mean 40 grams of salt? Say yes or no.");
  assert.equal(r.session.ingredients.length, 0);
  r = say(r.session, "yes", 2);
  assert.equal(r.reply, "Added salt, 40 grams.");
  // A big jump (40 → 400: a likely mishearing) needs a yes.
  r = say(r.session, "change that to 400 grams", 3);
  assert.equal(r.reply, "That's a big change. Change salt from 40 grams to 400 grams? Say yes or no.");
  r = say(r.session, "no", 4);
  assert.equal(r.reply, "Okay, nothing changed.");
  assert.deepEqual(r.session.ingredients[0].qty, { value: 40, unit: "g" });
  // A correction with no unit keeps the unit but asks.
  r = say(r.session, "actually 35", 5);
  assert.equal(r.reply, "Change salt from 40 grams to 35 grams? Say yes or no.");
  s = answer(r.session, r.session.pending[0].id, true, at(6)).session;
  assert.deepEqual(s.ingredients[0].qty, { value: 35, unit: "g" });
  // Saying the same ingredient again: more, or a repeat?
  r = say(s, "add 10 grams of salt", 7);
  assert.equal(r.reply, "Salt is already 35 grams. Add another 10 grams, making 45 grams? Say yes or no.");
  r = say(r.session, "no", 8);
  assert.match(r.reply, /^Kept salt at 35 grams\./);
  // No "that" yet.
  r = say(newSession({ recipe: null, cookName: "", now: T0 }), "change that to 35 grams", 1, null);
  assert.equal(r.reply, "Which ingredient should be 35 grams? Say, for example, “change the salt to 35 grams”.");
  // A temperature with no unit.
  r = say(s, "internal temp is 152", 9);
  assert.match(r.reply, /^Internal 152 degrees — is that Fahrenheit\?/);
  r = say(r.session, "yes", 10);
  assert.equal(r.reply, "Internal 152 °F (67 °C) noted. That's below the 71 °C (160 °F) safe internal temperature.");
  // Removing a measurement asks too.
  r = say(r.session, "remove the salt", 11);
  assert.equal(r.reply, "Remove salt (35 g) from this cook? Say yes or no.");
  r = say(r.session, "yes", 12);
  assert.equal(r.session.ingredients[0].removed, true);
  assert.equal(ingredientLines(r.session).length, 0);
});

test("scale questions only use what the recipe says", () => {
  assert.equal(scaleAnswer(sausage, "salt", { value: 5, unit: "kg" }), "Salt is 1.8% of the meat weight, so for 5 kilograms you need 90 grams.");
  assert.equal(scaleAnswer(sausage, "garlic", { value: 6, unit: "kg" }), "The recipe uses 4 cloves of garlic for 3 kilograms of meat, so for 6 kilograms: 8 cloves.");
  assert.equal(scaleAnswer(sausage, "sage", { value: 3, unit: "kg" }), "This recipe doesn't give an amount for sage that I can scale, so I won't guess.");
  assert.equal(scaleAnswer(sausage, "salt", { value: 3, unit: "cup" }), "I can only scale by weight. Say it in grams, kilograms or pounds.");
});

test("steps, timers, stop", () => {
  let s = newSession({ recipe: sausage, cookName: "", now: T0 });
  assert.equal(stepsOf(sausage).length, 4);
  for (let i = 0; i < 4; i++) s = say(s, "next step", i).session;
  let r = say(s, "next step", 5);
  assert.equal(r.reply, "That was the last step.");
  r = say(r.session, "go back", 6);
  assert.equal(r.reply, "Step 4 of 4. Stuff and link");
  r = say(r.session, "set a timer for 90 seconds for the casings", 7);
  assert.equal(r.reply, "Timer set for 1 minute 30 seconds (casings).");
  r = say(r.session, "how long is left", 7.5);
  assert.equal(r.reply, "Casings: 1 minute left.");
  r = say(r.session, "cancel the timer", 8);
  assert.equal(activeTimers(r.session).length, 0);
  r = say(r.session, "stop listening", 9);
  assert.equal(r.stopListening, true);
});

test("a cook with no recipe becomes a recipe draft; manual edits are kept as history", () => {
  let s = newSession({ recipe: null, title: "Saturday jerky", cookName: "Lorne", now: T0 });
  s = say(s, "add 1 kg beef eye of round", 1, null).session;
  const id = s.ingredients[0].id;
  s = setIngredient(s, { ingredientId: id, name: "beef eye of round", qty: { value: 1.2, unit: "kg" }, why: "edited", now: at(2), lineId: null });
  s = say(s, "next time slice it thinner", 3, null).session;
  const r = recipeFromSession(s, "");
  assert.equal(r.title, "Saturday jerky");
  assert.equal(r.ingredients, "1.2 kg beef eye of round");
  assert.equal(r.notes, "Slice it thinner");
  assert.equal(batchFromSession(s, null).ingredientsUsed, "beef eye of round — 1.2 kg (said 1 kg, edited → 1.2 kg)");
  assert.deepEqual(s.events.filter((e) => e.kind === "ingredient").map((e) => e.kind === "ingredient" && e.action), ["said", "edited"]);
});

test("drafts: kept on the device, survive a reload, never silently deleted", () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const drafts = new SessionDrafts(storage);
  const s = say(newSession({ recipe: sausage, cookName: "", now: T0 }), "add 40 grams of salt", 1).session;
  drafts.put(s);
  const again = new SessionDrafts(storage).get(s.id);
  assert.deepEqual(again, normalizeSession(JSON.parse(JSON.stringify(s))));
  assert.equal(drafts.unsaved().length, 1);
  drafts.discard(s.id);
  assert.equal(drafts.list().length, 0);
  assert.ok(mem.get(`${DRAFTS_KEY}-discarded-${s.id}`), "a discarded cook is set aside, not deleted");
  // A corrupted value is set aside before being replaced.
  mem.set(DRAFTS_KEY, "{not json");
  drafts.put(s);
  assert.ok([...mem.keys()].some((k) => k.startsWith(`${DRAFTS_KEY}-unreadable-`)));
});

test("session media are included in backups", () => {
  let s = newSession({ recipe: sausage, cookName: "", now: T0 });
  s = { ...s, events: [...s.events, { id: "e1", at: T0, kind: "media", media: { id: "v1.webm", type: "video", mime: "video/webm", caption: "", addedAt: T0, finished: false } }] };
  assert.deepEqual(sessionMediaIds(s), ["v1.webm"]);
});

test("cooking companion: substitutions are recorded and land in the batch's substitutions", () => {
  assert.deepEqual(parseCommand("I used butter instead of olive oil"), { kind: "substitution", used: "butter", insteadOf: "olive oil" });
  assert.deepEqual(parseCommand("Swapped the hog casings for sheep casings"), { kind: "substitution", used: "sheep casings", insteadOf: "hog casings" });
  assert.deepEqual(parseCommand("We're out of garlic so I used garlic powder"), { kind: "substitution", used: "garlic powder", insteadOf: "garlic" });
  let s = newSession({ recipe: sausage, cookName: "Lorne", now: T0 });
  const r = say(s, "Substitute smoked paprika for black pepper", 1);
  s = r.session;
  assert.equal(r.reply, "Substitution noted: smoked paprika instead of black pepper.");
  assert.equal(s.ingredients.length, 0, "a substitution never changes amounts by itself");
  assert.match(batchFromSession(finish(s, at(5)), sausage).substitutions, /^Smoked paprika instead of black pepper/);
});

test("cooking companion: 'double the recipe' reads the recipe's own amounts back, and changes nothing", () => {
  assert.deepEqual(parseCommand("Double the recipe"), { kind: "scale-recipe", factor: 2 });
  assert.deepEqual(parseCommand("half the batch please"), { kind: "scale-recipe", factor: 0.5 });
  const s = newSession({ recipe: sausage, cookName: "Lorne", now: T0 });
  const r = say(s, "double the recipe", 1);
  assert.match(r.reply, /^Doubled, from the recipe's own amounts: 6 kg pork shoulder; 30 g black pepper; 8 cloves garlic; Hog casings \(no amount written\)/);
  assert.deepEqual(r.session.ingredients, s.ingredients);
});

test("cooking companion: questions are answered from the recipe's text, or honestly not", () => {
  assert.equal(parseCommand("What plate do I grind through?").kind, "question");
  const s = newSession({ recipe: sausage, cookName: "Lorne", now: T0 });
  assert.equal(say(s, "Which plate do I grind through?", 1).reply, "The recipe says: Grind through the 8 mm plate");
  assert.match(say(s, "What wine goes with this?", 1).reply, /doesn't say/);
  // Notes stay notes; questions never become stored notes.
  assert.equal(parseCommand("The casing is a bit dry").kind, "note");
  assert.equal(say(s, "How long do I mix?", 1).session.events.filter((e) => e.kind === "note").length, 0);
});

test("cooking companion: an ingredient section is answered whole; a recipe without amounts isn't 'scaled'", () => {
  const bowl: Recipe = { ...sausage, id: "bowl", kind: "general", instructions: "Toss everything.", ingredients: "Romaine\nCarrot\n\nDressing:\nSoy sauce\nSesame oil\nVinegar" };
  const s = newSession({ recipe: bowl, cookName: "Lorne", now: T0 });
  assert.equal(say(s, "What goes in the dressing?", 1, bowl).reply, "The recipe says: Dressing: Soy sauce, Sesame oil, Vinegar");
  assert.match(say(s, "double the recipe", 1, bowl).reply, /doesn't write down amounts/);
});
