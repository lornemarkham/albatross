// Kitchen's companion against ELK Inventory's real SQL (verbatim fixture of the
// next Pantry release, which has the shopping list): reading stock with
// places and best-before, reading the open shopping list, and adding to it
// only through pantry_shopping_add — never touching stock.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { addToShoppingList, loadPantry } from "../src/lib/pantry";
import { loadOpenShopping, parseShopping, reviewLines } from "../src/lib/companion/shopping";
import { useSoon } from "../src/lib/companion/pantryView";
import { recommend } from "../src/lib/companion/recommend";
import { parseAsk } from "../src/lib/companion/ask";
import { RECIPE_EXTRA } from "./defaults.ts";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const STRANGER = "00000000-0000-0000-0000-0000000000ff";
let db: PGlite;

// supabase-js as far as pantry.ts / shopping.ts use it, run as the signed-in person.
function clientAs(uid: string): SupabaseClient {
  const as = asUser(db);
  const text = (v: unknown) => (v instanceof Date ? (v.toISOString().endsWith("T00:00:00.000Z") ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
  const run = async (sql: string, params: unknown[]) => {
    try { return { data: (await as(uid, sql, params)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)]))), error: null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  };
  return {
    from(table: string) {
      let cols = "*"; let order = ""; const where: string[] = []; const params: unknown[] = [];
      const b = {
        select(c: string) { cols = c; return b; },
        eq(k: string, v: unknown) { params.push(v); where.push(`${k} = $${params.length}`); return b; },
        is(k: string, v: null) { where.push(`${k} IS ${v === null ? "NULL" : "NOT NULL"}`); return b; },
        order(k: string) { order = ` ORDER BY ${k}`; return b; },
        limit() { return b; },
        then(res: (r: unknown) => unknown, rej: (e: unknown) => unknown) {
          return run(`SELECT ${cols} FROM public.${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${order}`, params).then(res, rej);
        },
      };
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const r = await run(`SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) AS v`, names.map((n) => args[n]));
      return r.error ? r : { data: (r.data as { v: unknown }[])[0].v, error: null };
    },
  } as unknown as SupabaseClient;
}

before(async () => {
  db = await supabaseLikeDb();
  await runFile(db, "tests/fixtures/inventory-main-supabase-schema.sql");
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await runFile(db, "tests/fixtures/inventory-next-supabase-pantry.sql");
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'a@example.com'), ('${BOB}', 'b@example.com'), ('${STRANGER}', 'x@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('chick-01', 'Leftover chicken', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"containers"}'),
           ('onion-01', 'Onions', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Pantry shelf', 0, '{"unit":"bags"}');
  `);
  await addMember(db, ALICE, "Alice");
  await addMember(db, BOB, "Bob");
  const as = asUser(db);
  await as(ALICE, "SELECT pantry_receive('chick-01', 2, 'Fridge', '2026-11-08', '2026-11-05')");
  await as(ALICE, "SELECT pantry_receive('onion-01', 1, 'Pantry shelf', NULL, '2026-10-01')");
});

const movements = async () => Number((await db.query<{ n: string }>("SELECT count(*) n FROM stock_movements")).rows[0].n);

test("Kitchen reads Inventory's real stock: count, place, best-before — and suggests from it", async () => {
  const p = await loadPantry(clientAs(BOB));
  assert.equal(p.status, "ready");
  const items = (p as { items: { name: string; onHand: number }[] }).items as Parameters<typeof useSoon>[0];
  const chicken = items.find((i) => i.name === "Leftover chicken")!;
  assert.deepEqual([chicken.onHand, chicken.unit, chicken.location, chicken.bestBefore], [2, "containers", "Fridge", "2026-11-08"]);
  assert.deepEqual(useSoon(items, "2026-11-07").map((s) => s.item.name), ["Leftover chicken"]);
  const ans = recommend(parseAsk("We need to use the leftover chicken"), {
    recipes: [{ id: "r", title: "Chicken fried rice", authorName: "", ingredients: "Leftover chicken\nRice\n1 onion", instructions: "", notes: "", tags: [], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA, version: 1, createdAt: "", updatedAt: "", lastCookedOn: "", timesCooked: 0, favourite: false }],
    pantry: items, taste: new Map(), profiles: [], today: "2026-11-07",
  });
  assert.ok(ans.suggestions[0].reasons.some((r) => r.text === "Pantry has Leftover chicken (2 containers · Fridge)"));
  const stranger = await loadPantry(clientAs(STRANGER));
  assert.ok(stranger.status === "ready" && stranger.items.length === 0, "a non-member sees no stock");
});

test("'We're out of onions' → reviewed → Pantry's shopping list; stock is untouched", async () => {
  const before = await movements();
  const req = parseShopping("We're out of onions")!;
  assert.equal(req.kind, "add");
  const open = await loadOpenShopping(clientAs(ALICE));
  assert.deepEqual(open, { status: "ready", names: [] });
  const pantry = (await loadPantry(clientAs(ALICE)) as { items: Parameters<typeof reviewLines>[2] & object }).items;
  const lines = reviewLines(req.kind === "add" ? req.names : [], [], pantry);
  assert.match(lines[0].pantryNote, /Pantry still shows 1 bags of Onions/);
  const r = await addToShoppingList(clientAs(ALICE), lines.filter((l) => l.selected).map((l) => l.name), "", "asked in Kitchen");
  assert.deepEqual(r, { ok: true, added: 1 });
  const rows = (await db.query<{ name: string; source: string; note: string; item_id: string; created_by: string }>(
    "SELECT name, source, note, item_id, created_by FROM pantry_shopping_items")).rows;
  assert.deepEqual(rows, [{ name: "onions", source: "manual", note: "asked in Kitchen", item_id: "onion-01", created_by: ALICE }]);
  assert.equal(await movements(), before, "adding to the list never changes stock");
});

test("another family member sees the same list, and adding the same thing again adds nothing", async () => {
  assert.deepEqual(await loadOpenShopping(clientAs(BOB)), { status: "ready", names: ["onions"] });
  assert.deepEqual(await addToShoppingList(clientAs(BOB), ["Onions", "Cream"], "Creamy pasta"), { ok: true, added: 1 });
  const cream = (await db.query<{ source: string; note: string }>("SELECT source, note FROM pantry_shopping_items WHERE name = 'Cream'")).rows[0];
  assert.deepEqual(cream, { source: "recipe", note: "for Creamy pasta" });
  const lines = reviewLines(["cream", "basil"], (await loadOpenShopping(clientAs(BOB)) as { names: string[] }).names, null);
  assert.deepEqual(lines.map((l) => [l.name, l.onList, l.selected]), [["cream", true, false], ["basil", false, true]]);
});

test("a signed-in stranger can't read or add to the family's shopping list", async () => {
  assert.deepEqual(await loadOpenShopping(clientAs(STRANGER)), { status: "ready", names: [] });
  const r = await addToShoppingList(clientAs(STRANGER), ["Spam"], "");
  assert.equal(r.ok, false);
  assert.equal((await db.query("SELECT 1 FROM pantry_shopping_items WHERE name = 'Spam'")).rows.length, 0);
});
