# ELK Kitchen

Family recipes: the recipe itself (what you plan to make), and a separate
cooking history (each time someone actually made it — what they used,
substitutions, the family's reaction, what to change next time). Favourites
are per person.

**Product authority:** read [`docs/KITCHEN-PRODUCT-DOCTRINE.md`](docs/KITCHEN-PRODUCT-DOCTRINE.md)
before changing how Kitchen behaves. **Releasing:** [`docs/RELEASE.md`](docs/RELEASE.md). There's no approved
release path yet.

```
npm install
npm run dev        # http://localhost:5173
npm test           # model, storage, import/export and SQL/RLS tests (PGlite)
npm run typecheck
npm run build
```

## Sausage day: cook with what I bought (`/plan`)

For batch meat days (built for the owner's 2026-11-07 cook: 15.5 kg of pork butt, beef eye of round and bone-in
chicken thighs into four sausage recipes). Rules and arithmetic in `src/lib/sausage/*`, not AI.

1. **What you bought**: paste label lines ("Pork butt 3.705 kg $31.45") or add by hand. Only what's written is
   filled in; a missing weight or price stays blank. Usable meat and fat % are **typical estimates per cut**
   (`cuts.ts`, labelled on screen) until you type a weighed usable weight or your own fat %. Bone-in chicken is
   flagged: weigh it after boning.
2. **What you're making**: pick sausage recipes. **Suggest a split** gives each meat to the recipes whose original
   used that kind of meat, in the originals' proportions; every number is editable.
3. **Per recipe**: the adaptation ("Pork butt in place of pork tenderloin + pork belly"), blended fat vs the recipe's
   target (with grams of back fat to add if lean), every seasoning **in grams** for the meat weight (from "Salt 2%",
   "18 g/kg", or amounts scaled from the recipe's own meat weight; spoon measures are scaled and flagged "weigh
   once"), casing, food safety (74 °C with chicken in the mix, cure checked against the USDA 2.5 g/kg Cure #1
   limit, hot-smoke only, fermented not guided), and meat cost (per kg usable, then per kg / sausage / serving
   once finished numbers are entered; seasonings and casings aren't costed).
4. **Do you have everything?**: tick what you have; the rest goes to **Pantry's** shopping list (shared mode) or is
   copied (this-device mode). No second list.
5. **Approve**: freezes today's adaptation per recipe. **Cook this** starts the cooking helper with it. The recipe
   itself never changes; editing meat or recipes after approval asks for approval again.

In the cook: "I've finished grinding the pork. Now I'm grinding the chicken." (stage + next instruction, using your
grind preference), "the pork weighs 8.2 kilos" (seasonings redone for the real weight once all meat is weighed),
"how much salt?", one big button per stage. The saved batch keeps the plan, weighed meat, seasonings, substitution
and cost. **Preferences** (grind, plate, grams, goals) start blank and are edited on `/plan`. Plans and preferences
are kept on this device (`elk-kitchen-sausage-plans-v1`, `elk-kitchen-preferences-v1`), not in backups yet; the
batch record (which is backed up) carries the approved plan.

## The family cooking companion (`/tonight`, and the box at the top of the home page)

Ask in plain words, typed or spoken (🎤 listens for **one** request after a tap, then stops):
"What should we cook tonight?", "What can I make with what we have?", "We need to use the leftover chicken",
"What's going bad soon?", "Give me three dinner ideas the family will like", "Add cream to the shopping list",
"We're out of onions". Kitchen's own rules (`src/lib/companion/*`, not AI) rank the **family's recipes**:

- **✓ Pantry**: what ELK Pantry shows, with Pantry's own count, place and best-before date (every open batch).
  "Use soon" comes from best-before dates; leftovers are Pantry products named "leftover…" or after a family recipe.
- **🗣 You said**: ingredients mentioned in the request. They're never treated as stock.
- **★ Family**: only what people recorded: each person's dinner ratings, "make it again?", favourites and the last
  "next time" note.
- **⚠**: someone's food notes say they avoid an ingredient on the list, the dish was made in the last 3 days, or
  someone said "not again". Diet words (vegetarian, vegan, gluten-free, dairy-free) and "no X" are firm rules. When
  nothing fits, Kitchen loosens them one at a time and says which.
- **Shopping?**: Pantry shows none left (ticked), or Pantry doesn't know (unticked; never assumed missing).

Shopping requests open a list you can edit and tick before anything is sent. It goes to **Pantry's** shopping list
through `pantry_shopping_add`: "manual" for things you asked for, "recipe" with "for <title>" for a recipe's
missing items. Duplicates already on the open list are skipped. If Pantry still shows some, the line says so.
Kitchen never changes stock from here.

**Food notes** (on `/tonight`): each person writes what they avoid and like. In shared mode only the person can write
their own notes, and the family can read them. Kitchen flags; it is not an allergy check.

**✨ AI second opinion** (optional, shared mode only, switched off until the owner adds a key): see
[`docs/decisions/0001-kitchen-ai-endpoint.md`](docs/decisions/0001-kitchen-ai-endpoint.md). It picks only among the
family's recipes it was sent, its words are labelled AI, and Pantry facts on the page always come from Pantry.

## Family dinner feedback ("How was dinner?" on each batch's journal)

Everyone who ate leaves their own rating (0–10), comment, photos, "make it again?" (yes / maybe / no) and one thing
to change, and can mark the recipe a favourite. The cook is taken there after saving a cooking session.

- **Shared mode** (`kitchen.sql` v5, `kitchen_meal_feedback`): one say per person per dinner, under their name on the
  family list. Only they can change it, and every change keeps the earlier answer (`history`). Nothing can be deleted
  through the API. A dinner others have rated can't be removed by the cook.
- **This phone**: type who it's from. Several people can rate on one phone. **Backup & import** carries the feedback
  and the food notes. Importing into shared mode keeps each rating under the name typed on the phone, marked
  "brought in from its backup", read-only, once.

## Cooking companion additions (Start cooking)

Besides the commands below: "I used butter instead of oil" / "swapped the oil for butter" (kept as the batch's
substitution; amounts don't change), "double the recipe" / "half the recipe" (reads the recipe's own amounts back
scaled, and changes nothing), and questions like "what goes in the dressing?" or "which plate do I grind through?"
(answered from the recipe's own text, or "the recipe doesn't say").

**What should we cook?** (the older prototype) is at `/ideas`, in every build (read-only; its
example ideas and keyword replies are labelled as such on the page). See
[`docs/prototypes/WHAT-SHOULD-WE-COOK.md`](docs/prototypes/WHAT-SHOULD-WE-COOK.md).

## Photograph a recipe (`/add/photo`)

Family members only. Photos (up to 6 pages of one recipe, shrunk in the
browser to fit one ~3.5 MB request) go to **ELK Inventory's** `/api/extract`
with `kind: "recipe"`, reached through the same-origin rewrite in
`vercel.json` (`vite.config.ts` proxies it in dev). That endpoint holds the
OpenAI key, checks the sign-in token against `elk_is_family_member()` before
touching it, and streams its answer so slow multi-page reads survive Vercel
Edge's 25 s limit. The answer fills in the recipe form, with anything the
model couldn't read listed above it; nothing is saved until the person
presses Save. Since M631 the card photos are also kept as the recipe's first photos ("Original card",
removable in the form), so the handwriting stays next to what was read from it; anything the reader couldn't
make out is listed above the form for you to confirm. Kitchen's Vercel project has
no OpenAI key and needs none.

## ELK Pantry (`/pantry`, recipe pages, `/ideas`)

Read-only for stock. Kitchen reads Inventory's `inventory_items` (domain
`food-storage`) and `stock_lots` with the signed-in person's token, so
Inventory's family-only policies decide access. Nothing is copied. The one
write: on a recipe, the person can tick missing ingredients and add them to
Pantry's shared shopping list (`pantry_shopping_add`, from Inventory's
`supabase-pantry.sql`; duplicates already on the list are skipped). Each ingredient line is **have** (Pantry has some), **missing**
(Pantry tracks it and shows none left) or **unknown** (Pantry has no record —
never treated as missing). Pantry counts packages, not amounts.

## Where recipes are saved

| Situation | Saved in |
|---|---|
| No Supabase env vars | This browser only (as before) |
| Signed in, family list or kitchen tables not set up yet | This browser only — the app says so |
| Signed in, on the ELK family list, `supabase/kitchen.sql` applied | **Shared** with every family member, on any device |
| Signed in, not on the family list | Nothing — "You're not on the family list yet" (with a download of this browser's recipes) |

## Who can see recipes

ELK Kitchen does not have its own access list. It uses the **ELK family list**
(`public.elk_family_members` / `public.elk_is_family_member()`) created by ELK
Inventory's `supabase-family-access.sql`, in the same Supabase project. Being
signed in is not enough. Sign-up in that project is open, and it's shared with
another app, so every kitchen table only lets in accounts on that list. The
database enforces this; the app only shows the answer. Adding someone to the
family list (Inventory's runbook, `docs/family-access.md`) gives them both
Inventory and Kitchen.

Sign-in is the same email link as Inventory. There are no passwords.

## Turning on shared recipes (owner)

1. **Family access must already be live.** Inventory's
   `supabase-family-access.sql` must have been run, with you added to the
   list. `kitchen.sql` refuses to run otherwise and changes nothing.
2. **Back up first.** On every browser that has recipes (including the
   `localhost` one where ELK Kitchen was used before), open **Backup & import
   → Export**.
3. Supabase Dashboard → SQL Editor: paste and run all of `supabase/kitchen.sql`.
   It creates only `kitchen_recipes`, `kitchen_cooking_entries`,
   `kitchen_favourites`, `kitchen_recipe_revisions`, and (v5) `kitchen_meal_feedback`
   and `kitchen_member_profiles`. It stops without
   changes if a table with one of those names exists that it didn't create.
   It's safe to re-run.
4. Supabase → Authentication → URL Configuration → **Redirect URLs**: add the
   ELK Kitchen address (e.g. `https://elk-kitchen.vercel.app/**`, and
   `http://localhost:5173/**` for local use). Without this, sign-in links
   land on the project's default site (ELK Inventory) instead.
5. Vercel project `elk-kitchen` → Settings → Environment Variables (Production):
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Use the same **publishable**
   values as the `elk-inventory` project, never a secret or `service_role` key.
   Then redeploy. The values are baked in at build time, so an existing
   deployment keeps running on this device only until it's rebuilt.
   Builds from git need **Settings → Build and Deployment → Root Directory**
   set to `elk-kitchen` (this app lives in a subdirectory of the `albatross`
   repo); with the default `.` they fail with `vite: command not found`.
   Deploying with `vercel --prod` from this directory works either way.
6. Check behaviour: run `supabase/kitchen-verify.sql` in the SQL Editor. It
   acts as a family member, a signed-in stranger and a signed-out caller,
   tries real reads and writes, undoes them, and shows PASS/FAIL per check.
   Every row should be PASS. And the policies themselves — every row should
   mention `elk_is_family_member`:

   ```sql
   SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE tablename LIKE 'kitchen_%';
   ```

   Opening ELK Kitchen should now show a sign-in screen, not the recipe list.
   If it goes straight to recipes with "Saved on this device only", the
   deployment was built without the Supabase variables.

   Then sign in from a private window with a throwaway email. You should see
   "not on the family list". Delete that user afterwards.

## Bringing existing recipes in

Recipes from before this release live only in the browser that ran the old
app, under the `localStorage` key `elk-kitchen-recipes`. Nothing in this
release writes to or deletes that key.

- **Same browser:** open ELK Kitchen there and sign in. The list shows
  "N recipes are saved on this device but not in the family collection →
  Review and import".
- **Any other way:** **Backup & import → Export** on the old browser, then
  **Choose an export file…** on the shared site. Import also accepts the raw
  contents of the old `elk-kitchen-recipes` key.

What import does:

- Keeps recipe ids. An old recipe becomes a recipe, plus a first cooking
  entry (date cooked, cook, changes → substitutions, improve next time,
  rating). The original record is kept verbatim in the recipe's `legacy`
  column.
- Never overwrites anything. A recipe whose id is already there is left as
  it is; only cooking entries that are missing are added. Importing the same
  file twice, or two people importing the same file, adds nothing.
- Shows each recipe before importing. A recipe with a different id but the
  same title as one already there is assumed to be a copy and starts
  unticked.

## Safety rules (enforced in `supabase/kitchen.sql`)

- Recipes can't be destroyed through the app or the API. **Delete** (with a
  confirmation) sets `removed_at`: the recipe leaves everyone's book, keeps
  its history and stays in backups, and can be restored from **Recently
  removed**. Who and when are set by the database.
- Every edit must name the version it started from. If someone else saved
  first, nothing is written. The editor keeps what you typed, shows what they
  changed, and lets you save both (yours only replaces fields you both
  edited) or load theirs. Every earlier version is kept in
  `kitchen_recipe_revisions`.
- Cooking history is append-only. People can remove only the entries they
  recorded, after a confirmation.
- There's no Reset button. The old one deleted everything without asking.

## Boundary with ELK Inventory

Kitchen owns recipes, cooking sessions, batches (cooking history), substitutions, reactions,
improvements and favourites. Inventory owns physical stock: quantities, lots, locations and
stock movements. Kitchen keeps no stock records of its own.

Kitchen reads Inventory's pantry tables with the signed-in person's token (above), and changes
stock **only** through Inventory's own family-only functions, after the person confirms each change on
the cook's review screen (`src/lib/pantryStock.ts`):

| Kitchen action | Inventory function | Notes |
|---|---|---|
| "Use 2 packs of pork shoulder from the Garage freezer batch" | `pantry_use(item, quantity, lot, request id)` | Whole packages only. A chosen lot, or oldest first. Inventory refuses and changes nothing if there isn't enough. |
| "Put 6 packs of sausage in the chest freezer, best before …" | `pantry_receive(item, quantity, place, best before, made on, new name, unit, request id)` | A new Pantry product if the name is new. |
| Undo either of those | `pantry_undo(batch id)` | Once. |
| Add missing ingredients to the shopping list | `pantry_shopping_add` | As before. |

Each call carries a request id that Kitchen generates and keeps until it succeeds. A retry (weak
connection, double tap) does nothing a second time. The batch keeps a receipt of each change
(item, lot, count, request id), and Inventory keeps the movement history. Opening a recipe or
starting a cook never changes stock (doctrine §7). Spoken grams are never turned into stock
changes: Pantry counts packages. Tests run these calls against verbatim copies of Inventory's SQL
(`tests/fixtures/inventory-*.sql`; `tests/pantry-stock.test.ts`).

Known gap (Inventory's to decide): `pantry_receive` records finished food with lot source
`purchase`, and its movements can't reference the Kitchen batch. A `p_source`/`p_note` parameter
in Inventory would make "made in Kitchen" visible there.

## Start cooking (hands-free cooking sessions)

`/cook` → pick a recipe (or "something new") → the cooking screen.

- **Microphone:** tap the big button to talk. By default it listens for one thing, then stops.
  "Keep listening until I tap stop" is an opt-in. It also stops on "stop listening", on a tap, and
  whenever the page is hidden. There's no wake word and no always-on mic. Uses the browser's own
  speech recognition (Chrome/Android, Safari/iOS). Where it's missing, type instead.
- **Commands** (`src/lib/cooking/parse.ts`, rule-based, not AI): "Add 40 grams of salt",
  "Change that to 35 grams", "Start a 20-minute timer", "What's the next step?", "Read that
  again", "Make a note for next time", "How much pepper do I need for 3 kilograms?" (only from
  the recipe's own ratios), temperatures, equipment, tasting notes, "stop listening". Anything else
  is kept as a note.
- **Never silent:** a quantity with no unit, a correction that halves or doubles a number or changes
  its unit, an ingredient said twice, a removal, or a temperature with no unit is *asked*
  (Yes / No, by voice or tap). Nothing changes until "yes". Every change keeps its history
  ("said 40 g, corrected → 35 g").
- **Kept:** the transcript exactly as heard, timestamped events, timers, temperatures, photos,
  short clips (≤ 15 MB), voice notes, and ingredient edits by hand. The whole session is saved to the
  phone after every change (`elk-kitchen-cooking-v1`), so a reload or a locked phone loses nothing.
- **Finish → Review:** Kitchen fills in the batch (what went in, equipment, temperatures and
  times, tasting notes, next time, notes) from the session. The person edits it, confirms
  Pantry use and puts the finished food into Pantry, then saves. The batch stores the session
  (`session`, in the `extra` JSON column in shared mode), so the journal, transcript and media
  come back with the batch, in backups and imports too. A cook with no recipe is saved as a new
  recipe.
- **Journal:** `/recipe/:id/batch/:entryId` (timeline with media, transcript, Pantry receipts) and
  `/history` (every cook, newest first).

What it doesn't do yet: no AI rewriting of the session. The summary is assembled by rules from
what was said, so it's predictable. An AI pass would need a server endpoint (Inventory's
`/api/extract` holds the only key) and a review step, and it's a separate decision. Voice notes are
kept as audio and aren't transcribed. Clips and voice notes in shared mode need `kitchen-photos.sql` v2.

## Known gaps (follow-ups)

- If you're signed out mid-edit (for example, signing out in another tab),
  the open form is replaced by the sign-in screen and anything not yet saved
  is lost.
- Once this release has written its own device data, recipes written later
  by the *old* app under `elk-kitchen-recipes` (only possible from an old tab
  left open) aren't offered for import automatically. They're still included
  in **Export** (`legacyBrowserRecipes`), and importing that file picks them up.

## Weekend release: jerky, sausage, batches and photos

- **Recipes** have a type (everyday / jerky / sausage), a category, tags, and any
  number of photos. Jerky and sausage recipes add meat weight, fat %, seasoning
  ratios (one per line, "Salt 2%" → grams for the meat weight), marinade,
  grinding plate, casing and planned smoking/cooking temperatures.
- **Batches** (`/recipe/:id/cook`) are separate entries: date, what was used,
  substitutions, equipment, temperatures and times, yield, photos, tasting notes,
  rating, "next time", plus the jerky/sausage numbers (internal temp, finished
  weight, yield %). Recording a batch never changes the recipe.
- **Food safety** text and the temperature warnings follow USDA FSIS (160 °F /
  71 °C for ground meat, 165 °F / 74 °C poultry; jerky dried at 130–140 °F+).
  They are prompts, not a guarantee — see `src/lib/meat.ts` for sources.
- **Storage.** Without `VITE_SUPABASE_*` (the current production build) everything
  — recipes in localStorage, photos in IndexedDB (shrunk to 1600 px, read back
  after saving, persistent storage requested) — stays on that phone. **Backup &
  import** writes one JSON file that includes the photos, and restoring it adds
  without overwriting. Take a backup after each cook until the shared database
  is switched on.
- **Shared mode** needs, in order: `kitchen.sql` (v5 adds family dinner feedback and food notes; v3 adds an `extra` JSON column
  to the recipe and batch tables; v4 lets a batch's `extra` hold a cooking session, up to
  1 000 000 characters; additive, re-runnable), then
  `kitchen-photos.sql` (v2: private `kitchen-photos` bucket for photos, clips and voice
  notes, family-only read/add, no delete), then `kitchen-verify.sql`; then the Vercel env vars above.
  Shared-mode photo upload has been tested against PGlite policies only, not a
  live Supabase Storage bucket.
