# 0003 — Naming food from a photo (PROPOSED, built switched off)

**Status:** Proposed. Needs Lorne's acceptance, and the same `OPENAI_API_KEY` as ADR 0001/0002 on the `elk-kitchen` Vercel project. Nothing is purchased or deployed by this change.

## Context
Add Food (`/food`) lets someone photograph food. Naming it from the picture needs vision AI. That is a new data flow: a photo of household food leaves the phone for a third party.

## Decision (proposed)
- `/api/companion` gets `mode: "food-photo"`, behind the same family-member check and the same missing-key 503 as the other modes.
- Only a downscaled JPEG (long side 768 px, one photo) is sent, and only after the person taps "Suggest what it is from the photo". Kitchen stores nothing from the reply.
- The model is told to give up to four names with low/medium/high confidence, to say "cannot tell" instead of guessing, and not to give quantities, brands, dates or safety claims. `checkFoodPhotoReply` enforces that shape and drops anything else.
- A suggestion is never a record. The person edits and saves; the note keeps `nameFrom` (`you-said`, `photo-suggested`, `photo-suggested-edited`), the suggestion and its confidence.
- Without the key, offline or unsure, the page says so and the person describes the food instead.

## Consequences
Cost is one small vision call per tap (default model `gpt-4o-mini`, `KITCHEN_AI_MODEL` overrides). To reject: leave the key unset, or delete `foodPhoto` in `api/companion.ts`; Add Food keeps working.
