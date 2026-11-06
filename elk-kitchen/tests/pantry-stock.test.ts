// Kitchen ↔ ELK Pantry stock, against Inventory's real SQL (verbatim copies in
// tests/fixtures: the version production runs, and the next one). Kitchen's
// calls go through a stand-in for supabase-js that runs each request as the
// signed-in person, so Inventory's own rules (family only, enough stock,
// retry-safe request ids) are what's being exercised.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseLikeDb, runFile, asUser, addMember } from "./supabase-harness";
import { candidates, loadStock, receiveFinished, undoStock, useStock, type StockItem } from "../src/lib/pantryStock";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const STRANGER = "00000000-0000-0000-0000-0000000000ff";

// supabase-js, as far as pantryStock.ts uses it: from().select().eq().limit() and rpc().
function clientAs(db: PGlite, uid: string): SupabaseClient {
  const as = asUser(db);
  // PostgREST sends dates as text ("2026-12-01"); PGlite hands back Date objects.
  const text = (v: unknown) => (v instanceof Date ? (v.toISOString().endsWith("T00:00:00.000Z") ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
  const run = async (sql: string, params: unknown[]) => {
    try { return { data: (await as(uid, sql, params)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)]))), error: null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }; }
  };
  return {
    from(table: string) {
      let cols = "*"; const where: string[] = []; const params: unknown[] = [];
      const b = {
        select(c: string) { cols = c; return b; },
        eq(k: string, v: unknown) { params.push(v); where.push(`${k} = $${params.length}`); return b; },
        limit() { return b; },
        then(res: (r: unknown) => unknown, rej: (e: unknown) => unknown) {
          return run(`SELECT ${cols} FROM public.${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`, params).then(res, rej);
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

for (const [label, pantrySql] of [["production (main @ b1e3f3f)", "tests/fixtures/inventory-main-supabase-pantry.sql"], ["next (pantry-family-kitchen @ 8bf1753)", "tests/fixtures/inventory-next-supabase-pantry.sql"]] as const) {
  let db: PGlite;
  const admin = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

  before(async () => {
    db = await supabaseLikeDb();
    await runFile(db, "tests/fixtures/inventory-main-supabase-schema.sql");
    await runFile(db, "tests/fixtures/elk-family-access.sql");
    await runFile(db, pantrySql);
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'alice@example.com'), ('${STRANGER}', 'x@example.com');
      INSERT INTO inventory_items (id, name, domain, current_zone, recommended_zone, location_detail, quantity, attributes)
      VALUES ('pork-01', 'Pork shoulder', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Chest freezer', 0, '{"unit":"packs"}'),
             ('casing-01', 'Hog casings', 'food-storage', 'storage-room-pantry', 'storage-room-pantry', 'Fridge', 0, '{"unit":"hanks"}');
    `);
    await addMember(db, ALICE, "Alice");
    const as = asUser(db);
    await as(ALICE, "SELECT pantry_receive('pork-01', 2, 'Chest freezer', '2026-12-01', '2026-09-01')");
    await as(ALICE, "SELECT pantry_receive('pork-01', 3, 'Garage freezer', '2027-02-01', '2026-10-15')");
    await as(ALICE, "SELECT pantry_receive('casing-01', 1, 'Fridge', NULL, '2026-10-01')");
  });

  const stock = async (uid = ALICE) => {
    const r = await loadStock(clientAs(db, uid));
    assert.equal(r.status, "ready");
    return (r as { items: StockItem[] }).items;
  };

  test(`${label}: Kitchen sees quantities and lots, oldest first`, async () => {
    const pork = (await stock()).find((i) => i.name === "Pork shoulder")!;
    assert.equal(pork.onHand, 5);
    assert.equal(pork.unit, "packs");
    assert.deepEqual(pork.lots.map((l) => [l.location, l.remaining, l.bestBefore]), [["Chest freezer", 2, "2026-12-01"], ["Garage freezer", 3, "2027-02-01"]]);
    assert.deepEqual(candidates("3 kg pork shoulder, cubed", await stock()).map((i) => i.name), ["Pork shoulder"]);
    assert.deepEqual(candidates("black pepper", await stock()), []);
  });

  test(`${label}: using a chosen lot changes only that lot, once, even if retried`, async () => {
    const pork = (await stock()).find((i) => i.name === "Pork shoulder")!;
    const garage = pork.lots[1];
    const client = clientAs(db, ALICE);
    const r = await useStock(client, { item: pork, lot: garage, quantity: 2, requestId: "11111111-1111-1111-1111-111111111111" });
    assert.ok(r.ok, !r.ok ? r.error : "");
    // The same confirmation arriving twice (weak connection, double tap).
    const again = await useStock(client, { item: pork, lot: garage, quantity: 2, requestId: "11111111-1111-1111-1111-111111111111" });
    assert.ok(again.ok);
    const after = (await stock()).find((i) => i.name === "Pork shoulder")!;
    assert.deepEqual(after.lots.map((l) => [l.location, l.remaining]), [["Chest freezer", 2], ["Garage freezer", 1]]);
    assert.equal(after.onHand, 3);
    // Inventory's own history records it as one 'used' movement.
    const moves = await admin<{ kind: string; quantity_delta: number }>("SELECT kind, quantity_delta FROM stock_movements WHERE batch_id = '11111111-1111-1111-1111-111111111111'");
    assert.deepEqual(moves.map((m) => [m.kind, m.quantity_delta]), [["used", -2]]);
    // Undo puts it back where it came from.
    const u = await undoStock(client, (r as { action: Parameters<typeof undoStock>[1] }).action);
    assert.ok(u.ok);
    assert.equal((await stock()).find((i) => i.name === "Pork shoulder")!.onHand, 5);
  });

  test(`${label}: not enough stock, fractions and strangers change nothing`, async () => {
    const pork = (await stock()).find((i) => i.name === "Pork shoulder")!;
    const client = clientAs(db, ALICE);
    const short = await useStock(client, { item: pork, lot: pork.lots[0], quantity: 9 });
    assert.equal(short.ok, false);
    assert.match((short as { error: string }).error, /Only 2 left in that batch/);
    const half = await useStock(client, { item: pork, lot: null, quantity: 0.5 });
    assert.equal(half.ok, false);
    const stranger = await useStock(clientAs(db, STRANGER), { item: pork, lot: null, quantity: 1 });
    assert.equal(stranger.ok, false);
    assert.equal((await stock()).find((i) => i.name === "Pork shoulder")!.onHand, 5);
  });

  test(`${label}: finished sausages go into the freezer as a new Pantry product with a best-before`, async () => {
    const client = clientAs(db, ALICE);
    const r = await receiveFinished(client, {
      item: null, newName: "Garlic pork sausage", unit: "packs", quantity: 6, location: "Chest freezer",
      bestBefore: "2027-01-15", madeOn: "2026-11-07", requestId: "22222222-2222-2222-2222-222222222222", newItemId: "kitchen-sausage-1",
    });
    assert.ok(r.ok, !r.ok ? r.error : "");
    // Retry-safe too.
    await receiveFinished(client, { item: null, newName: "Garlic pork sausage", unit: "packs", quantity: 6, location: "Chest freezer", bestBefore: "2027-01-15", madeOn: "2026-11-07", requestId: "22222222-2222-2222-2222-222222222222", newItemId: "kitchen-sausage-1" });
    const made = (await stock()).find((i) => i.name === "Garlic pork sausage")!;
    assert.equal(made.onHand, 6);
    assert.equal(made.unit, "packs");
    assert.deepEqual(made.lots.map((l) => [l.location, l.bestBefore, l.purchasedOn]), [["Chest freezer", "2027-01-15", "2026-11-07"]]);
    const [item] = await admin<{ domain: string }>("SELECT domain FROM inventory_items WHERE id = 'kitchen-sausage-1'");
    assert.equal(item.domain, "food-storage");
  });
}
