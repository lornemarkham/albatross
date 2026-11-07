// The family pilot, end to end through the app's own shared store code, as two
// family members and a stranger, against the real SQL (kitchen.sql v5 +
// Inventory's family access and Pantry). A small stand-in for supabase-js
// turns each call into SQL run as that person, so RLS decides everything.
//
//   Lorne opens Kitchen → asks what to cook → cooks → the dinner is saved
//   Kathy (another phone) sees it, rates it with a photo; Lorne rates it too
//   Each sees both ratings; the next suggestion uses them; nobody can edit
//   anyone else's; a stranger sees nothing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { SharedRecipeStore } from "../src/lib/sharedRecipeStore";
import { loadPantry } from "../src/lib/pantry";
import { recommend } from "../src/lib/companion/recommend";
import { parseAsk } from "../src/lib/companion/ask";
import { tasteByRecipe } from "../src/lib/familyMemory";
import { RECIPE_EXTRA, ENTRY_EXTRA } from "./defaults.ts";

const LORNE = "00000000-0000-0000-0000-0000000000a1";
const KATHY = "00000000-0000-0000-0000-0000000000a2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";
let db: PGlite;

type Err = { message: string; code?: string };
function clientAs(uid: string): SupabaseClient {
  const as = asUser(db);
  // PostgREST sends DATE columns as "2026-11-09" and timestamps in full.
  const out = (v: unknown) => (v instanceof Date ? (v.toISOString().endsWith("T00:00:00.000Z") ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
  const run = async (sql: string, params: unknown[]) => {
    try { return { data: (await as(uid, sql, params)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, out(v)]))), error: null as Err | null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  };
  const val = (v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v)
    : Array.isArray(v) && v.some((x) => typeof x === "object") ? JSON.stringify(v) : v);
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
      let cols = "*"; let rows: Record<string, unknown>[] = []; let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let one: "single" | "maybe" | null = null; let order = ""; let range = "";
      const where: string[] = []; const params: unknown[] = [];
      const p = (v: unknown) => { params.push(val(v)); return `$${params.length}`; };
      const b: Record<string, unknown> = {
        select(c?: string) { if (c) cols = c; return b; },
        insert(r: unknown) { op = "insert"; rows = Array.isArray(r) ? r : [r as Record<string, unknown>]; return b; },
        upsert(r: unknown, o: typeof opts) { op = "upsert"; rows = Array.isArray(r) ? r : [r as Record<string, unknown>]; opts = o ?? {}; return b; },
        update(r: Record<string, unknown>) { op = "update"; rows = [r]; return b; },
        delete() { op = "delete"; return b; },
        eq(k: string, v: unknown) { where.push(`${k} = ${p(v)}`); return b; },
        is(k: string, v: null) { where.push(`${k} IS ${v === null ? "NULL" : "NOT NULL"}`); return b; },
        not(k: string, _o: string, v: null) { where.push(`${k} IS NOT ${v === null ? "NULL" : ""}`); return b; },
        order(k: string) { order = order ? `${order}, ${k}` : ` ORDER BY ${k}`; return b; },
        range(a: number, z: number) { range = ` OFFSET ${a} LIMIT ${z - a + 1}`; return b; },
        limit(n: number) { range = ` LIMIT ${n}`; return b; },
        single() { one = "single"; return b; }, maybeSingle() { one = "maybe"; return b; },
        then(res: (r: unknown) => unknown, rej: (e: unknown) => unknown) {
          const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
          let sql: string;
          if (op === "select") sql = `SELECT ${cols} FROM public.${table}${w}${order}${range}`;
          else if (op === "delete") sql = `DELETE FROM public.${table}${w} RETURNING ${cols === "*" ? "id" : cols}`;
          else if (op === "update") sql = `UPDATE public.${table} SET ${Object.keys(rows[0]).map((k) => `${k} = ${p(rows[0][k])}`).join(", ")}${w} RETURNING ${cols}`;
          else {
            const keys = Object.keys(rows[0]);
            const values = rows.map((r) => `(${keys.map((k) => p(r[k])).join(", ")})`).join(", ");
            const conflict = op === "upsert" ? ` ON CONFLICT (${opts.onConflict ?? "id"}) ${opts.ignoreDuplicates ? "DO NOTHING" : `DO UPDATE SET ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(", ")}`}` : "";
            sql = `INSERT INTO public.${table} (${keys.join(", ")}) VALUES ${values}${conflict} RETURNING ${cols}`;
          }
          return run(sql, params).then((r) => {
            if (r.error || !one) return r;
            const d = r.data ?? [];
            if (one === "single" && d.length !== 1) return { data: null, error: { message: `expected 1 row, got ${d.length}`, code: "PGRST116" } };
            return { data: d[0] ?? null, error: null };
          }).then(res, rej);
        },
      };
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
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
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${LORNE}', 'l@example.com'), ('${KATHY}', 'k@example.com'), ('${STRANGER}', 's@example.com');
    INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
    VALUES ('sp-01', 'Spinach', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"bags"}');`);
  await addMember(db, LORNE, "Lorne");
  await addMember(db, KATHY, "Kathy");
  await runFile(db, "supabase/kitchen.sql");
  await asUser(db)(LORNE, "SELECT pantry_receive('sp-01', 1, 'Fridge', '2026-11-09', '2026-11-05')");
});

const recipeInput = { title: "Red Lentil Dal", authorName: "Lorne", ingredients: "1 cup red lentils\nSpinach\n1 onion", instructions: "Simmer.", notes: "", tags: ["weeknight"], suggestedTags: [], approxCalories: null, ...RECIPE_EXTRA };
const noFeedback = { comment: "", improvement: "", makeAgain: null, photos: [] };

test("two family members, one dinner: shared, rated separately, remembered, and steering the next suggestion", async () => {
  const lorne = new SharedRecipeStore(clientAs(LORNE), LORNE);
  const kathy = new SharedRecipeStore(clientAs(KATHY), KATHY);

  // 1–4: Lorne opens Kitchen; Kitchen reads Pantry; asks; gets the dal (uses the spinach).
  const recipe = await lorne.createRecipe(recipeInput);
  const pantry = await loadPantry(clientAs(LORNE));
  assert.equal(pantry.status, "ready");
  const items = pantry.status === "ready" ? pantry.items : [];
  let ans = recommend(parseAsk("What should we cook tonight?"), { recipes: await lorne.listRecipes(), pantry: items, taste: new Map(), profiles: [], today: "2026-11-07" });
  assert.equal(ans.suggestions[0].recipe.id, recipe.id);
  assert.ok(ans.suggestions[0].reasons.some((r) => r.text === "Uses your spinach — best before in 2 days (Pantry: 1 bags · Fridge)"));

  // 7: cooked; the dinner is saved.
  const entry = await lorne.addCookingEntry(recipe.id, { cookedOn: "2026-11-07", cookName: "Lorne", ingredientsUsed: "", substitutions: "Kale instead of spinach", familyReaction: "", improveNextTime: "", notes: "", rating: null, ...ENTRY_EXTRA });

  // 10: both rate it, Kathy with a photo and an improvement.
  await kathy.saveFeedback(entry.id, { ...noFeedback, authorName: "spoofed", rating: 9, makeAgain: "yes", improvement: "More ginger", photos: [{ id: "ph-1", caption: "", addedAt: "2026-11-07" }] }, null);
  const mine = await lorne.saveFeedback(entry.id, { ...noFeedback, authorName: "", rating: 7, makeAgain: "maybe" }, null);
  await lorne.saveFeedback(entry.id, { ...noFeedback, authorName: "", rating: 8, makeAgain: "yes" }, mine);

  // 11–12: each sees everyone's, under their family-list names; edits kept.
  for (const store of [lorne, kathy]) {
    const fb = await store.listFeedback();
    assert.equal(fb.status, "ready");
    const list = fb.status === "ready" ? fb.items : [];
    assert.deepEqual(list.map((f) => [f.authorName, f.rating]).sort(), [["Kathy", 9], ["Lorne", 8]]);
    assert.equal(list.find((f) => f.authorName === "Kathy")!.photos[0].id, "ph-1");
    assert.equal(list.find((f) => f.authorName === "Lorne")!.history.length, 1);
    assert.equal((await store.getRecipe(recipe.id))!.entries[0].substitutions, "Kale instead of spinach");
  }
  // Nobody edits anyone else's: Lorne's store holding Kathy's row as `base` gets refused.
  const kathysRow = ((await lorne.listFeedback()) as { items: Awaited<ReturnType<typeof lorne.saveFeedback>>[] }).items.find((f) => f.authorName === "Kathy")!;
  assert.equal(kathysRow.mine, false);
  await assert.rejects(lorne.saveFeedback(entry.id, { ...noFeedback, authorName: "", rating: 1 }, kathysRow), /changed somewhere else/);

  // The next suggestion uses what they said.
  const fb = await kathy.listFeedback();
  ans = recommend(parseAsk("Give me three dinner ideas the family will like"), {
    recipes: await kathy.listRecipes(), pantry: items, taste: tasteByRecipe(fb.status === "ready" ? fb.items : []), profiles: [], today: "2026-11-08",
  });
  const texts = ans.suggestions[0].reasons.map((r) => r.text);
  assert.ok(texts.some((t) => /^Rated 8\.5\/10 on average by 2 people/.test(t)), texts.join(" | "));
  assert.ok(texts.includes("Lorne and Kathy said they'd have it again") || texts.includes("Kathy and Lorne said they'd have it again"));
  assert.ok(texts.includes("Last note to self: “More ginger” — Kathy"));

  // The cook can't remove a dinner the family rated.
  await assert.rejects(lorne.removeCookingEntry(entry.id), /rated this dinner, so it stays/);

  // Food notes: each writes their own, the family reads all.
  await kathy.saveMyProfile({ name: "Kathy", avoids: "mushrooms", likes: "", notes: "" });
  const profiles = await lorne.listProfiles();
  assert.ok(profiles.status === "ready" && profiles.items.some((p) => p.name === "Kathy" && p.avoids === "mushrooms" && !p.mine));

  // Backups carry everyone's feedback.
  const bundle = await kathy.exportAll();
  assert.equal(bundle.mealFeedback?.length, 2);
  assert.equal(bundle.memberProfiles?.length, 1);
});

test("a signed-in stranger, through the same app code, sees and changes nothing", async () => {
  const stranger = new SharedRecipeStore(clientAs(STRANGER), STRANGER);
  assert.deepEqual(await stranger.listRecipes(), []);
  const fb = await stranger.listFeedback();
  assert.ok(fb.status === "ready" && fb.items.length === 0);
  await assert.rejects(stranger.saveFeedback("anything", { ...noFeedback, authorName: "", rating: 0 }, null));
  const p = await loadPantry(clientAs(STRANGER));
  assert.ok(p.status === "ready" && p.items.length === 0);
});
