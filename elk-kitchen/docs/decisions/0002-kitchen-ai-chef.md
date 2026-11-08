# 0002 — Kitchen's AI chef: a grounded cooking conversation

**Status:** PROPOSED (M639, 2026-11-08). Built and tested with a faked network. Switched **off** until the owner adds a
key (the same switch as 0001). It is not a recorded decision until Lorne accepts it here and in the doctrine's decision
log (§15).

Builds on [0001](0001-kitchen-ai-endpoint.md) and uses the same endpoint, gate, provider and key. 0001's
"second opinion" mode stays in the endpoint. The page no longer uses it.

## Context

The M639 brief asks Kitchen to "replace the current keyword-based recommendation experience with a genuine AI-assisted
cooking conversation", to generate new recipes from what the household has as well as pick family recipes, to
"clearly identify generated recipes", to "never invent pantry quantities or claim ingredients are available without
evidence", and to "provide graceful fallback when AI is unavailable".

## Decision (proposed)

- **Rules first, always.** `src/lib/chef/*` turns what was said into foods, each with an intent: have, use or made. It
  grounds every food in evidence: `inventory` (ELK Inventory), `recent` (Kitchen's cooking history or Sausage Day
  record) or `said` (this conversation). Then it offers Kitchen's own dish ideas, drawn from 16 templates, and the
  family's recipes that fit. This answer shows immediately, offline, with AI off, and in this-device mode.
- **AI adds to it.** When the person is signed in as family, the page sends `mode: "chef"` to `/api/companion` with
  that same evidence, the last 6 turns, constraints, each person's recorded tastes, and the family recipes (by id).
- **Evidence is enforced twice, on the server and again in the browser** (`checkChefReply`). An ingredient keeps
  `have` only if Kitchen holds evidence for that food. Matching runs in one direction: "shredded cheese" counts as the
  household's cheese, but "cream cheese" doesn't. Food past its best-before date never counts. Unknown recipe ids are
  dropped. Pantry counts on the page always come from Pantry.
- **Labelled and not saved.** The page shows "✨ AI recipe · not a family recipe · not saved unless you cook and save
  it". Cooking one carries the idea into the session as a `draft`. It becomes a recipe only on the review screen. The
  recipe is tagged `ai-generated` and its notes say which model, when, and the question it answered.
- **Model:** `gpt-4o-mini` by default, the same as ELK Inventory's `/api/extract`, so no new vendor. Setting
  `KITCHEN_AI_MODEL` on the server changes it without a code change. Temperature is 0.7, output is capped at 2,200
  tokens, and the response uses strict JSON schema. The endpoint logs token counts only, never content.

## Alternatives

- Claude (Anthropic) or another provider. That would add a second vendor and key; Inventory already uses OpenAI. The
  model setting makes a later switch a configuration change only if the provider's API is OpenAI-compatible.
  Otherwise it needs a small adapter.
- Rules only. These already answer the brief's game-day example well. AI adds dishes outside the 16 templates,
  free-form follow-ups and better wording.

## Consequences

- Owner action to switch it on (the same as 0001): in Vercel project `elk-kitchen`, set `OPENAI_API_KEY`
  (server-side, no `VITE_`), `SUPABASE_URL` and `SUPABASE_ANON_KEY`, plus the shared-mode `VITE_SUPABASE_*`. The AI
  is family-only, so it can't run in this-device mode.
- **Estimated cost** (gpt-4o-mini list price as last known, $0.15 per 1M input and $0.60 per 1M output tokens;
  re-check before relying on it): a chef turn is about 3–6k input and 0.8–1.5k output tokens, so roughly
  $0.001–0.002 per question. 20 questions a day comes to about $1 a month. The page asks once per question; follow-ups
  are new questions.
