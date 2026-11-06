# Releasing ELK Kitchen

**Status (2026-11-06, M620):** Kitchen has **no approved release path yet**. Nothing here authorises a deploy.

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
2. Tests on the exact commit: `npm test && npm run typecheck && npm run build` (M620: 106 tests).
3. Deploy (`vercel --prod` from `elk-kitchen/`, or the runner once wired). The build is browser-only unless
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set in the Vercel project. Deploying without them is safe:
   recipes, cooking sessions and media stay on each phone, as today.
4. **Verify production**: open https://elk-kitchen.vercel.app on a phone. Check that the home page shows
   **Start cooking**, then do one short cook: say or type an amount, correct it, take a photo, finish, save.
   Reload and confirm the cook's journal is still there. Confirm an existing recipe on that phone is still there.
5. Rollback: `vercel rollback` to the deployment that was live before (record its URL first).

Shared mode (family recipes in Supabase, Pantry stock changes from Kitchen) is a separate, later step. See the
README, "Turning on shared recipes"; the order and the checks are there.
