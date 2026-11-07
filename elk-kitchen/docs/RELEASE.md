# Releasing ELK Kitchen

**Status (2026-11-07, M629):** Kitchen has **no approved release path yet**. Nothing here authorises a deploy.
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
4. **Supabase SQL Editor**, in order: `supabase/kitchen.sql` (v5), then `supabase/kitchen-photos.sql` (v2), then
   `supabase/kitchen-verify.sql`. Every row must be **PASS** (26 checks: member, stranger and signed-out, now including
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
