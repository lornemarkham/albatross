# 0004 — ELK Home · Kitchen lives in ELK Kitchen (PROPOSED, built)

**Status:** Proposed, built in M783. Lorne's M783 brief asked for this to be decided ("Determine whether ELK Home
should initially be a new interface inside Inventory or a separate frontend… Prefer the simplest maintainable
solution. Do not introduce another database."). This records the choice so it can be accepted or reversed.

## Decision
- **ELK Home starts as screens inside this app (`elk-kitchen`).** `/` is now the Kitchen Command Center; the recipe
  book moved to `/recipes`. Every other route is unchanged.
- **No new database, table or service.** Food, quantities, places, best-before and the shopping list are read from
  ELK Inventory's own tables with the signed-in person's token (`src/lib/pantry.ts`, `companion/shopping.ts`).
  The only writes to Inventory from the home screen are the ones Inventory's own app already makes: adding through
  `pantry_shopping_add` (skips duplicates) and ticking an item off (`done_at`, the same update as Inventory's
  `setShoppingDone`). Stock never changes from the home screen; cooking still asks before taking anything out.
- **Locations are a registry** (`src/lib/home/locations.ts`): Kitchen is built; Workshop, Household and Power are
  named and shown as "soon". A later location adds its screens and a nav set; if it outgrows this app, the shell
  (`HomeShell`) and registry move to their own frontend over the same services.
- **Ratings stay 0–10 in the database**; Kitchen asks and shows 1–5 stars (a star = 2 points, `src/lib/home/stars.ts`).
  No migration; every existing rating keeps its meaning.
- **Plan board is per device for now** (`localStorage`, labelled on screen). Sharing it needs a `kitchen.sql` table.
- **Offline:** a service worker keeps only this site's app files; a labelled, timed, read-only snapshot of recipes,
  pantry and list is kept in the browser. Nothing is queued while offline.

## Why not inside Inventory
Kitchen already holds the family recipes, ratings, cooking mode and the Inventory reads; Inventory would have needed
all of that rebuilt or imported. Building there would also cross a workspace boundary (Inventory is its own repo).

## Consequences
- Inventory's shopping-list and pantry schema are a contract Kitchen depends on (already tested against Inventory's
  SQL fixture in `tests/inventory-companion.test.ts` and `tests/kitchen-home.test.ts`).
- A shared wall tablet is signed in as one family member; ratings given there are that person's. Others rate from
  their own phone (the page offers the link). In this-device mode, people pick their name.
