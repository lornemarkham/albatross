# Prototype — "What should we cook today?"

**Status:** Phase 1 design prototype (2026-10-10). Not a product decision.
Everything here is **Proposed** in the sense of the
[product doctrine](../KITCHEN-PRODUCT-DOCTRINE.md). It doesn't close any open
question in §12, and it doesn't authorise building the backend it sketches.

## How to look at it

```
npm run dev            # then open http://localhost:5173/ideas
```

- The route only exists in the dev server, or in a build made with
  `VITE_KITCHEN_PROTOTYPE=1`. A normal `npm run build` leaves it out entirely
  (no prototype code in the bundle). The homepage `/` is unchanged.
- It sits inside the normal sign-in and family-access check, and **writes
  nothing**. It reads the family's recipes, favourites and cooking history,
  and that's all.
- If `.env.local` points at the shared Supabase project, `/ideas` shows the
  real family recipe book (read only). To look at it without signing in, run
  `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev`. That uses this
  browser's own recipes.

Screens: `/ideas` (home), `/ideas/idea/:id` (an idea),
`/ideas/cook/idea/:id` and `/ideas/cook/saved/:recipeId` (cook along).

## What it shows

1. **Today's ideas.** Eight invitations: Tonight, Use what we have,
   High-protein, Something healthy, Quick and easy, Fire up the BBQ, Family
   favourites, Surprise me. Each one opens a shelf of suggestions. The shelf
   shows **family recipes first** and **new ideas** after, and every card
   gives at least one reason (doctrine §4).
   - "Something healthy" asks *what kind* of healthy (more vegetables, more
     protein, beans & lentils), because healthy isn't a yes/no flag (§6).
2. **Ask Kitchen.** A question box in the hero, with the five example
   requests as chips. Each reply is a sentence or two, then cards, then a
   couple of follow-up chips. Every reply is labelled *"Simulated · keyword
   rules, not AI"* and shows what the rules picked up ("Heard: a feast · 8
   people"). What the person says feeds back into the page:
   - "It's hot" sets the weather.
   - "I have black beans and chicken" answers those pantry questions, in
     their own words ("You said you have chicken").
   - "…for eight" opens the cards scaled to 8.
   
   "What a real Kitchen would know" lists the grounding a live model would
   get.
3. **Pantry awareness.** Each ingredient on an idea is one of:
   - ✓ **Pantry shows it**, with evidence ("Pantry: 3 cans · Pantry shelf")
   - ✕ **Pantry shows none left**
   - **Do you have …? [Yes] [No]**, when Pantry has no record (fridge items, produce)
   - **basic — not checked** (salt, oil)

   Kitchen only says "You have everything" when every non-basic ingredient
   has evidence. A Pantry toggle switches between a *sample* pantry and *not
   connected*, so you can see that it still works with no data at all. "Use
   soon" comes from best-before dates, not purchase order (C6). Family
   recipes, which are free text, only ever get "Pantry *may* have …".
4. **Nutrition.** Each idea has a five-value panel: calories, protein,
   carbs, fat and fibre. It shows provenance labels (Verified / Estimate /
   Typed in) and a legend. **The sample ideas show "—" for everything**,
   because no nutrition source has been chosen (Q2), and inventing numbers is
   exactly what the doctrine forbids. A family recipe's `approxCalories`
   would show as "~550 kcal · Typed in · serving size not recorded" (C2).
5. **Context.** An optional "A little about tonight" row: weather, time,
   what you're cooking with, and Pantry mode. The **date, season and upcoming
   holidays are real**, worked out on the device ("Thanksgiving (Canada) is
   on Monday"). Both countries' Thanksgivings are listed with their country,
   since no location is known. Weather is only what the person taps; there's
   no feed. Favourites and history come only from what the family recorded.
   When there are none, the shelf says so: "Kitchen won't guess what you
   like."
6. **Visual design.** Warm palette, serif display type (system fonts, no
   network), large tap targets, and mobile-first rows that scroll
   sideways. There are no recipe photos to use legitimately, so cards use
   illustrated gradient tiles, labelled as illustrations.
7. **Moving between things.**
   - Ideas → a family recipe goes to the existing `/recipe/:id` page,
     unchanged.
   - Ideas → a new idea opens the detail page: serves stepper, pantry check,
     "Change it", nutrition, method.
   - Detail → **Start cooking** opens cook-along: one step at a time, big
     type, the screen kept awake, and tap-to-start timers found in the step
     text.
   - "Your recipe book" → **Cook along** works on real family recipes too.
     When you finish, it links to the existing **Record a cook** page.
   - "Change it": *Serve 8* really works (arithmetic). Some samples carry a
     hand-written example change (e.g. "Make it vegetarian"), shown the way
     an AI proposal would be: a list of changes, with the original kept. The
     other chips say plainly that they need live AI.

## Functional / simulated / not built

| | |
|---|---|
| **Functional** | Reading family recipes, favourites and history; reasons drawn from them; date/season/holiday logic; ingredient-status logic and "use soon"; scaling; cook-along with timers and wake lock; session-only answers and context |
| **Simulated** | Chat replies (`ideas/conversation.ts`, keyword rules); the 13 sample ideas (`ideas/sampleIdeas.ts`, hand-written ordinary home dishes, rough times); the sample Pantry (`ideas/samplePantry.ts`); the "Change it" examples |
| **Deliberately absent** | Any nutrition numbers for samples; live weather; household location; inferred tastes; saving anything; shopping list (Q9); pantry deductions |

## What needs backend work

- **AI endpoint.** Live conversation and "Change it" need a server-side,
  family-only endpoint, because model keys can't go to the browser (C7).
  Inventory's `api/extract.ts` is the precedent. `groundingFor()` in
  `ideas/conversation.ts` sketches the input. The output should be
  structured (reply text, recipe ids, follow-ups, proposed changes), not
  prose. Scribe shouldn't be reused as-is (C3).
- **Pantry read.** Kitchen needs a read-only view of Pantry stock. It could
  be a SECURITY DEFINER function or view in Inventory's SQL that returns what
  `PantryItem` in `ideas/types.ts` holds: name, on hand, unit, earliest
  best-before, location. That keeps Kitchen off Inventory's tables (README
  boundary).
- **Structured ingredients.** Samples use `{qty, unit, name, kind,
  pantryNames}`. Family recipes are free text, so matching them is only ever
  "possible". This needs ingredient identity (Q1) and some way to handle
  units (C5).
- **Nutrition source.** Choose one (Q2/Q3). Store each value with its
  provenance, as in `ideas/nutrition.ts` (`verified` / `estimated` /
  `entered`, plus the source name).
- **Saving ideas and changes.** "Save to family recipes" and "Keep this
  version" should go through Draft → Review → Approve. A change is saved as a
  household modification alongside the original (§5).
- **Recording what was used.** After cooking, the person confirms what they
  used, then Kitchen calls Inventory's `pantry_use` with the cooking-entry id
  (§7, Q7). Opening or cooking a recipe never deducts anything.
- **Photos.** Recipe photos would need storage, such as a Supabase Storage
  bucket gated by the family list.

## Suggested next steps

1. React to the experience: which invitations, the tone, how much "why"
   to show.
2. Decide whether `/ideas` becomes the home screen (with the recipe book one
   tap away), or a tab.
3. Pantry read contract with Inventory: the smallest one-way read, no writes.
4. Structured ingredients for new and edited recipes, keeping the free text
   alongside them.
5. A server-side AI endpoint for the conversation, returning structured
   cards, with a "this is AI" label carried through to the UI.
6. Nutrition source decision, then provenance-labelled values.

## Notes against the doctrine

- No conflicts with the doctrine were introduced. The prototype uses §4's
  wording rules ("You marked it a favourite", never "You loved this"), §7's
  "never consume on view", and §6's "estimates must be labelled".
- Sample ideas live only in the prototype. They aren't recipes, aren't
  stored, and aren't presented as the family's.
