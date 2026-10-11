# Prototype — "What should we cook today?"

**Status:** Phase 2 design prototype (2026-10-10). Not a product decision.
Everything here is **Proposed** in the sense of the
[product doctrine](../KITCHEN-PRODUCT-DOCTRINE.md). It doesn't close any open
question in §12, and it doesn't authorise building the backend it sketches.

## How to look at it

**Online:** https://elk-kitchen.vercel.app/ideas — no Vercel login.

```
npm run dev            # or locally: http://localhost:5173/ideas
```

### Why the public URL is safe

- Production Kitchen is built **without** Supabase variables (README step 5
  hasn't been done). So every visitor's Kitchen, `/ideas` included, reads
  only **that visitor's own browser storage**. There's no family data on the
  server for it to show.
- If the Supabase variables are added later, `/ideas` sits inside the same
  family sign-in and RLS check as the rest of Kitchen, so it stays private.
- The sample Pantry is pretend data and is **off by default**. Nothing reads
  Inventory.
- `.vercelignore` stops `.env.local` (shared Supabase project) being
  uploaded to a Vercel build.

### Deploying (and removing) it

```
vercel --prod --build-env VITE_KITCHEN_PROTOTYPE=1
```

Run this from this directory. The flag only adds the lazy `/ideas` chunk.
Every other route is byte-for-byte the normal app. A plain `vercel --prod`
(or a git build) leaves `/ideas` out again, so it fails safe: the prototype
just disappears. To roll back instantly, promote the previous deployment
with `vercel promote <url>`.

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

## Phase 2 changes (what's new)

- **Three ways in**, plus ideas on first load. *Surprise me* gives three
  dinners (mains only) with a 🎲 re-roll. *Use what we have* is about 26 tap
  chips (chicken, peppers, rice…). *I'm in the mood for…* offers meal,
  feeling, "something with…" and an eating-well goal. Before anyone taps,
  "A few ideas for tonight" is already showing.
- **About tonight** (optional): who's eating (2/4/6/8+, kids too), time,
  weather. Cards open scaled to the number of people.
- **Weather**: tap a chip, or **📍 Check**. That asks once for location,
  rounds it to about 10 km, and calls Open-Meteo (no key, nothing stored).
  The source is shown ("12°C, rain nearby · Open-Meteo").
- **Recently cooked**: family recipes recorded in the last 3 days aren't
  offered for tonight or Surprise. Long-unmade favourites say "Not made
  since Aug 1".
- **Use what we have** is honest by default. Pantry starts *not connected*.
  A chip confirms only what its word covers ("onions" isn't the red onion),
  and the person's own word is quoted back. Family recipes only ever get
  "Your recipe mentions rice".
- **Mood narrowing.** Meal, "with…", BBQ and time are firm rules. Feelings
  and goals only rank. If nothing fits, rules loosen one at a time and the
  page says which ("these leave out **with potatoes**").
- **Nutrition**: alongside the blank numbers ("Not measured"), it now shows
  facts read off the ingredient list: vegetables (count and names), protein
  from, fibre from, and serving as 1 of N. It's labelled *"Read from the
  ingredient list · not measured"*.
- **Cards**: larger, with a clear ⏱ time, serves, key ingredients, and
  photos where openly licensed ones exist (`src/prototype/photos/`, Wikimedia
  Commons, credited, labelled "a similar dish, not this recipe"). Photos are
  imported by the prototype chunk, so normal builds don't carry them.
- **Cook-along**:
  - Timers **keep running across steps**. Before, they reset when you moved
    on.
  - Several can run at once, they ring (beeps, plus vibration on phones),
    and you can tap one to jump back to its step.
  - "For this step" shows scaled quantities. If a word is ambiguous it shows
    nothing rather than the wrong amount.
  - Bigger/smaller text, ←/→/space keys, tappable progress steps, and an
    ingredient list you can tick off.

## What it shows (phase 1, still true unless changed above)

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
| **Functional** | Reading recipes, favourites and history (the browser's own, or the family's once shared); reasons drawn from them; recently-cooked filtering; date/season/holiday logic; opt-in Open-Meteo weather; "use what we have" taps; mood narrowing; ingredient-status logic and "use soon"; ingredient-list nutrition facts; scaling; cook-along with persistent timers, alarms and wake lock |
| **Simulated** | "Or just say it" replies (`ideas/conversation.ts`, keyword rules); the 13 example ideas (`ideas/sampleIdeas.ts`, hand-written, rough times); the pretend Pantry (`ideas/samplePantry.ts`, off by default); the "Change it" examples |
| **Deliberately absent** | Calorie/protein/fibre numbers; real Pantry; stored location; inferred tastes; saving anything; shopping list (Q9); pantry deductions |

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
