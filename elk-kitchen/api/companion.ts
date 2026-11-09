// ── /api/companion — Kitchen's AI (docs/decisions/0001 and 0002, PROPOSED) ──
// Two modes, one gate: the original "second opinion" over the family's recipes
// (0001), and `mode: "chef"` — the cooking conversation (0002, src/lib/chef/ai.ts).
// The ONLY place Kitchen reads OPENAI_API_KEY; it never reaches the browser.
// Vercel Edge Function, Web-standard Request/Response, no npm dependency.
//
// Family members only: the caller's Supabase token is checked by asking the
// database itself (elk_is_family_member() through PostgREST), as ELK
// Inventory's /api/extract does. Fails closed. Without OPENAI_API_KEY it
// answers 503 "not switched on", and Kitchen's own rule-based suggestions
// are all the person sees.

import { AI_RESPONSE_SCHEMA, AI_SYSTEM_PROMPT, checkAiReply, parseAiRequest } from "../src/lib/companion/ai";
import { FOOD_PHOTO_MAX_CHARS, FOOD_PHOTO_SCHEMA, FOOD_PHOTO_SYSTEM_PROMPT, checkFoodPhotoReply, parseFoodPhotoRequest } from "../src/lib/food/vision";
import { CHEF_RESPONSE_SCHEMA, CHEF_SYSTEM_PROMPT, checkChefReply, parseChefRequest } from "../src/lib/chef/ai";

export const config = { runtime: "edge" };

// Same provider and model as ELK Inventory's /api/extract. KITCHEN_AI_MODEL overrides it
// (server-side setting in Vercel) without a code change.
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 20_000;
const CHEF_TIMEOUT_MS = 22_000;
const CHEF_MAX_TOKENS = 2_200;
const CHECK_TIMEOUT_MS = 5_000;
const MAX_BODY_CHARS = 60_000;

type Env = { openaiKey?: string; supabaseUrl?: string; anonKey?: string; model?: string; fetchImpl?: typeof fetch };

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
  // A food photo (a small JPEG) is the one request that is allowed to be large.
  if (text.length > FOOD_PHOTO_MAX_CHARS + 2_000) return json({ error: "That request is too big." }, 413);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return json({ error: "Invalid request body" }, 400); }
  const isPhoto = (parsed as { mode?: unknown } | null)?.mode === "food-photo";
  if (text.length > MAX_BODY_CHARS && !isPhoto) return json({ error: "That request is too big." }, 413);
  const MODEL = env.model?.trim() || DEFAULT_MODEL;
  if ((parsed as { mode?: unknown } | null)?.mode === "chef") return chef(parsed, env, MODEL);
  if (isPhoto) return foodPhoto(parsed, env, MODEL);
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

async function chef(parsed: unknown, env: Env, model: string): Promise<Response> {
  const req = parseChefRequest(parsed);
  if (!req) return json({ error: "Invalid request body" }, 400);
  try {
    const res = await (env.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: CHEF_MAX_TOKENS,
        messages: [{ role: "system", content: CHEF_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(req) }],
        response_format: { type: "json_schema", json_schema: { name: "kitchen_chef", strict: true, schema: CHEF_RESPONSE_SCHEMA } },
      }),
      signal: AbortSignal.timeout(CHEF_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[api/companion chef] model returned ${res.status}`);
      return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
    // Token counts only (no content) so the owner can see real usage in Vercel's logs.
    if (body.usage) console.log(`[api/companion chef] ${model} tokens in=${body.usage.prompt_tokens ?? "?"} out=${body.usage.completion_tokens ?? "?"}`);
    return json({ reply: checkChefReply(JSON.parse(content), req), model }, 200);
  } catch (err) {
    console.error("[api/companion chef] failed:", err instanceof Error ? err.name : "error");
    return json({ error: "Kitchen's AI couldn't answer just now." }, 502);
  }
}

// ADR 0003 (PROPOSED): name food in a photo. A suggestion only; checkFoodPhotoReply bounds what comes back.
async function foodPhoto(parsed: unknown, env: Env, model: string): Promise<Response> {
  const req = parseFoodPhotoRequest(parsed);
  if (!req) return json({ error: "That photo couldn't be read. Try another, or describe the food." }, 400);
  try {
    const res = await (env.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: FOOD_PHOTO_SYSTEM_PROMPT },
          { role: "user", content: [{ type: "text", text: req.hint ? `The person typed: ${JSON.stringify(req.hint)}` : "What food is this?" }, { type: "image_url", image_url: { url: req.image, detail: "low" } }] },
        ],
        response_format: { type: "json_schema", json_schema: { name: "kitchen_food_photo", strict: true, schema: FOOD_PHOTO_SCHEMA } },
      }),
      signal: AbortSignal.timeout(CHEF_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[api/companion food-photo] model returned ${res.status}`);
      return json({ error: "Couldn't look at the photo just now. Describe the food instead." }, 502);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return json({ error: "Couldn't look at the photo just now. Describe the food instead." }, 502);
    return json({ reply: checkFoodPhotoReply(JSON.parse(content)), model }, 200);
  } catch (err) {
    console.error("[api/companion food-photo] failed:", err instanceof Error ? err.name : "error");
    return json({ error: "Couldn't look at the photo just now. Describe the food instead." }, 502);
  }
}

export default function handler(request: Request): Promise<Response> {
  return handle(request, {
    openaiKey: process.env.OPENAI_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    model: process.env.KITCHEN_AI_MODEL,
  });
}
