// What the shared (Supabase) store asks the database for. The rules themselves
// are enforced and tested in kitchen-sql.test.ts; this checks the app relies
// on them correctly: edits name their base version, imports never overwrite,
// and the client never sends fields the database owns.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SharedRecipeStore, isMissingTable } from "../src/lib/sharedRecipeStore";
import { classifyAccess } from "../src/lib/familyAccess";
import type { ImportItem } from "../src/lib/recipeModel";

type Call = { table: string; op: string; payload?: unknown; opts?: Record<string, unknown>; filters: [string, unknown][] };
type Reply = { data: unknown; error: { message: string; code?: string } | null };

// A chainable stand-in for supabase-js's query builder that records each call.
function fakeClient(reply: (c: Call) => Reply) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => { call.op = "insert"; call.payload = p; return b; },
        update: (p: unknown) => { call.op = "update"; call.payload = p; return b; },
        upsert: (p: unknown, o: Record<string, unknown>) => { call.op = "upsert"; call.payload = p; call.opts = o; return b; },
        delete: () => { call.op = "delete"; return b; },
        eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
        order: () => b, limit: () => b, range: (a: number, z: number) => { call.filters.push(["range", [a, z]]); return b; },
        single: () => b, maybeSingle: () => b,
        then: (res: (r: Reply) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(reply(call)).then(res, rej),
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ME = "00000000-0000-0000-0000-0000000000a1";
const row = (over: Record<string, unknown> = {}) => ({
  id: "cheese-drawer-soup", title: "Cheese Drawer Soup", author_name: "Lorne", ingredients: "Cheddar", instructions: "",
  notes: "", tags: [], suggested_tags: [], approx_calories: null, legacy: null, version: 3,
  created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z", ...over,
});
const input = { title: "Cheese Drawer Soup", authorName: "Lorne", ingredients: "Cheddar", instructions: "Blend", notes: "", tags: [], suggestedTags: [], approxCalories: null };

test("an edit only lands on the version it started from, and never sends version/authorship", async () => {
  const { client, calls } = fakeClient((c) =>
    c.op === "update" ? { data: [row({ version: 4, instructions: "Blend" })], error: null } : { data: null, error: null });
  const result = await new SharedRecipeStore(client, ME).updateRecipe("cheese-drawer-soup", 3, input);
  assert.ok(result.ok && result.recipe.version === 4);
  const update = calls.find((c) => c.op === "update")!;
  assert.deepEqual(update.filters, [["id", "cheese-drawer-soup"], ["version", 3]]);
  for (const owned of ["id", "version", "created_by", "updated_by", "created_at", "updated_at", "legacy"]) {
    assert.ok(!(owned in (update.payload as object)), `client must not send ${owned}`);
  }
});

test("when someone else saved first, the edit reports a conflict with their version", async () => {
  const { client } = fakeClient((c) =>
    c.op === "update" ? { data: [], error: null } : { data: row({ version: 4, instructions: "Theirs" }), error: null });
  const result = await new SharedRecipeStore(client, ME).updateRecipe("cheese-drawer-soup", 3, input);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.current?.instructions, "Theirs");
});

test("imports are insert-if-absent by id, for recipes and their cooking entries", async () => {
  const { client, calls } = fakeClient((c) => ({ data: c.table === "kitchen_recipes" ? [{ id: "r1" }] : [{ id: "e1" }], error: null }));
  const recipe = { ...input, id: "r1", version: 1, createdAt: "", updatedAt: "", legacy: { title: "old" } };
  const entry = { id: "e1", recipeId: "r1", cookedOn: "", cookName: "", ingredientsUsed: "", substitutions: "", familyReaction: "", improveNextTime: "", notes: "", rating: null, createdAt: "", mine: true };
  const items: ImportItem[] = [
    { recipe, newEntries: [entry], status: "new", selected: true },
    { recipe: { ...recipe, id: "r2" }, newEntries: [], status: "same-title", selected: false },
  ];
  const result = await new SharedRecipeStore(client, ME).importItems(items, []);
  assert.deepEqual(result, { recipesAdded: 1, entriesAdded: 1, failed: [] });
  const upserts = calls.filter((c) => c.op === "upsert");
  assert.equal(upserts.length, 2, "the unselected likely-copy is not sent");
  for (const u of upserts) assert.deepEqual(u.opts, { onConflict: "id", ignoreDuplicates: true });
  assert.deepEqual((upserts[0].payload as { legacy: unknown }).legacy, { title: "old" }, "original kept");
  assert.equal((upserts[1].payload as { cooked_on: unknown }[])[0].cooked_on, null, "unknown date stays unknown");
  assert.ok(!("created_by" in (upserts[1].payload as object[])[0]), "the database stamps who recorded it");
});

test("one recipe the database refuses doesn't stop the rest of the import", async () => {
  const { client } = fakeClient((c) => {
    const id = (c.payload as { id?: string })?.id;
    return id === "too-long" ? { data: null, error: { message: "violates check constraint" } } : { data: [{ id }], error: null };
  });
  const base = { ...input, version: 1, createdAt: "", updatedAt: "" };
  const items: ImportItem[] = ["a", "too-long", "b"].map((id) => ({ recipe: { ...base, id, title: id }, newEntries: [], status: "new", selected: true }));
  const result = await new SharedRecipeStore(client, ME).importItems(items, []);
  assert.equal(result.recipesAdded, 2);
  assert.deepEqual(result.failed.map((f) => f.title), ["too-long"]);
  assert.match(result.failed[0].error, /check constraint/);
});

test("export pages past Supabase's 1000-row cap instead of silently truncating the backup", async () => {
  const many = Array.from({ length: 2345 }, (_, i) => ({ id: `e${i}`, recipe_id: "r", cooked_on: null, cook_name: "", ingredients_used: "",
    substitutions: "", family_reaction: "", improve_next_time: "", notes: "", rating: null, created_by: ME, created_at: "" }));
  const { client } = fakeClient((c) => {
    const range = c.filters.find(([k]) => k === "range")?.[1] as [number, number] | undefined;
    const all = c.table === "kitchen_cooking_entries" ? many : [];
    return { data: range ? all.slice(range[0], range[1] + 1) : all, error: null };
  });
  const bundle = await new SharedRecipeStore(client, ME).exportAll();
  assert.equal(bundle.cookingEntries.length, 2345);
  assert.equal(new Set(bundle.cookingEntries.map((e) => e.id)).size, 2345);
});

test("removing someone else's entry is reported, not silently ignored", async () => {
  const { client } = fakeClient(() => ({ data: [], error: null }));
  await assert.rejects(new SharedRecipeStore(client, ME).removeCookingEntry("e1"), /Only the person who recorded/);
});

test("favourites are written for the signed-in person only", async () => {
  const { client, calls } = fakeClient(() => ({ data: null, error: null }));
  const store = new SharedRecipeStore(client, ME);
  await store.setFavourite("r1", true);
  await store.setFavourite("r1", false);
  assert.deepEqual(calls[0].payload, { recipe_id: "r1", user_id: ME });
  assert.deepEqual(calls[1].filters, [["recipe_id", "r1"], ["user_id", ME]]);
});

test("access: only an explicit yes from the family list means member", () => {
  assert.deepEqual(classifyAccess(true, null), { status: "member" });
  assert.deepEqual(classifyAccess(false, null), { status: "not-member" });
  assert.deepEqual(classifyAccess(null, null), { status: "not-member" });
  assert.deepEqual(classifyAccess("true", null), { status: "not-member" });
  assert.deepEqual(classifyAccess(null, { code: "PGRST202", message: "x" }), { status: "not-set-up" });
  assert.deepEqual(classifyAccess(null, { code: "500", message: "boom" }), { status: "error", error: "boom" });
  assert.ok(isMissingTable({ code: "PGRST205" }));
  assert.ok(!isMissingTable({ code: "42501", message: "permission denied" }));
});
