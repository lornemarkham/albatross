# 0001 — Kitchen's own AI endpoint for cooking suggestions

**Status:** PROPOSED (M629, 2026-11-07). Built and tested, switched **off** until the owner adds a key. Not a recorded decision until Lorne accepts it here and in the doctrine's decision log (§15).

## Context

The M629 brief asks for an AI-assisted cooking companion ("What can I make with what we have?", "Give me three
dinner ideas the family will like"). The doctrine requires AI output to stay distinguishable (§3), forbids invented
preferences or quantities (§4, brief: "Never invent inventory quantities"), and notes Kitchen has no server
endpoint, while model keys must never reach the browser (C7). ELK Inventory's `/api/extract` is the precedent:
a Vercel Edge function that checks `elk_is_family_member()` with the caller's token before touching the key.

## Decision (proposed)

- Kitchen gets its own Edge function, `api/companion.ts`, holding `OPENAI_API_KEY` in **Kitchen's** Vercel project.
  The model is `gpt-4o-mini` (same provider and model as Inventory's extraction, so no new vendor).
- **Family-only, fails closed**: no token / not on the family list / Supabase unreachable / no key → no model call.
- **Grounded**: the browser sends only what Kitchen's own rules found: the family's recipes ranked, each with
  tagged facts (`[pantry]`, `[said]`, `[family]`, `[caution]`, `[missing]`), plus use-soon items, leftovers and food notes.
- **Constrained output** (structured JSON): up to 3 picks *by id from the given recipes* (unknown ids are dropped on
  the server and again in the browser), up to 2 clearly-labelled "AI idea · not a family recipe · not saved", and
  follow-up questions. Nothing the model says is stored.
- **Pantry facts on the page never come from the model**: cards are rendered from Kitchen's own Pantry check.
- It runs only when the person taps **✨ Ask Kitchen's AI for a second opinion**. The rule-based answer always shows first.

## Alternatives

- Add a `kind: "companion"` mode to Inventory's `/api/extract` (no new key in Kitchen). That's Inventory's code
  to change. It's possible later, with a brief to the Inventory workspace.
- No AI: the rule-based companion alone (it already handles the brief's example requests).

## Consequences

- Owner action to switch on: in Vercel project `elk-kitchen`, add `OPENAI_API_KEY` (server-side, **not** `VITE_`) and
  `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publishable), then redeploy. Without them the button says AI isn't switched on.
- Cost: one small chat completion per tap (≤ 40 recipes' titles and ingredient lines).
- Tested with a faked network only (`tests/companion-ai.test.ts`). No live model call was made in M629.
