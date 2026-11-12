**Status (2026-11-12, M783):** ELK Home · Kitchen Command Center is committed on `kitchen-shopping-list` on top of
`230ea74`. `/` is now the wall/tablet kitchen screen (Today, Pantry, Recipes, Shopping, quick actions, wall mode);
the recipe book is at `/recipes`; new `/shopping` (Inventory's shared list: add, tick off, Undo). Ratings are asked as
1–5 stars (stored 0–10, no SQL change). PWA manifest + service worker (app shell only). Tests: 233. **No SQL needed**;
this-device mode works as before. `vercel.json` changed only to keep `/sw.js`, the manifest and icons out of the SPA
rewrite. Check on an iPad after deploying: see the M783 handoff ("Exact steps for Lorne").

# Releasing ELK Kitchen

**Status (2026-11-08, M639):** Kitchen's chef (Inventory-aware conversation, dish ideas, AI chef with an evidence check,
family tastes, cook a suggested dish, detail scores, full-phone backup) is committed on `kitchen-shopping-list` on
top of `694e0d6`. It is **not pushed or deployed**: this mission had no release authority. Tests: 198. This-device mode
needs no SQL and works as before, plus the chef with Kitchen's own ideas. **Shared mode** now needs `kitchen.sql`
**v6** (additive: a `scores` column and its check; 28 verify checks). A v5 database still works: ratings save, and the
detail scores are flagged as "not shared yet". The AI chef needs the key and the variables in step 7 below (see
`docs/decisions/0002`). Check on a phone after deploying: `/tonight`, then ask the game-day question. You should get
three snack ideas built on yesterday's bratwurst, then **Cook this** → Finish → Save → rate.

**Status (2026-11-08, M635):** Finish Sausage Day is committed on `kitchen-shopping-list` on top of `d487b76`
(M634 shipped that one). Not pushed, not deployed: `~/forge/data/release-policy.json` still has no `kitchen` entry.
This-device mode, so no SQL is needed. Tests: 180. What it adds: `/sausage-day/:id/finish` (say which sausages were
made), the completed Sausage Day page, home cards "Sausage Day — Ready to Taste!", tasting cards `/taste/:planId/:recipeId`,
"What we learned" on a recipe, and "Make an improved version" (a new recipe, never an overwrite). Check on the phone after
deploying: home shows the live card with "record what I made" inside Sausage Day, tick Potato / Breakfast / Bratwurst, close,
rate one sausage with only the overall score, reload, rate again. **Shared mode:** overall ratings reach the family through
the existing dinner feedback; the seasoning / texture / juiciness scores need extra columns (or a table) in
`kitchen.sql` before they can be shared. Sausage Day, tasting cards and recipe versions are not in Backup & import yet:
use "Save a copy of this Sausage Day (file)" on the completed page.

**Earlier status (2026-11-07, M632):** Sausage Day live (`/sausage-day`, plus the home-page card) is committed on
`kitchen-shopping-list` on top of M631 and M629. None of the three is pushed or deployed. It works in this-device
mode, so no SQL is needed. Tests: 171. Check on a phone after deploying: the home page shows **SAUSAGE DAY — IN
PROGRESS** (only during 7–21 November 2026). Say or type "Chicken is done", then "2.1 kilograms", then "yes", and
the batches are divided. Reload: everything is still there.

**Earlier status (M631):** M631 (Sausage day, `/plan`) is committed on `kitchen-shopping-list` on top of M629. It is
not pushed or deployed. It works in this-device mode, so it can ship without any SQL. Same release steps as below.
Tests: 154.

**Earlier status (M629):** Kitchen has **no approved release path yet**. Nothing here authorises a deploy.
Production (deployed in M622 from `7aac18c`) is this-device mode. M629's family companion is committed locally on
`kitchen-shopping-list`, not pushed or deployed. The family-pilot runbook is at the end of this file.

## Where things stand

| | |
|---|---|
| Production | Vercel project `elk-kitchen` → https://elk-kitchen.vercel.app. On 2026-11-06 it served a build older than the weekend release (`15a3332`): no jerky/sausage, no batches, no Supabase settings (recipes are browser-only). |
| Source | `lornemarkham/albatross`, subdirectory `elk-kitchen`. GitHub has `kitchen-shopping-list` only up to `d60a5a7`. `15a3332` (M617) and the Start cooking work (M620) are local commits on that branch, not pushed. |
| How it was deployed before | By hand, `vercel --prod` from this directory. Agent sessions are not allowed to do that (denied in M617). |
| Forge release runner | `~/forge/data/release-policy.json` has no `kitchen` project, so the runner can't test, ship or verify Kitchen. That file is a safeguarded path: only a person can change it. |

## Proposed release path (needs Lorne)

Kitchen fits the runner's existing Vercel pattern (like Passport): the runner tests the exact commit, deploys
with `vercel deploy --prod`, smoke-tests, and rolls back on failure. Kitchen is owner-operated and
experimental, but it holds family data (browser-only data today), so the proposal is **MANUAL**: every tested
commit waits for SHIP.

A person adds this entry to `~/forge/data/release-policy.json` (shown here, not applied):

```json
{
  "key": "kitchen",
  "name": "ELK Kitchen",
  "products": ["elk-kitchen"],
  "mode": "manual",
  "workspaces": ["recipes"],
  "note": "Albatross monorepo, subdirectory elk-kitchen. Database SQL (supabase/*.sql) is run by a person in the Supabase SQL editor, never by the runner.",
  "source": { "repo": "~/lodge/albatross", "refs": ["refs/heads/ship/kitchen-*"] },
  "production": { "kind": "vercel", "branch": "main", "clone": "~/.local/share/elk-release/kitchen", "github": "lornemarkham/albatross", "subdir": "elk-kitchen", "vercelProject": "elk-kitchen", "url": "https://elk-kitchen.vercel.app", "deployVia": "cli" },
  "test": "npm ci --no-audit --no-fund && npm test && npm run typecheck && npm run build",
  "sensitive": ["supabase/", "src/lib/supabase.ts", "src/lib/familyAccess.ts", "src/context/KitchenContext.tsx", "vercel.json"],
  "smoke": [
    { "url": "https://elk-kitchen.vercel.app/", "status": [200], "contains": "ELK Kitchen" },
    { "url": "https://elk-kitchen.vercel.app/cook", "status": [200], "why": "SPA route rewrite still works" }
  ]
}
```

Open points for whoever wires it up (Forge workspace, not Kitchen): the runner's Vercel path assumes a repository
root, while Kitchen lives in a subdirectory (`subdir` above isn't a field the runner knows yet); and the commit
author must be `lorne.markham@gmail.com` (`identity` in the policy).

## Until then: what a release needs, in order

1. **Approval** from Lorne for this release.
2. Tests on the exact commit: `npm test && npm run typecheck && npm run build` (M620: 106 tests; M629: 144).
3. Deploy (`vercel --prod` from `elk-kitchen/`, or the runner once wired). The build is browser-only unless
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set in the Vercel project. Deploying without them is safe:
   recipes, cooking sessions and media stay on each phone, as today.
4. **Verify production**: open https://elk-kitchen.vercel.app on a phone. Check that the home page shows
   **Start cooking**, then do one short cook: say or type an amount, correct it, take a photo, finish, save.
   Reload and confirm the cook's journal is still there. Confirm an existing recipe on that phone is still there.
5. Rollback: `vercel rollback` to the deployment that was live before (record its URL first).

Shared mode (family recipes in Supabase, Pantry stock changes from Kitchen) is a separate, later step. See the
README, "Turning on shared recipes"; the order and the checks are there.

## Family pilot (M629): exact owner actions, in order

Nothing below has been done. Each step is yours. Steps 1–6 can happen before anyone shares anything. Stop at any
FAIL.

1. **Back up every phone that has Kitchen data.** On each phone: **Backup & import → Export**, and keep the files. Since
   M629, the file also carries dinner ratings and food notes typed on that phone.
2. **Re-probe the database** (an agent can do this read-only if you allow it; it was blocked in M629). Last verified
   2026-10-11: family list and Pantry present, **no `kitchen_*` tables**.
3. **Inventory first** (Inventory workspace, not Kitchen): the shopping list needs Inventory's `supabase-pantry.sql`
   from `pantry-family-kitchen` @ `8bf1753` (re-run; additive). Deploying that Inventory build is Inventory's release.
4. **Supabase SQL Editor**, in order: `supabase/kitchen.sql` (v6), then `supabase/kitchen-photos.sql` (v2), then
   `supabase/kitchen-verify.sql`. Every row must be **PASS** (28 checks, now including v6 detail scores: member, stranger and signed-out, now including
   dinner feedback and food notes). Then:
   `SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'kitchen_%';` — every policy names `elk_is_family_member`.
5. **Family list**: add the second family member's account to `elk_family_members` (Inventory's `docs/family-access.md`),
   with a `display_name`. That name is shown on their ratings.
6. **Supabase → Authentication → URL Configuration → Redirect URLs**: add `https://elk-kitchen.vercel.app/**`.
7. **Vercel project `elk-kitchen` → Environment Variables (Production)**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (publishable). *Optional, AI second opinion (proposed, `docs/decisions/0001`)*: `OPENAI_API_KEY` (server-only, no
   `VITE_`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Leave the AI ones out to keep AI off.
8. **Approve the release** of the M629 commit, then push `kitchen-shopping-list` and `vercel --prod` from `elk-kitchen/`
   (record the current production URL first for rollback: `vercel ls elk-kitchen`).
9. **Two-phone walkthrough** (this is the shared-mode acceptance; it has only been run against PGlite, never live):
   1. Phone A signs in → home shows **What should we cook?**. `/tonight` shows Pantry's real count and "Use soon".
   2. Ask "We need to use the leftover chicken" (or something Pantry really has). The reasons quote Pantry's real count and place.
   3. On a suggestion, **Shopping list…** → untick/edit → Add. Pantry's shopping list in Inventory shows it, and Pantry stock is unchanged.
   4. **Cook this** → say "add 200 grams of rice", "I used lime instead of vinegar", "start a 10 minute timer", take a photo → Finish.
   5. On review, confirm Pantry use for one item → Save. Inventory shows the movement.
   6. **How was dinner?** → rate, comment, photo, "Yes, again" → Save.
   7. Phone B (the other member) signs in → opens the same dinner → sees A's rating → adds their own.
   8. Phone A reloads: both ratings are there under the family-list names. `/tonight` "three dinner ideas the family will like" quotes both.
   9. A private window with a throwaway account: "not on the family list", and no data. Delete that account.
   10. **Backup & import → Export** on phone A. The file has `mealFeedback` with both ratings.
   11. *Microphone*: on each real phone, tap 🎤 on `/tonight` and in a cook. It must listen once and stop. This has never been tested on a real phone.
10. **Bring old phone data in**: on each phone, after sign-in, use **Review and import** (recipes, then their ratings
    come along under the typed names). Importing twice adds nothing.
11. Rollback if needed: `vercel rollback` / `vercel promote <previous url>`. The SQL is additive. Removing the
    Vercel env vars and redeploying returns Kitchen to this-device mode. Shared data stays in Supabase, untouched.

## M640 — Add Food (release candidate with M639, M649)

Built on `kitchen-shopping-list`, committed in M649. To release: owner approval, then push and `vercel --prod`. No SQL. Photo suggestions stay off until `OPENAI_API_KEY` and ADR 0003 are accepted. Moving food between places needs Inventory's `pantry_move` (the `pantry-family-kitchen` branch); without it Kitchen says so and changes nothing. Verify on a phone: add food by photo and by voice, say "I used the last of …", undo, and cook a soup from the bones.
