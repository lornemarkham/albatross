// ── /api/companion — Kitchen's optional AI pass (docs/decisions/0001, PROPOSED) ──
// The ONLY place Kitchen reads OPENAI_API_KEY; it never reaches the browser.
// Vercel Edge Function, Web-standard Request/Response, no npm dependency.
//
// Family members only: the caller's Supabase token is checked by asking the
// database itself (elk_is_family_member() through PostgREST), as ELK
// Inventory's /api/extract does. Fails closed. Without OPENAI_API_KEY it
// answers 503 "not switched on", and Kitchen's own rule-based suggestions
// are all the person sees.

import { AI_RESPONSE_SCHEMA, AI_SYSTEM_PROMPT, checkAiReply, parseAiRequest } from "../src/lib/companion/ai";

export const config = { runtime: "edge" };

const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 20_000;
const CHECK_TIMEOUT_MS = 5_000;
const MAX_BODY_CHARS = 60_000;

type Env = { openaiKey?: string; supabaseUrl?: string; anonKey?: string; fetchImpl?: typeof fetch };

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function isFamilyMember(req: Request, env: Env): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(req.headers.get("authorization")?.trim() ?? "");
  if (!m) return { ok: false, status: 401, error: "Sign in to use Kitchen's AI." };
  if (!env.supabaseUrl || !env.anonKey) return { ok: false, status: 503, error: "Kitchen's AI isn't switched on yet." };
  try {
    const res = await (env.fetchImpl ?? fetch)(`${env.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/elk_is_family_member`, {
      method: "POST",
      headers: { apikey: env.anonKey, Authorization: `Bearer ${m[1]}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, status: 401, error: "Sign in to use Kitchen's AI." };
    if (!res.ok || (await res.json()) !== true) return { ok: false, status: 403, error: "Kitchen's AI is for family members only." };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: "Kitchen's AI is unavailable right now." };
  }
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Family check first: before the body is read or the key is touched.
  const gate = await isFamilyMember(request, env);
  if (!gate.ok) return json({ error: gate.error }, gate.status);
  if (!env.openaiKey) return json({ error: "Kitchen's AI isn't switched on yet." }, 503);

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: "That request is too big." }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return json({ error: "Invalid request body" }, 400); }
  const req = parseAiRequest(parsed);
  if (!req) return json({ error: "Invalid request body" }, 400);

  try {
    const res = await (env.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(req) }],
        response_format: { type: "json_schema", json_schema: { name: "kitchen_companion", strict: true, schema: AI_RESPONSE_SCHEMA } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[api/companion] model returned ${res.status}`);
      return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
    return json({ reply: checkAiReply(JSON.parse(content), req), model: MODEL }, 200);
  } catch (err) {
    console.error("[api/companion] failed:", err);
    return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
  }
}

export default function handler(request: Request): Promise<Response> {
  return handle(request, {
    openaiKey: process.env.OPENAI_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
  });
}
