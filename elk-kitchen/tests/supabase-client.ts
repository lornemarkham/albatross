// supabase-js, as far as Kitchen's code uses it, run as one signed-in person
// against PGlite, so RLS and the real SQL decide everything. The same stand-in
// as tests/family-pilot.test.ts, shared for the chef tests.
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asUser } from "./supabase-harness";

type Err = { message: string; code?: string };
export function supabaseAs(db: PGlite, uid: string): SupabaseClient {
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
