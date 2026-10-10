// Family authorization + shared persistence (supabase/kitchen.sql) against a
// real Postgres (PGlite) shaped like the shared ELK Supabase project, with
// ELK Inventory's family-access SQL applied first, as in production.
//
//   LORNE, KATHY  family members (added the way the owner does, as postgres)
//   STRANGER      can sign in (another app's user, or a self-sign-up) — not family
//   null          not signed in (anon)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember, inventoryStubs } from "./supabase-harness";

const LORNE    = "00000000-0000-0000-0000-0000000000a1";
const KATHY    = "00000000-0000-0000-0000-0000000000a2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";
const FAMILY_SQL  = "tests/fixtures/elk-family-access.sql";
const KITCHEN_SQL = "supabase/kitchen.sql";
const KITCHEN_TABLES = ["kitchen_recipes", "kitchen_cooking_entries", "kitchen_favourites", "kitchen_recipe_revisions"];

let db: PGlite;
let as: ReturnType<typeof asUser>;
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const inventoryPolicies = () =>
  admin("SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE tablename NOT LIKE 'kitchen_%' ORDER BY 1, 2");
let inventoryPoliciesBefore: unknown;

async function users(d: PGlite) {
  await d.exec(`INSERT INTO auth.users (id, email) VALUES
    ('${LORNE}', 'lorne@example.com'), ('${KATHY}', 'kathy@example.com'), ('${STRANGER}', 'stranger@example.com');`);
}

before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await users(db);
  await db.exec(inventoryStubs);
  await runFile(db, FAMILY_SQL);
  await addMember(db, LORNE, "Lorne");
  await addMember(db, KATHY, "Kathy");
  inventoryPoliciesBefore = await inventoryPolicies();
  await runFile(db, KITCHEN_SQL);
});

test("refuses to run before Inventory's family access exists (no open shared storage)", async () => {
  const fresh = await supabaseLikeDb();
  await users(fresh);
  await assert.rejects(runFile(fresh, KITCHEN_SQL), /family access is not set up/);
  const made = await fresh.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'kitchen_%'");
  assert.equal(made.rows.length, 0, "nothing was created");
});

test("refuses to adopt a same-named table that ELK Kitchen didn't create", async () => {
  const fresh = await supabaseLikeDb();
  await fresh.exec(inventoryStubs);
  await runFile(fresh, FAMILY_SQL);
  await fresh.exec("CREATE TABLE public.kitchen_recipes (id INT PRIMARY KEY, secret TEXT)");
  await assert.rejects(runFile(fresh, KITCHEN_SQL), /not created by ELK Kitchen/);
});

test("leaves Inventory's tables and policies exactly as they were", async () => {
  assert.deepEqual(await inventoryPolicies(), inventoryPoliciesBefore);
});

test("every kitchen policy requires family membership; none is open", async () => {
  const policies = await admin<{ tablename: string; qual: string | null; with_check: string | null }>(
    "SELECT tablename, qual, with_check FROM pg_policies WHERE tablename LIKE 'kitchen_%'");
  assert.ok(policies.length >= 10);
  for (const p of policies) {
    assert.match(`${p.qual ?? ""} ${p.with_check ?? ""}`, /elk_is_family_member/, JSON.stringify(p));
  }
});

test("Cheese Drawer Soup: saved by one family member, seen and cooked again by another", async () => {
  await as(LORNE, `INSERT INTO kitchen_recipes (id, title, author_name, ingredients, instructions)
    VALUES ('cheese-drawer-soup', 'Cheese Drawer Soup', 'Lorne', 'Leftover cheddar\nStock\nPotato', 'Simmer, melt, blend')`);
  await as(LORNE, `INSERT INTO kitchen_cooking_entries (recipe_id, cooked_on, cook_name, ingredients_used, substitutions, family_reaction, improve_next_time, rating)
    VALUES ('cheese-drawer-soup', '2026-10-10', 'Lorne', 'Cheddar, gouda rind, stock, potato', 'Gouda rind for parmesan', 'Kids asked for seconds', 'Less salt', 8)`);
  await as(LORNE, "INSERT INTO kitchen_favourites (recipe_id) VALUES ('cheese-drawer-soup')");

  // Kathy, on her own device/account, sees the same recipe and history…
  const seen = await as<{ title: string; created_by: string }>(KATHY, "SELECT title, created_by FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'");
  assert.deepEqual(seen, [{ title: "Cheese Drawer Soup", created_by: LORNE }]);
  // …and records her own, separate cooking experience.
  await as(KATHY, `INSERT INTO kitchen_cooking_entries (recipe_id, cooked_on, cook_name, substitutions, family_reaction)
    VALUES ('cheese-drawer-soup', '2026-10-17', 'Kathy', 'Brie instead of cheddar', 'Too rich for the kids')`);

  const history = await as<{ cook_name: string; created_by: string }>(LORNE,
    "SELECT cook_name, created_by FROM kitchen_cooking_entries WHERE recipe_id = 'cheese-drawer-soup' ORDER BY cooked_on");
  assert.deepEqual(history, [{ cook_name: "Lorne", created_by: LORNE }, { cook_name: "Kathy", created_by: KATHY }]);
  // The planned recipe is untouched by what people actually cooked.
  const [recipe] = await as<{ ingredients: string; version: number }>(KATHY, "SELECT ingredients, version FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'");
  assert.deepEqual(recipe, { ingredients: "Leftover cheddar\nStock\nPotato", version: 1 });
  // Favourites are per person, visible to the family.
  assert.deepEqual(await as(KATHY, "SELECT user_id FROM kitchen_favourites"), [{ user_id: LORNE }]);
});

test("a signed-in stranger sees nothing and can change nothing", async () => {
  for (const t of KITCHEN_TABLES) {
    assert.deepEqual(await as(STRANGER, `SELECT * FROM ${t}`), [], t);
  }
  await assert.rejects(as(STRANGER, "INSERT INTO kitchen_recipes (id, title) VALUES ('x', 'Spam')"), /row-level security/);
  await assert.rejects(as(STRANGER, "INSERT INTO kitchen_cooking_entries (recipe_id) VALUES ('cheese-drawer-soup')"), /row-level security/);
  await assert.rejects(as(STRANGER, "INSERT INTO kitchen_favourites (recipe_id) VALUES ('cheese-drawer-soup')"), /row-level security/);
  assert.deepEqual(await as(STRANGER, "UPDATE kitchen_recipes SET title = 'pwned' RETURNING id"), []);
  assert.deepEqual(await as(STRANGER, "DELETE FROM kitchen_cooking_entries RETURNING id"), []);
  // Nor can they enrol themselves.
  await assert.rejects(as(STRANGER, `INSERT INTO elk_family_members (user_id) VALUES ('${STRANGER}')`), /permission denied/);
  assert.equal((await admin("SELECT title FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'"))[0].title, "Cheese Drawer Soup");
});

test("signed-out callers are refused outright", async () => {
  for (const t of KITCHEN_TABLES) {
    await assert.rejects(as(null, `SELECT * FROM ${t}`), /permission denied/, t);
  }
});

test("someone removed from the family list loses access immediately", async () => {
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 'ex@example.com')`);
  await addMember(db, "00000000-0000-0000-0000-0000000000b1", "Ex");
  assert.ok((await as("00000000-0000-0000-0000-0000000000b1", "SELECT id FROM kitchen_recipes")).length > 0);
  await admin("DELETE FROM elk_family_members WHERE user_id = '00000000-0000-0000-0000-0000000000b1'");
  assert.deepEqual(await as("00000000-0000-0000-0000-0000000000b1", "SELECT id FROM kitchen_recipes"), []);
});

test("edits are version-checked, and the previous version is always kept", async () => {
  // Both start editing version 1. Kathy saves first.
  const kathy = await as(KATHY, "UPDATE kitchen_recipes SET instructions = 'Simmer 20 min, blend' WHERE id = 'cheese-drawer-soup' AND version = 1 RETURNING version");
  assert.deepEqual(kathy, [{ version: 2 }]);
  // Lorne's save against the stale version changes nothing (the app reports a conflict).
  const lorne = await as(LORNE, "UPDATE kitchen_recipes SET instructions = 'Different' WHERE id = 'cheese-drawer-soup' AND version = 1 RETURNING version");
  assert.deepEqual(lorne, []);

  const [now] = await as<{ instructions: string; updated_by: string }>(LORNE, "SELECT instructions, updated_by FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'");
  assert.deepEqual(now, { instructions: "Simmer 20 min, blend", updated_by: KATHY });
  const revisions = await as<{ version: number; snapshot: { instructions: string }; replaced_by: string }>(LORNE,
    "SELECT version, snapshot, replaced_by FROM kitchen_recipe_revisions WHERE recipe_id = 'cheese-drawer-soup'");
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].version, 1);
  assert.equal(revisions[0].snapshot.instructions, "Simmer, melt, blend");
  assert.equal(revisions[0].replaced_by, KATHY);
});

test("the client can't forge version, authorship, id or imported originals", async () => {
  await as(KATHY, `INSERT INTO kitchen_recipes (id, title, version, created_by, legacy)
    VALUES ('forge', 'Forge test', 99, '${LORNE}', '{"title":"original"}')`);
  const [r] = await as<{ version: number; created_by: string }>(KATHY, "SELECT version, created_by FROM kitchen_recipes WHERE id = 'forge'");
  assert.deepEqual(r, { version: 1, created_by: KATHY });

  await as(KATHY, `UPDATE kitchen_recipes SET version = 50, created_by = '${LORNE}', legacy = NULL WHERE id = 'forge'`);
  const [u] = await as<{ version: number; created_by: string; legacy: unknown }>(KATHY, "SELECT version, created_by, legacy FROM kitchen_recipes WHERE id = 'forge'");
  assert.deepEqual(u, { version: 2, created_by: KATHY, legacy: { title: "original" } });

  await assert.rejects(as(KATHY, "UPDATE kitchen_recipes SET id = 'renamed' WHERE id = 'forge'"), /id cannot change/);
  await assert.rejects(as(KATHY, `INSERT INTO kitchen_cooking_entries (recipe_id, created_by) VALUES ('forge', '${LORNE}')`), /row-level security/);
  await assert.rejects(as(KATHY, `INSERT INTO kitchen_favourites (user_id, recipe_id) VALUES ('${LORNE}', 'forge')`), /row-level security/);
  await assert.rejects(as(KATHY, "INSERT INTO kitchen_recipe_revisions (recipe_id, version, snapshot) VALUES ('forge', 1, '{}')"), /permission denied/);
});

test("recipes can't be deleted through the API; people remove only their own cooking entries", async () => {
  await assert.rejects(as(LORNE, "DELETE FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'"), /permission denied/);
  await assert.rejects(as(LORNE, "TRUNCATE kitchen_recipes"), /permission denied/);
  await assert.rejects(as(LORNE, "UPDATE kitchen_cooking_entries SET notes = 'x'"), /permission denied/);

  assert.deepEqual(await as(LORNE, "DELETE FROM kitchen_cooking_entries WHERE cook_name = 'Kathy' RETURNING id"), [], "not Lorne's entry");
  assert.equal((await as(LORNE, "DELETE FROM kitchen_cooking_entries WHERE cook_name = 'Lorne' RETURNING id")).length, 1);
  assert.equal((await as(KATHY, "SELECT * FROM kitchen_cooking_entries WHERE recipe_id = 'cheese-drawer-soup'")).length, 1);
});

test("re-importing the same recipe or entry id never overwrites what's there", async () => {
  // What the app's import sends (PostgREST upsert with ignoreDuplicates).
  const sent = await as(KATHY, `INSERT INTO kitchen_recipes (id, title) VALUES ('cheese-drawer-soup', 'Imported copy')
    ON CONFLICT (id) DO NOTHING RETURNING id`);
  assert.deepEqual(sent, []);
  assert.equal((await admin("SELECT title FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'"))[0].title, "Cheese Drawer Soup");

  await as(KATHY, "INSERT INTO kitchen_cooking_entries (id, recipe_id, notes) VALUES ('imp-1', 'cheese-drawer-soup', 'first') ON CONFLICT (id) DO NOTHING");
  await as(LORNE, "INSERT INTO kitchen_cooking_entries (id, recipe_id, notes) VALUES ('imp-1', 'cheese-drawer-soup', 'second') ON CONFLICT (id) DO NOTHING");
  assert.deepEqual(await admin("SELECT notes FROM kitchen_cooking_entries WHERE id = 'imp-1'"), [{ notes: "first" }]);
});

test("deleting an auth user who wrote recipes and cooking entries still works, and keeps their recipes", async () => {
  const GONE = "00000000-0000-0000-0000-0000000000c1";
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${GONE}', 'gone@example.com')`);
  await addMember(db, GONE, "Gone");
  await as(GONE, "INSERT INTO kitchen_recipes (id, title) VALUES ('gone-recipe', 'Left behind')");
  await as(GONE, "UPDATE kitchen_recipes SET notes = 'touched' WHERE id = 'cheese-drawer-soup'");
  await as(GONE, "INSERT INTO kitchen_cooking_entries (recipe_id, cook_name) VALUES ('gone-recipe', 'Gone')");
  await as(GONE, "INSERT INTO kitchen_favourites (recipe_id) VALUES ('gone-recipe')");
  const soupVersion = (await admin<{ version: number }>("SELECT version FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'"))[0].version;

  await admin(`DELETE FROM auth.users WHERE id = '${GONE}'`);

  assert.deepEqual(await as(KATHY, "SELECT title FROM kitchen_recipes WHERE id = 'gone-recipe'"), [{ title: "Left behind" }]);
  assert.equal((await as(KATHY, "SELECT * FROM kitchen_cooking_entries WHERE recipe_id = 'gone-recipe'")).length, 1);
  assert.equal((await admin<{ version: number }>("SELECT version FROM kitchen_recipes WHERE id = 'cheese-drawer-soup'"))[0].version, soupVersion,
    "no phantom edit (which would cause false conflicts)");
});

test("running the SQL again keeps all data and the same rules", async () => {
  const before = await admin("SELECT (SELECT count(*) FROM kitchen_recipes) r, (SELECT count(*) FROM kitchen_cooking_entries) e, (SELECT count(*) FROM kitchen_favourites) f, (SELECT count(*) FROM kitchen_recipe_revisions) v");
  const policies = await admin("SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE tablename LIKE 'kitchen_%' ORDER BY 1, 2");
  await runFile(db, KITCHEN_SQL);
  assert.deepEqual(await admin("SELECT (SELECT count(*) FROM kitchen_recipes) r, (SELECT count(*) FROM kitchen_cooking_entries) e, (SELECT count(*) FROM kitchen_favourites) f, (SELECT count(*) FROM kitchen_recipe_revisions) v"), before);
  assert.deepEqual(await admin("SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE tablename LIKE 'kitchen_%' ORDER BY 1, 2"), policies);
  assert.deepEqual(await as(STRANGER, "SELECT * FROM kitchen_recipes"), []);
});
