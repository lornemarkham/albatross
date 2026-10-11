// Recipe capture: what's sent to /api/extract, and how its answer becomes a
// form draft (never saved directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRecipe, parseExtracted, toRecipeDraft, type ExtractedRecipe } from "../src/lib/capture/recipeCapture";

const CARD: ExtractedRecipe = {
  title: "Gran's Scones", servings: "8", prepTime: null, cookTime: "15 min", source: "Gran",
  ingredients: ["2 cups flour", "1/2 cup butter"], instructions: ["1. Rub butter into flour.", "Bake at 425°F."],
  notes: "Don't overmix!", tags: ["baking"], unclear: ["\"1/2\" smudged"],
};
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("draft keeps the card's wording, numbers steps once, and only suggests tags", () => {
  const d = toRecipeDraft(CARD, "Lorne");
  assert.equal(d.title, "Gran's Scones");
  assert.equal(d.authorName, "Gran");
  assert.equal(d.ingredients, "2 cups flour\n1/2 cup butter");
  assert.equal(d.instructions, "1. Rub butter into flour.\n2. Bake at 425°F.");
  assert.equal(d.notes, "Serves: 8 · Cook: 15 min\n\nDon't overmix!");
  assert.deepEqual(d.tags, []);
  assert.deepEqual(d.suggestedTags, ["baking"]);
  assert.equal(toRecipeDraft({ ...CARD, source: null }, "Lorne").authorName, "Lorne");
});

test("only the promised shape is accepted", () => {
  assert.equal(parseExtracted({ products: [] }), null);
  assert.equal(parseExtracted(null), null);
  assert.deepEqual(parseExtracted({ ...CARD, tags: ["Baking", 3], servings: " " })?.tags, ["baking"]);
  assert.equal(parseExtracted({ ...CARD, servings: " " })?.servings, null);
});

test("sends every page with the sign-in token, in recipe mode", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(CARD)); }) as unknown as typeof fetch;
  const r = await extractRecipe([{ base64: "AA", mediaType: "image/jpeg" }, { base64: "BB", mediaType: "image/jpeg" }], "tok", f);
  assert.ok(r.ok);
  assert.equal(seen?.url, "/api/extract");
  assert.equal((seen?.init.headers as Record<string, string>).Authorization, "Bearer tok");
  const body = JSON.parse(String(seen?.init.body));
  assert.equal(body.kind, "recipe");
  assert.deepEqual(body.images.map((i: { base64: string }) => i.base64), ["AA", "BB"]);
});

test("failures are explained, never turned into a made-up recipe", async () => {
  const p = [{ base64: "AA", mediaType: "image/jpeg" }];
  assert.match((await extractRecipe([], "t", reply(200, CARD)) as { error: string }).error, /photo/);
  assert.match((await extractRecipe(p, "t", reply(403, { error: "x" })) as { error: string }).error, /family list/);
  assert.match((await extractRecipe(p, "t", reply(401, {})) as { error: string }).error, /Sign in/);
  assert.match((await extractRecipe(p, "t", reply(200, { products: [] })) as { error: string }).error, /Couldn't read/);
  assert.match((await extractRecipe(p, "t", reply(200, { error: "OpenAI request failed (500)" })) as { error: string }).error, /had a problem/);
  const empty = { ...CARD, title: "", ingredients: [], instructions: [] };
  assert.match((await extractRecipe(p, "t", reply(200, empty)) as { error: string }).error, /No recipe found/);
  const offline = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
  assert.match((await extractRecipe(p, "t", offline) as { error: string }).error, /connection/);
});

test("a draft under review survives a reload of the tab, and is gone once cleared", async () => {
  const { keepDraft, readDraft, clearDraft } = await import("../src/lib/capture/recipeCapture");
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  const d = { draft: toRecipeDraft(CARD, "Lorne"), unclear: CARD.unclear, pages: 2 };
  keepDraft(s, d);
  assert.deepEqual(readDraft(s), d);
  clearDraft(s);
  assert.equal(readDraft(s), null);
  m.set("elk-kitchen-photo-draft", "{not json");
  assert.equal(readDraft(s), null);
});

test("several pages are shrunk until they fit in one request, or refused", async () => {
  const { preparePhotos, MAX_TOTAL_CHARS } = await import("../src/lib/capture/recipeCapture");
  const edges: number[] = [];
  // Pretend size grows with the long edge: 3 pages at 1800px are too big together.
  const shrink = async (_f: Blob, edge: number) => { edges.push(edge); return { base64: "A".repeat(edge * 700), mediaType: "image/jpeg" }; };
  const pages = await preparePhotos([new Blob(), new Blob(), new Blob()], shrink);
  assert.ok(pages.reduce((n, p) => n + p.base64.length, 0) <= MAX_TOTAL_CHARS);
  assert.deepEqual([...new Set(edges)], [1800, 1400]);
  await assert.rejects(preparePhotos(Array(6).fill(new Blob()), async () => ({ base64: "A".repeat(1_000_000), mediaType: "image/jpeg" })), /too large/);
});
