# ELK Kitchen

Family recipes: the recipe itself (what you plan to make), and a separate
cooking history (each time someone actually made it — what they used,
substitutions, the family's reaction, what to change next time). Favourites
are per person.

**Product authority:** read [`docs/KITCHEN-PRODUCT-DOCTRINE.md`](docs/KITCHEN-PRODUCT-DOCTRINE.md)
before changing how Kitchen behaves.

```
npm install
npm run dev        # http://localhost:5173
npm test           # model, storage, import/export and SQL/RLS tests (PGlite)
npm run typecheck
npm run build
```

**Prototype:** a "What should we cook tonight?" home is at `/ideas`
(read-only). It's in `npm run dev`, and in production only when deployed with
`--build-env VITE_KITCHEN_PROTOTYPE=1`. See
[`docs/prototypes/WHAT-SHOULD-WE-COOK.md`](docs/prototypes/WHAT-SHOULD-WE-COOK.md).

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
   `kitchen_favourites` and `kitchen_recipe_revisions`. It stops without
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
6. Check: run this in the SQL Editor; every row should mention
   `elk_is_family_member`:

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

- Recipes can't be deleted through the app or the API.
- Every edit must name the version it started from. If someone else saved
  first, nothing is written. The editor keeps what you typed, shows what they
  changed, and lets you save both (yours only replaces fields you both
  edited) or load theirs. Every earlier version is kept in
  `kitchen_recipe_revisions`.
- Cooking history is append-only. People can remove only the entries they
  recorded, after a confirmation.
- There's no Reset button. The old one deleted everything without asking.

## Boundary with ELK Inventory (not built yet)

Kitchen owns recipes, cooking history, substitutions, reactions,
improvements and favourites. Inventory owns physical stock: quantities,
locations, lots and consumption movements. Kitchen never reads or writes
Inventory's tables. When "I cooked this" should use up pantry stock, the
plan is for Kitchen to call Inventory's own `pantry_*` functions
(oldest-first use), referencing a cooking entry id, rather than keeping any
stock records of its own.

## Known gaps (follow-ups)

- If you're signed out mid-edit (for example, signing out in another tab),
  the open form is replaced by the sign-in screen and anything not yet saved
  is lost.
- Once this release has written its own device data, recipes written later
  by the *old* app under `elk-kitchen-recipes` (only possible from an old tab
  left open) aren't offered for import automatically. They're still included
  in **Export** (`legacyBrowserRecipes`), and importing that file picks them up.
