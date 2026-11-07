// Family dinner feedback and food notes (supabase/kitchen.sql v5) against a
// Supabase-shaped Postgres: two family members, a signed-in stranger, anon.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { supabaseLikeDb, runFile, asUser, addMember, inventoryStubs } from "./supabase-harness";

const LORNE    = "00000000-0000-0000-0000-0000000000a1";
const KATHY    = "00000000-0000-0000-0000-0000000000a2";
const STRANGER = "00000000-0000-0000-0000-0000000000f1";

let db: PGlite;
let as: ReturnType<typeof asUser>;
const admin = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

before(async () => {
  db = await supabaseLikeDb();
  as = asUser(db);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES
    ('${LORNE}', 'l@example.com'), ('${KATHY}', 'k@example.com'), ('${STRANGER}', 's@example.com');`);
  await db.exec(inventoryStubs);
  await runFile(db, "tests/fixtures/elk-family-access.sql");
  await addMember(db, LORNE, "Lorne");
  await addMember(db, KATHY, "Kathy");
  await runFile(db, "supabase/kitchen.sql");
  await as(LORNE, "INSERT INTO kitchen_recipes (id, title) VALUES ('chili', 'Chili')");
  await as(LORNE, "INSERT INTO kitchen_cooking_entries (id, recipe_id, cook_name) VALUES ('chili-1', 'chili', 'Lorne')");
});

test("each family member gives their own feedback on the same dinner; everyone sees all of it", async () => {
  await as(LORNE, `INSERT INTO kitchen_meal_feedback (entry_id, recipe_id, rating, comment, make_again)
    VALUES ('chili-1', 'chili', 9, 'Great heat', 'yes')`);
  await as(KATHY, `INSERT INTO kitchen_meal_feedback (entry_id, recipe_id, rating, comment, improvement, make_again, photos)
    VALUES ('chili-1', 'chili', 7, 'Bit salty', 'Half the salt', 'maybe', '[{"id":"p1","caption":"","addedAt":"2026-11-07"}]')`);
  for (const who of [LORNE, KATHY]) {
    const rows = await as<{ author_name: string; rating: string }>(who,
      "SELECT author_name, rating FROM kitchen_meal_feedback WHERE entry_id = 'chili-1' ORDER BY author_name");
    assert.deepEqual(rows.map((r) => [r.author_name, Number(r.rating)]), [["Kathy", 7], ["Lorne", 9]]);
  }
});

test("names, owner and recipe come from the database, not the client", async () => {
  await as(KATHY, `UPDATE kitchen_meal_feedback SET author_name = 'Lorne', user_id = '${LORNE}', recipe_id = 'chili'
    WHERE entry_id = 'chili-1' AND user_id = '${KATHY}'`);
  const [k] = await admin<{ author_name: string; user_id: string }>(
    `SELECT author_name, user_id FROM kitchen_meal_feedback WHERE entry_id = 'chili-1' AND comment = 'Bit salty'`);
  assert.equal(k.author_name, "Kathy");
  assert.equal(k.user_id, KATHY);
});

test("nobody can change or delete someone else's feedback; one say per person per dinner", async () => {
  await as(KATHY, "UPDATE kitchen_meal_feedback SET comment = 'changed' WHERE user_id = $1", [LORNE]);
  const [l] = await admin<{ comment: string }>("SELECT comment FROM kitchen_meal_feedback WHERE user_id = $1", [LORNE]);
  assert.equal(l.comment, "Great heat");
  await assert.rejects(as(KATHY, "DELETE FROM kitchen_meal_feedback"), /permission denied/);
  await assert.rejects(as(LORNE, "INSERT INTO kitchen_meal_feedback (entry_id, recipe_id, rating) VALUES ('chili-1', 'chili', 1)"), /duplicate key/);
});

test("editing your feedback keeps what you said before", async () => {
  await as(KATHY, "UPDATE kitchen_meal_feedback SET rating = 8, comment = 'Better reheated' WHERE user_id = $1", [KATHY]);
  const [k] = await admin<{ version: number; rating: string; history: { rating: number; comment: string }[] }>(
    "SELECT version, rating, history FROM kitchen_meal_feedback WHERE user_id = $1", [KATHY]);
  // Version 2 was the (ignored) forgery attempt above; every edit is kept.
  assert.equal(k.version, 3);
  assert.equal(Number(k.rating), 8);
  assert.equal(k.history.length, 2);
  const last = k.history[k.history.length - 1];
  assert.equal(Number(last.rating), 7);
  assert.equal(last.comment, "Bit salty");
});

test("a dinner other people rated can't be removed from under them", async () => {
  await assert.rejects(as(LORNE, "DELETE FROM kitchen_cooking_entries WHERE id = 'chili-1'"), /foreign key|violates/);
  assert.equal((await admin("SELECT 1 FROM kitchen_cooking_entries WHERE id = 'chili-1'")).length, 1);
});

test("feedback typed on a phone imports under the typed name, once, and stays read-only", async () => {
  const ins = `INSERT INTO kitchen_meal_feedback (id, entry_id, recipe_id, source, author_name, rating)
    VALUES ('dev-fb-1', 'chili-1', 'chili', 'device-import', 'Grandma (on Lorne''s phone)', 10) ON CONFLICT (id) DO NOTHING`;
  await as(LORNE, ins);
  await as(LORNE, ins);
  const rows = await admin<{ author_name: string }>("SELECT author_name FROM kitchen_meal_feedback WHERE id = 'dev-fb-1'");
  assert.deepEqual(rows.map((r) => r.author_name), ["Grandma (on Lorne's phone)"]);
  await assert.rejects(as(LORNE, "UPDATE kitchen_meal_feedback SET rating = 1 WHERE id = 'dev-fb-1'"), /can't be changed/);
});

test("strangers and signed-out callers see and change nothing", async () => {
  assert.deepEqual(await as(STRANGER, "SELECT * FROM kitchen_meal_feedback"), []);
  assert.deepEqual(await as(STRANGER, "SELECT * FROM kitchen_member_profiles"), []);
  await assert.rejects(as(STRANGER, "INSERT INTO kitchen_meal_feedback (entry_id, recipe_id, rating) VALUES ('chili-1', 'chili', 0)"));
  await as(STRANGER, "UPDATE kitchen_meal_feedback SET comment = 'x'");
  assert.equal((await admin("SELECT 1 FROM kitchen_meal_feedback WHERE comment = 'x'")).length, 0);
  await assert.rejects(as(null, "SELECT * FROM kitchen_meal_feedback"), /permission denied/);
  await assert.rejects(as(null, "SELECT * FROM kitchen_member_profiles"), /permission denied/);
});

test("food notes: each person writes only their own; the family reads all", async () => {
  await as(KATHY, "INSERT INTO kitchen_member_profiles (avoids, likes) VALUES ('mushrooms', 'spicy')");
  await as(LORNE, "INSERT INTO kitchen_member_profiles (user_id, avoids) VALUES ($1, 'everything')", [KATHY])
    .catch(() => undefined);
  await as(LORNE, "UPDATE kitchen_member_profiles SET avoids = 'nothing' WHERE user_id = $1", [KATHY]);
  const rows = await as<{ user_id: string; avoids: string }>(LORNE, "SELECT user_id, avoids FROM kitchen_member_profiles ORDER BY avoids");
  const kathy = rows.find((r) => r.user_id === KATHY);
  assert.equal(kathy?.avoids, "mushrooms");
  await assert.rejects(as(KATHY, "DELETE FROM kitchen_member_profiles"), /permission denied/);
});

test("v5 is additive: re-running keeps every rating and note", async () => {
  const count = () => admin("SELECT (SELECT count(*) FROM kitchen_meal_feedback) f, (SELECT count(*) FROM kitchen_member_profiles) p");
  const before = await count();
  await runFile(db, "supabase/kitchen.sql");
  assert.deepEqual(await count(), before);
  const policies = await admin<{ qual: string | null; with_check: string | null }>(
    "SELECT qual, with_check FROM pg_policies WHERE tablename IN ('kitchen_meal_feedback', 'kitchen_member_profiles')");
  assert.equal(policies.length, 6);
  for (const p of policies) assert.match(`${p.qual} ${p.with_check}`, /elk_is_family_member/);
});
