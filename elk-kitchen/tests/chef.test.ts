// Kitchen's chef (M639): understanding what people say, grounding it in what
// Inventory and Kitchen's own records show, dish ideas with what's missing,
// family tastes per person, the AI's answer checked against the evidence, and
// cooking a suggested dish through to a saved recipe. The real-world test uses
// the actual Sausage Day seed (the four handwritten recipes, closed with
// Potato / Breakfast / Bratwurst made on 2026-11-07).
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { PlanStore } from "../src/lib/sausage/preferences";
import { SessionDrafts } from "../src/lib/cooking/drafts";
import { ensureSausageDay } from "../src/lib/sausage/today";
import { finishSausageDay } from "../src/lib/sausage/record";
import { VersionStore } from "../src/lib/sausage/versions";
import { cookingHistory } from "../src/lib/cooking/history";
import { parseMentions, parseOccasion } from "../src/lib/chef/mentioned";
import { buildKnowledge, recentlyMade, zoneOf } from "../src/lib/chef/knowledge";
import { chef } from "../src/lib/chef/chef";
import { familyTaste, leaningsIn, tasteFacts } from "../src/lib/chef/familyTaste";
import { askChef, checkChefReply, chefRequestFrom, ideaFromAi, parseChefRequest, type ChefAiRequest } from "../src/lib/chef/ai";
import { handle } from "../api/companion";
import { draftRecipe, newSession, stepsOf } from "../src/lib/cooking/session";
import { recipeFromSession } from "../src/lib/cooking/summary";
import { reviewLines } from "../src/lib/companion/shopping";
import type { PantryItem } from "../src/lib/pantry";
import type { MealFeedback } from "../src/types/feedback";
import type { CookDraft } from "../src/types/cooking";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const T_DAY = "2026-11-07T19:00:00.000Z";
const T_DONE = "2026-11-07T23:30:00.000Z";
const TODAY = "2026-11-08";
const GAME_DAY = "I made bratwurst yesterday. I also have nacho chips and cheese. What can I make for game day?";

const item = (name: string, onHand: number, unit: string, location: string, bestBefore: string | null, over: Partial<PantryItem> = {}): PantryItem =>
  ({ name, onHand, unit, location, bestBefore, places: [{ location, quantity: onHand, bestBefore }], lowStockAt: null, ...over });
// What Inventory shows in this household today.
const PANTRY: PantryItem[] = [
  item("Sour cream", 1, "tubs", "Fridge", "2026-11-10"),
  item("Jalapeños", 1, "jars", "Pantry shelf", null, { opened: true }),
  item("Salsa", 1, "jars", "Fridge", "2026-11-01"), // past its date
  item("Hamburger buns", 1, "bags", "Chest freezer", "2027-01-15"),
  item("Mustard", 1, "bottles", "Fridge", null),
  item("Black beans", 0, "cans", "Pantry", null),
];

// The real Sausage Day: seeded, then closed with three made, then a family recipe or two.
async function sausageDayHousehold() {
  const storage = new Mem();
  const store = new DeviceRecipeStore(storage, () => T_DAY);
  const plans = new PlanStore(storage);
  const plan0 = await ensureSausageDay(store, plans, T_DAY, "Lorne");
  await finishSausageDay(store, plans, new SessionDrafts(storage), plan0, [{ title: "Potato Sausage" }, { title: "Breakfast Sausage" }, { title: "Bratwurst" }], T_DONE, "Lorne");
  await store.createRecipe({ title: "Weeknight Chili", authorName: "Lorne", ingredients: "1 lb ground beef\n1 can black beans\n1 onion", instructions: "Simmer.", notes: "", tags: ["dinner"], suggestedTags: [], approxCalories: null, kind: "general", category: "", photos: [], details: (await store.listRecipes())[0].details });
  const recipes = await store.listRecipes();
  const history = await cookingHistory(store, 40);
  return { storage, store, plans, recipes, history };
}

const noTaste = () => familyTaste({ recipes: [], feedback: [] });

// ── P1: what people say ─────────────────────────────────────────────────────
test("P1: the brief's phrases are understood as the person's words — names, amounts as said, intent", () => {
  const got = (t: string) => parseMentions(t).map((m) => [m.intent, m.name, m.amount, m.when]);
  assert.deepEqual(got("I have nacho chips."), [["have", "nacho chips", "", ""]]);
  assert.deepEqual(got("There's half a bag of cheese."), [["have", "cheese", "half a bag", ""]]);
  assert.deepEqual(got("I found some peppers."), [["have", "peppers", "", ""]]);
  assert.deepEqual(got("We need to use the sour cream."), [["use", "sour cream", "", ""]]);
  assert.deepEqual(got(GAME_DAY), [["made", "bratwurst", "", "yesterday"], ["have", "nacho chips", "", ""], ["have", "cheese", "", ""]]);
  assert.deepEqual(got("I have bratwurst, nacho chips, cheese and sour cream. Give me something awesome for game day.").map((x) => x[1]), ["bratwurst", "nacho chips", "cheese", "sour cream"]);
  assert.equal(parseMentions("There's a tub of sour cream in the fridge")[0].where, "fridge");
  assert.deepEqual(parseOccasion(GAME_DAY), { occasion: "game day", snack: true });
  assert.equal(parseMentions("I have no time and 20 minutes").length, 0);
  // One sentence, two clauses: each is read on its own.
  assert.deepEqual(got("I have nacho chips and there's half a bag of cheese."), [["have", "nacho chips", "", ""], ["have", "cheese", "half a bag", ""]]);
  assert.deepEqual(got("We've got peppers and I found some sour cream"), [["have", "peppers", "", ""], ["have", "sour cream", "", ""]]);
});

// ── P0 / P1: what Kitchen knows, and how ────────────────────────────────────
test("P0: Inventory is sorted into fridge, freezer, pantry; use-soon, opened and past-date are kept apart; said ≠ stock", () => {
  assert.equal(zoneOf("Chest freezer"), "freezer");
  assert.equal(zoneOf("Fridge door"), "fridge");
  assert.equal(zoneOf("Pantry shelf"), "pantry");
  assert.equal(zoneOf("Garage"), "storage");
  const k = buildKnowledge({ pantry: PANTRY, recent: [], said: parseMentions("There's half a bag of cheese. We need to use the sour cream."), today: TODAY });
  assert.deepEqual(k.byZone.fridge.map((h) => h.name), ["Sour cream", "Salsa", "Mustard"]);
  assert.deepEqual(k.byZone.freezer.map((h) => h.name), ["Hamburger buns"]);
  assert.deepEqual(k.byZone.pantry.map((h) => h.name), ["Jalapeños"]);
  assert.ok(!k.have.some((h) => h.name === "Black beans"), "none left is not 'have'");
  assert.deepEqual(k.expired.map((h) => h.name), ["Salsa"]);
  // Use soon: what they asked to use first, then by date, then opened.
  assert.deepEqual(k.useSoon.map((h) => h.name), ["Sour cream", "Jalapeños"]);
  const sour = k.have.find((h) => h.name === "Sour cream")!;
  assert.equal(sour.source, "inventory");
  assert.equal(sour.evidence, "Pantry: 1 tubs · Fridge · best before in 2 days");
  const cheese = k.have.find((h) => h.name === "cheese")!;
  assert.equal(cheese.source, "said");
  assert.equal(cheese.evidence, "You said: half a bag — not in Inventory");
  // "cheese" said is not Inventory's cream cheese (a near name stays separate).
  const k2 = buildKnowledge({ pantry: [item("Cream cheese", 1, "blocks", "Fridge", null)], recent: [], said: parseMentions("I have cheese"), today: TODAY });
  assert.deepEqual(k2.have.map((h) => [h.name, h.source]), [["Cream cheese", "inventory"], ["cheese", "said"]]);
});

// ── The required real-world test ────────────────────────────────────────────
test("REAL WORLD: 'I made bratwurst yesterday…' — recognises the Sausage Day bratwurst, the said chips and cheese, checks Inventory, three real game-day snacks, explains what's missing", async () => {
  const { recipes, history, plans } = await sausageDayHousehold();
  const recent = recentlyMade(history, plans.list(), PANTRY, TODAY);
  assert.ok(recent.some((r) => r.title === "Bratwurst" && r.daysAgo === 1), JSON.stringify(recent));

  const a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: PANTRY, recent, feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  // 1. The bratwurst is Kitchen's own record of yesterday, not the person's say-so.
  const brat = a.understood.find((u) => u.name === "Bratwurst")!;
  assert.equal(brat.source, "recent");
  assert.match(brat.how, /^made yesterday — /);
  // 2. Nacho chips and cheese are the person's words, not stock.
  assert.deepEqual(a.understood.filter((u) => u.source === "said").map((u) => u.name), ["nacho chips", "cheese"]);
  // 3. Inventory is checked: sour cream (use soon) and the opened jalapeños are used; the past-date salsa isn't.
  assert.equal(a.occasion, "game day");
  assert.match(a.reply, /Inventory also has sour cream, jalapeños, mustard and hamburger buns/);
  assert.ok(a.cautions.some((c) => /Past best-before in Pantry: Salsa/.test(c)));
  for (const i of a.ideas) assert.ok(!i.ingredients.some((x) => x.status === "have" && x.name === "Salsa"), `${i.title} used expired salsa`);
  // 4. Three genuinely different snack ideas built on the bratwurst — not sausage recipes.
  assert.deepEqual(a.ideas.map((i) => i.title), ["Loaded bratwurst nachos", "Bratwurst bites with dipping sauces", "Bratwurst sliders with peppers and onions"]);
  assert.ok(a.ideas.every((i) => i.ingredients.some((x) => x.name === "Bratwurst" && x.status === "have" && x.source === "recent")));
  assert.ok(!a.family.some((s) => s.recipe.kind === "sausage"), "the sausage recipes themselves are not offered as snacks");
  const [nachos, , sliders] = a.ideas;
  assert.equal(nachos.why[0], "You have 3 of the 3 main ingredients (nacho chips, cheese, bratwurst), plus sour cream, jalapeños.");
  assert.ok(nachos.why.includes("Uses the bratwurst — made yesterday."));
  assert.ok(nachos.why.includes("Uses the sour cream — best before in 2 days."));
  assert.ok(sliders.ingredients.some((x) => x.name === "Hamburger buns" && x.evidence === "Pantry: 1 bags · Chest freezer · best before in 68 days"));
  assert.ok(nachos.safety.some((s) => /71 °C/.test(s)), "homemade sausage is raw: cook it through");
  // 5. What's missing is explained: here nothing essential, the extras are named, and the expired salsa says why.
  assert.ok(a.ideas.every((i) => i.missing.length === 0));
  assert.deepEqual(nachos.niceToHave, ["salsa", "onion", "black beans"]);
  assert.equal(nachos.ingredients.find((x) => x.name === "salsa")!.evidence, "Inventory's salsa is past its best-before — check it, or get more");
  assert.match(a.reply, /You have what these need; nice extras if you want them: salsa, onion, black beans and bbq sauce\./);
  const lines = reviewLines(nachos.niceToHave, ["Onion"], PANTRY);
  assert.deepEqual(lines.map((l) => [l.name, l.onList, l.pantryNote]), [["salsa", false, "Pantry still shows 1 jars of Salsa — update it in Pantry if that's wrong"], ["onion", true, "Pantry has no record of it"], ["black beans", false, "Pantry shows none left of Black beans"]]);
  // 6. Offers to put the said foods into Inventory (asks first; nothing is written here).
  assert.deepEqual(a.offerToInventory.map((m) => m.name), ["bratwurst", "nacho chips", "cheese"]);
});

test("conversation: what was said earlier carries into the next question; picking from lists works like saying it", async () => {
  const { recipes, history, plans } = await sausageDayHousehold();
  const recent = recentlyMade(history, plans.list(), PANTRY, TODAY);
  const one = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: PANTRY, recent, feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  const two = chef({ text: "Something quicker?", earlier: one.mentioned, picked: [], recipes, pantry: PANTRY, recent, feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  assert.ok(two.ideas.some((i) => i.ingredients.some((x) => x.name === "nacho chips" && x.status === "have")));
  const picked = chef({ text: "What can I make with Hamburger buns, Mustard?", earlier: [], picked: [{ name: "Hamburger buns", amount: "", intent: "have", when: "", where: "", said: "Picked" }], recipes, pantry: PANTRY, recent, feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  assert.ok(picked.ideas.some((i) => i.title.startsWith("Bratwurst sliders")));
});

test("shortages: missing essentials are named per dish, said plainly, and go to the shopping list ticked (extras unticked)", async () => {
  const { recipes, history, plans } = await sausageDayHousehold();
  const pantry = PANTRY.filter((p) => p.name !== "Hamburger buns" && p.name !== "Mustard");
  const a = chef({ text: "I made bratwurst yesterday and there's half a bag of cheese. Game day snacks?", earlier: [], picked: [], recipes, pantry, recent: recentlyMade(history, plans.list(), pantry, TODAY), feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  const nachos = a.ideas.find((i) => i.title === "Loaded bratwurst nachos")!;
  assert.deepEqual(nachos.missing, ["nacho chips"]);
  assert.equal(nachos.ingredients.find((x) => x.name === "nacho chips")!.evidence, "not in Inventory and you didn't mention it");
  assert.equal(nachos.ingredients.find((x) => x.name === "cheese")!.evidence, "You said: half a bag — not in Inventory");
  assert.match(a.reply, /Some need a thing or two you don't have \(.*nacho chips.*\)\. I can add those to the shopping list\./);
  const lines = [...reviewLines(nachos.missing, [], pantry), ...reviewLines(nachos.niceToHave, [], pantry).map((l) => ({ ...l, selected: false }))];
  assert.deepEqual(lines.filter((l) => l.selected).map((l) => l.name), ["nacho chips"]);
});

test("shortages: with nothing but chips, Kitchen offers nothing it can't back up, and says so", () => {
  const a = chef({ text: "I have nacho chips. Game day snacks?", earlier: [], picked: [], recipes: [], pantry: [], recent: [], feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  assert.equal(a.ideas.length, 0, "one ingredient isn't 'from what you have'");
  assert.match(a.reply, /Nothing I know fits well yet/);
});

// ── P3: family intelligence ─────────────────────────────────────────────────
const fbk = (over: Partial<MealFeedback>): MealFeedback => ({
  id: Math.random().toString(36).slice(2), entryId: "e1", recipeId: "brat", authorName: "Lorne", rating: null, scores: { flavour: null, seasoning: null, texture: null, juiciness: null },
  comment: "", improvement: "", makeAgain: null, photos: [], source: "app", version: 1, history: [], createdAt: "2026-11-08T12:00:00Z", updatedAt: "2026-11-08T12:00:00Z", mine: false, ...over,
});

test("P3: conflicting preferences — each person is their own; one rating is never 'the family'; a split is named; seasoning notes are quoted", async () => {
  const recipes = [{ id: "brat", title: "Bratwurst", favourite: false }, { id: "chili", title: "Weeknight Chili", favourite: false }];
  const feedback = [
    fbk({ authorName: "Lorne", rating: 9, makeAgain: "yes" }),
    fbk({ authorName: "Kathy", rating: 4, makeAgain: "no", improvement: "A little less salt. And not as spicy." }),
    fbk({ recipeId: "chili", entryId: "e2", authorName: "Lorne", rating: 9 }),
  ];
  const t = familyTaste({ recipes, feedback, profiles: [{ key: "k", name: "Kathy", avoids: "jalapeños", likes: "", notes: "", updatedAt: "", mine: false }] });
  const kathy = t.people.find((p) => p.name === "Kathy")!;
  assert.deepEqual(kathy.leanings.map((l) => [l.about, l.direction]), [["salt", "less"], ["heat", "less"]]);
  assert.deepEqual(kathy.notForMe.map((n) => n.title), ["Bratwurst"]);
  assert.deepEqual(t.split.map((s) => [s.title, s.loved, s.not]), [["Bratwurst", ["Lorne"], ["Kathy"]]]);
  assert.deepEqual(t.favourites, [], "Lorne's 9 on the chili is Lorne's, not a household favourite");
  assert.ok(tasteFacts(t).includes("Lorne loved: Bratwurst (9/10), Weeknight Chili (9/10)"));

  // Used in the next suggestion: the split is flagged, Kathy's notes shape the dish.
  const { recipes: rs, history, plans } = await sausageDayHousehold();
  const brat = rs.find((r) => r.title === "Bratwurst")!;
  const t2 = familyTaste({ recipes: rs, feedback: feedback.map((f) => ({ ...f, recipeId: f.recipeId === "brat" ? brat.id : f.recipeId })), profiles: [{ key: "k", name: "Kathy", avoids: "jalapeños", likes: "", notes: "", updatedAt: "", mine: false }] });
  const a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes: rs, pantry: PANTRY, recent: recentlyMade(history, plans.list(), PANTRY, TODAY), feedback: [], profiles: [], taste: t2, today: TODAY });
  assert.ok(a.cautions.some((c) => /^Bratwurst split the family: Lorne loved it; Kathy didn't/.test(c)));
  const notes = a.ideas[0].familyNotes.join(" | ");
  assert.match(notes, /⚠ Kathy avoids jalapeños/);
  assert.match(notes, /Kathy on Bratwurst: “A little less salt” — go easy on the salt here/);
  assert.match(notes, /Lorne rated Bratwurst 9\/10/);
});

test("P3: household favourites need two people; a new version only 'worked' if the same people rated it higher", () => {
  const recipes = [{ id: "v1", title: "Bratwurst", favourite: false }, { id: "v2", title: "Bratwurst v2", favourite: false }];
  const feedback = [
    fbk({ recipeId: "v1", authorName: "Lorne", rating: 7 }), fbk({ recipeId: "v1", authorName: "Kathy", rating: 5 }),
    fbk({ recipeId: "v2", entryId: "e2", authorName: "Lorne", rating: 9, makeAgain: "yes" }), fbk({ recipeId: "v2", entryId: "e2", authorName: "Kathy", rating: 8, makeAgain: "yes" }),
  ];
  const t = familyTaste({ recipes, feedback, versions: [{ recipeId: "v2", parentId: "v1", label: "v2", reason: "less salt", createdAt: "", by: "Lorne" }] });
  assert.deepEqual(t.favourites.map((f) => [f.title, f.average]), [["Bratwurst v2", 8.5]]);
  assert.deepEqual(t.improvedVersions.map((v) => [v.title, v.before, v.after, v.reason]), [["Bratwurst v2", 6, 8.5, "less salt"]]);
  assert.deepEqual(t.worthRepeating.map((w) => w.title), ["Bratwurst v2"]);
  assert.deepEqual(leaningsIn("Perfect as is", "x"), []);
});

// ── P2: the AI chef, checked against the evidence ───────────────────────────
async function gameDayRequest(): Promise<ChefAiRequest> {
  const { recipes, history, plans } = await sausageDayHousehold();
  const a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: PANTRY, recent: recentlyMade(history, plans.list(), PANTRY, TODAY), feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  return chefRequestFrom(a, GAME_DAY, [], ["Kathy wrote about Bratwurst: \"a little less salt\" (wants less salt)"]);
}

test("P2: the request carries evidence with its source, never the expired food as 'have', and no sausage recipes as dishes", async () => {
  const req = await gameDayRequest();
  assert.equal(req.mode, "chef");
  assert.deepEqual(req.have.filter((h) => h.source !== "inventory").map((h) => [h.name, h.source]), [["Bratwurst", "recent"], ["Breakfast Sausage", "recent"], ["Potato Sausage", "recent"], ["nacho chips", "said"], ["cheese", "said"]]);
  assert.ok(!req.have.some((h) => h.name === "Salsa"));
  assert.ok(req.expired[0].startsWith("Salsa"));
  assert.ok(req.familyRecipes.every((r) => !/Sausage|Bratwurst|Smokies/.test(r.title)), req.familyRecipes.map((r) => r.title).join());
  assert.deepEqual(parseChefRequest(JSON.parse(JSON.stringify(req))), req, "the server reads back exactly what was sent");
  assert.equal(parseChefRequest({ mode: "chef", question: "" }), null);
});

test("P2: the model can't claim food Kitchen has no evidence for, can't use expired food, can't invent recipe ids", async () => {
  const req = await gameDayRequest();
  const reply = checkChefReply({
    reply: "Brat nachos!", followUps: ["Something lighter?"],
    picks: [{ recipeId: "made-up", why: "x" }],
    recipes: [{
      title: "Bratwurst Nacho Platter", why: "Uses yesterday's brats.", minutes: 25, serves: "6",
      ingredients: [
        { name: "bratwurst", amount: "4 links", have: true },
        { name: "shredded cheese", amount: "2 cups", have: true },   // said "cheese": yes
        { name: "cream cheese", amount: "4 oz", have: true },        // not the same food: no
        { name: "avocado", amount: "1", have: true },                // never mentioned: no
        { name: "salsa", amount: "1 cup", have: true },              // past its date: no
        { name: "sour cream", amount: "½ cup", have: true },         // Inventory: yes
        { name: "salt", amount: "pinch", have: false },
      ],
      steps: ["Cook the brats.", "Layer.", "Bake."], tips: ["Cook homemade bratwurst to 71 °C first."],
    }],
  }, req);
  assert.deepEqual(reply.picks, []);
  assert.deepEqual(reply.recipes[0].ingredients.map((i) => [i.name, i.have]),
    [["bratwurst", true], ["shredded cheese", true], ["cream cheese", false], ["avocado", false], ["salsa", false], ["sour cream", true], ["salt", false]]);
  const idea = ideaFromAi(reply.recipes[0], req, 0);
  assert.equal(idea.kind, "ai-generated");
  assert.deepEqual(idea.missing, ["cream cheese", "avocado", "salsa"]);
  assert.equal(idea.ingredients.find((i) => i.name === "sour cream")!.evidence, "Pantry: 1 tubs · Fridge · best before in 2 days");
  assert.equal(idea.ingredients.find((i) => i.name === "bratwurst")!.source, "recent");
  assert.equal(idea.ingredients.find((i) => i.name === "salt")!.status, "basic");
  assert.ok(idea.safety.some((s) => /71 °C/.test(s)));
});

const ENV = { openaiKey: "test-key", supabaseUrl: "https://db.example", anonKey: "anon" };
const post = (body: unknown, token: string | null = "tok") =>
  new Request("https://kitchen.example/api/companion", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test("P2: /api/companion chef mode — family-only before the key is touched, model configurable, answer re-checked, key never returned", async () => {
  const req = await gameDayRequest();
  const calls: { url: string; body?: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string });
    if (String(url).includes("elk_is_family_member")) return new Response(JSON.stringify(calls.length > 0 && !String(init?.headers && (init.headers as Record<string, string>).Authorization).includes("stranger")), { status: 200 });
    return new Response(JSON.stringify({ usage: { prompt_tokens: 3000, completion_tokens: 900 }, choices: [{ message: { content: JSON.stringify({ reply: "Nachos!", picks: [], followUps: [], recipes: [{ title: "Nachos", why: "", minutes: 20, serves: "4", ingredients: [{ name: "avocado", amount: "1", have: true }], steps: ["Bake."], tips: [] }] }) } }] }), { status: 200 });
  }) as typeof fetch;
  // A stranger never reaches the model.
  const no = await handle(post(req, "stranger"), { ...ENV, fetchImpl: f });
  assert.equal(no.status, 403);
  assert.ok(!calls.some((c) => c.url.includes("openai")));
  // AI off (no key) → 503, so the page keeps Kitchen's own ideas.
  assert.equal((await handle(post(req), { ...ENV, openaiKey: undefined, fetchImpl: f })).status, 503);
  // A family member gets a checked answer; the model can be set without a code change.
  const res = await handle(post(req), { ...ENV, model: "gpt-4.1-mini", fetchImpl: f });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("test-key"));
  const body = JSON.parse(text);
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(body.reply.recipes[0].ingredients[0].have, false, "server drops the unsupported 'have'");
  const sent = JSON.parse(calls.find((c) => c.url.includes("openai"))!.body!);
  assert.equal(sent.model, "gpt-4.1-mini");
  assert.equal(sent.response_format.json_schema.name, "kitchen_chef");
  assert.equal(JSON.parse(sent.messages[1].content).have.find((h: { name: string }) => h.name === "nacho chips").source, "said");
});

test("unavailable AI and offline: the browser says so plainly, and Kitchen's own answer is unaffected", async () => {
  const req = await gameDayRequest();
  const off = await askChef(req, "tok", (async () => new Response(JSON.stringify({ error: "Kitchen's AI isn't switched on yet." }), { status: 503 })) as typeof fetch);
  assert.deepEqual(off, { ok: false, off: true, error: "Kitchen's AI isn't switched on yet." });
  const down = await askChef(req, "tok", (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch);
  assert.equal(down.ok, false);
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  try {
    let called = false;
    const offline = await askChef(req, "tok", (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    assert.equal(offline.ok, false);
    assert.equal(called, false, "no request is attempted offline");
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav); else delete (globalThis as { navigator?: unknown }).navigator;
  }
  // No Inventory either (offline / signed out): ideas still come from Kitchen's record and what was said.
  const { recipes, history, plans } = await sausageDayHousehold();
  const a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: null, recent: recentlyMade(history, plans.list(), null, TODAY), feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  assert.match(a.reply, /Inventory isn't connected here/);
  assert.equal(a.ideas[0].title, "Loaded bratwurst nachos");
  assert.deepEqual(a.offerToInventory, [], "nothing to offer to an Inventory that isn't connected");
});

// ── P5: cook the chosen idea, then it becomes a recipe only when saved ─────
test("P5: cooking a suggested dish — the idea guides the cook, and is saved as a new, labelled recipe only on review", async () => {
  const { recipes, history, plans, store } = await sausageDayHousehold();
  const a = chef({ text: GAME_DAY, earlier: [], picked: [], recipes, pantry: PANTRY, recent: recentlyMade(history, plans.list(), PANTRY, TODAY), feedback: [], profiles: [], taste: noTaste(), today: TODAY });
  const idea = a.ideas[0];
  const draft: CookDraft = { origin: "kitchen-idea", title: idea.title, question: GAME_DAY, ingredients: idea.ingredients.map((i) => ({ name: i.name, amount: i.amount, status: i.status, evidence: i.evidence })), steps: idea.steps, safety: idea.safety, why: idea.why, model: "", createdAt: "2026-11-08T21:00:00.000Z" };
  const s = newSession({ recipe: null, title: idea.title, cookName: "Lorne", now: "2026-11-08T21:00:00.000Z", draft });
  assert.equal(s.recipeId, null);
  assert.equal(s.recipeTitle, "Loaded bratwurst nachos");
  const stand = draftRecipe(s)!;
  assert.equal(stand.id, "", "the idea is never a saved recipe while cooking");
  assert.equal(stepsOf(stand).length, idea.steps.length);
  const before = (await store.listRecipes()).length;
  const input = recipeFromSession(s, "");
  assert.equal(input.title, "Loaded bratwurst nachos");
  assert.deepEqual(input.tags, ["kitchen-idea"]);
  assert.match(input.notes, /From one of Kitchen's dish ideas on 2026-11-08, for: “I made bratwurst yesterday/);
  assert.match(input.ingredients, /2–3 links or about 300 g Bratwurst/);
  assert.ok(!/salsa/i.test(input.ingredients), "optional extras that weren't used aren't written into the recipe");
  assert.equal((await store.listRecipes()).length, before, "nothing saved until the review screen saves it");
  const ai = recipeFromSession({ ...s, draft: { ...draft, origin: "ai", model: "gpt-4o-mini" } }, "Game-day brat nachos");
  assert.deepEqual(ai.tags, ["ai-generated"]);
  assert.match(ai.notes, /^Generated by Kitchen's AI \(gpt-4o-mini\) on 2026-11-08/);
});

test("recipe versions stay separate: lineage is read, the original is never changed", () => {
  const v = new VersionStore(new Mem());
  v.add({ recipeId: "b2", parentId: "b1", label: "v2", reason: "less salt", createdAt: "", by: "Lorne" });
  assert.deepEqual(v.chain("b2"), ["b1", "b2"]);
});
