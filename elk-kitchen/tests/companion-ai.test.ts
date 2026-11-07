// /api/companion: the optional AI pass. Network is faked; what's checked is
// the gate (family only, fails closed), "off" without a key, and that what the
// model says is cut back to the family's own recipes before anyone sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../api/companion";
import { aiRequestFrom, askAi, checkAiReply, parseAiRequest, type AiRequest } from "../src/lib/companion/ai";
import { recommend } from "../src/lib/companion/recommend";
import { parseAsk } from "../src/lib/companion/ask";
import { RECIPE_EXTRA } from "./defaults.ts";

const REQ: AiRequest = {
  question: "What should we cook tonight?", heard: ["dinner"],
  recipes: [{ id: "dal", title: "Red Lentil Dal", ingredients: ["Red lentils", "Spinach"], facts: ["[pantry] Uses your spinach"] }],
  useSoon: ["Spinach (best before 2026-11-09)"], leftovers: [], foodNotes: [], pantryConnected: true,
};
const ENV = { openaiKey: "test-key", supabaseUrl: "https://db.example", anonKey: "anon" };
const post = (body: unknown, token: string | null = "tok") =>
  new Request("https://kitchen.example/api/companion", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

function fakeFetch(member: boolean | number, model: unknown) {
  const calls: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes("elk_is_family_member")) {
      return typeof member === "number" ? new Response("{}", { status: member }) : new Response(JSON.stringify(member), { status: 200 });
    }
    assert.ok(String(init?.headers && (init.headers as Record<string, string>).Authorization).includes("test-key"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(model) } }] }), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

test("no sign-in, a stranger, or an expired token never reaches the model", async () => {
  for (const [member, token, status] of [[true, null, 401], [false, "tok", 403], [401, "tok", 401]] as const) {
    const { f, calls } = fakeFetch(member, {});
    const res = await handle(post(REQ, token), { ...ENV, fetchImpl: f });
    assert.equal(res.status, status);
    assert.ok(!calls.some((u) => u.includes("openai")), "model never called");
  }
});

test("without a key (or Supabase config) it says AI is off, and fails closed", async () => {
  const { f } = fakeFetch(true, {});
  assert.equal((await handle(post(REQ), { ...ENV, openaiKey: undefined, fetchImpl: f })).status, 503);
  assert.equal((await handle(post(REQ), { ...ENV, supabaseUrl: undefined, fetchImpl: f })).status, 503);
});

test("the model can only choose among the family's recipes; invented ids are dropped and the key never leaks", async () => {
  const { f } = fakeFetch(true, {
    reply: "Dal tonight — it uses the spinach.",
    picks: [{ recipeId: "dal", why: "Uses the spinach Pantry says needs using." }, { recipeId: "made-up", why: "x" }, { recipeId: "dal", why: "dupe" }],
    ideas: [{ title: "Spinach omelette", why: "Quick", uses: ["spinach"], alsoNeeds: ["eggs"] }, { title: "B", why: "", uses: [], alsoNeeds: [] }, { title: "C", why: "", uses: [], alsoNeeds: [] }],
    followUps: ["Something quicker?"],
  });
  const res = await handle(post(REQ), { ...ENV, fetchImpl: f });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("test-key"));
  const { reply } = JSON.parse(text);
  assert.deepEqual(reply.picks.map((p: { recipeId: string }) => p.recipeId), ["dal"]);
  assert.equal(reply.ideas.length, 2);
});

test("a malformed or oversized body is refused before the model is called", async () => {
  const { f, calls } = fakeFetch(true, {});
  assert.equal((await handle(post({ nope: 1 }), { ...ENV, fetchImpl: f })).status, 400);
  assert.equal((await handle(post({ ...REQ, question: "x".repeat(70_000) }), { ...ENV, fetchImpl: f })).status, 413);
  assert.ok(!calls.some((u) => u.includes("openai")));
  assert.equal(parseAiRequest({ question: "  ", recipes: [] }), null);
});

test("the browser builds the request from Kitchen's own grounded facts, and checks the reply again", async () => {
  const r = { id: "dal", title: "Red Lentil Dal", authorName: "", ingredients: "Red lentils\nSpinach", instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA, version: 1, createdAt: "", updatedAt: "", lastCookedOn: "", timesCooked: 0, favourite: false };
  const ask = parseAsk("What should we cook tonight?");
  const ans = recommend(ask, { recipes: [r], pantry: [{ name: "Spinach", onHand: 1, unit: "bags", location: "Fridge", bestBefore: "2026-11-09" }], taste: new Map(), profiles: [], today: "2026-11-07" });
  const req = aiRequestFrom(ask, ans, ans.ranked, ["Kathy avoids mushrooms"], ["dinner"]);
  assert.deepEqual(req.useSoon, ["Spinach (best before 2026-11-09)"]);
  assert.ok(req.recipes[0].facts.some((x) => x.startsWith("[pantry] Uses your spinach")));
  const off = await askAi(req, "tok", (async () => new Response(JSON.stringify({ error: "Kitchen's AI isn't switched on yet." }), { status: 503 })) as typeof fetch);
  assert.deepEqual(off, { ok: false, off: true, error: "Kitchen's AI isn't switched on yet." });
  const on = await askAi(req, "tok", (async () => new Response(JSON.stringify({ reply: { reply: "ok", picks: [{ recipeId: "ghost", why: "" }], ideas: [], followUps: [] } }), { status: 200 })) as typeof fetch);
  assert.ok(on.ok && on.reply.picks.length === 0, "a pick that isn't a family recipe never shows");
  assert.deepEqual(checkAiReply(null, req), { reply: "", picks: [], ideas: [], followUps: [] });
});
