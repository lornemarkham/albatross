# ELK Kitchen — Product Doctrine

**Status:** Product authority. This is not a feature backlog.
**Established:** 2026-10-10
**Owner:** Lorne Markham

---

## 0. How to use this document

**Before you change how Kitchen behaves as a product, read this file.** That includes features, data model, AI behaviour and how Kitchen connects to Pantry or Inventory.

- **The code is evidence, not intent.** What exists today shows what was built. It doesn't automatically show what Kitchen is meant to be.
- **If the code and this doctrine disagree, name the conflict.** Add it to §14 (Known conflicts) or raise it with the owner. Don't quietly "fix" either side.
- **Don't silently rewrite working code** to match this doctrine. Changes that bring the code into line are deliberate, reviewed work.
- **Future vision is not permission to build it.** Sections that describe where Kitchen is going don't authorise anyone to implement them.
- **Record decisions here.** When a canonical product decision is made, add it to §15 (Decision log), plus an architecture decision record where one is relevant. Until then, the open questions in §12 stay open. Don't close them by inference.

Labels used below:

- **Doctrine** — settled product intent.
- **Proposed** — a candidate direction that hasn't been approved.
- **Future scope** — explicitly not to be built now.

---

## 1. What ELK Kitchen is (Doctrine)

ELK Kitchen is not primarily:

- a recipe database
- a cookbook
- a meal-planning spreadsheet
- a calorie counter
- a shopping-list application
- an AI chatbot

It may provide all of those capabilities.

**ELK Kitchen exists to help a household decide what to eat, cook something wonderful, eat well, and make intelligent use of the food it already owns.**

The goal is to take the friction out of everyday cooking, and to make food more enjoyable, nutritious and economical — and occasionally surprising.

---

## 2. The three connected systems (Doctrine)

Each system answers a different question:

| System | Question it answers |
|---|---|
| **ELK Inventory** | What do we own? |
| **ELK Pantry** | What food do we have, where is it, how much remains, and what needs attention? |
| **ELK Kitchen** | What should we cook, why is it a good choice, and how do we make it? |

These are separate product responsibilities built on shared household knowledge.

- Don't duplicate ingredient identity, nutrition data or ownership concepts unless there's a real need.
- Don't tightly couple the applications without a clear architectural contract.

**Note:** these are product responsibilities, not necessarily separate apps or repositories. Today, Pantry is a module inside the ELK Inventory application (see §13). Whether Kitchen and Pantry share one interface is an open question (§12).

---

## 3. Intelligence is the product (Doctrine)

Kitchen should be deeply AI-assisted. **AI is not a separate tab.** Intelligence should be built naturally into the whole cooking experience.

Kitchen should understand:

- available pantry ingredients
- quantities and freshness
- recipes the household already likes
- meals cooked before
- household preferences
- time available
- cooking equipment
- number of people
- weather and season
- nutrition
- dietary requirements
- food waste
- shopping needs
- goals the user gives it

The kinds of requests it should handle:

> "What should we make tonight?"
> "It's really hot outside. Something fresh and light."
> "It's freezing. I want something warm and comforting."
> "We need to use those tomatoes."
> "Something high in protein."
> "More vegetables tonight."
> "Something healthy that the kids will actually eat."
> "We have 25 minutes."
> "Make something from what we already have."

Kitchen should combine these signals intelligently. **It should not just produce generic AI recipes.** Its value comes from grounding every suggestion in this household's food, history and circumstances.

Guardrails that apply to every AI feature:

- AI output must stay distinguishable from information that a person entered or that has been verified (§5, §6).
- AI must not invent preferences, ratings or reactions, and must not present an inferred taste as a confirmed fact (§4).
- Anything AI produces that becomes a durable household record should go through human review first. ELK already has this pattern as the Draft Pipeline: Capture → Draft → Human Review → Approve → Record (see §13).

---

## 4. Ideas of the day (Proposed direction)

One important direction is **proactive meal inspiration that fits the moment**. Kitchen might offer:

**TONIGHT'S IDEAS**

- Use what's getting old
- Something healthy
- High protein
- Quick and easy
- A household favourite
- Something new
- Good for today's weather
- Cook entirely from the pantry

*These are illustrations of the idea, not approved UI.*

**Doctrine:** every suggestion should explain why it's relevant. For example:

> "You have everything for this."
> "Your spinach needs using."
> "You loved this last time."
> "High protein, with plenty of vegetables."
> "Perfect for a hot evening."

Kitchen should learn what the household enjoys.

**Doctrine:** don't invent preferences, and don't pretend inferred tastes are confirmed facts. "You loved this last time" is allowed only when someone actually recorded that reaction. An inference must be worded as an inference.

---

## 5. Recipes are structured knowledge (Doctrine for direction; structure not yet built)

In time, a recipe should understand:

- ingredients and quantities
- what each ingredient actually is (ingredient identity)
- servings
- preparation and cooking time
- instructions
- equipment
- nutrition
- substitutions
- dietary characteristics
- household modifications
- cooking history
- ratings and reactions
- source and provenance

**Doctrine:**

- Keep both the original recipe and the household's modifications.
- AI-generated substitutions and nutrition estimates must stay distinguishable from verified information. Wherever a value is stored or shown, it should be clear where it came from: entered by a person, from a source, estimated, or AI-generated.

---

## 6. Nutrition and health (Doctrine; health integration is Future scope)

Nutrition is a major product capability. In time, Kitchen should understand:

- calories
- protein
- carbohydrates
- fat
- fibre
- sodium
- relevant vitamins and minerals
- serving sizes
- nutrition per ingredient
- nutrition per recipe

**Doctrine:**

- Nutrition should come from trustworthy data where possible.
- AI can help match ingredients and fill in missing information, but **estimates must be labelled**.
- **"Healthy" depends on context. It is not a yes/no flag.** A high-protein meal, a vegetable-rich meal and a low-sodium meal can each serve different needs.

### Future health integration (Future scope — do not build)

Kitchen may eventually connect to a broader ELK Health capability, or to personal health information the household chooses to share. Examples include dietary goals, activity, nutritional targets, and medically relevant restrictions.

- Don't build medical integrations now.
- Don't infer diagnoses.
- Don't present Kitchen as a medical authority.
- Require appropriate consent and privacy protections.

---

## 7. Pantry-aware cooking (Doctrine for direction; integration not yet built)

Kitchen should understand what the household can actually make. For example:

- everything is available
- one ingredient is missing
- there isn't enough of something
- an ingredient needs using soon
- a substitute is available
- the recipe can be scaled
- missing ingredients can be added to shopping

Cooking should eventually feed back into Pantry.

**Doctrine:**

- **The household confirms what was actually used.**
- **Never take ingredients out of stock just because someone opened a recipe.** Viewing, choosing or starting a recipe is not consumption.
- Respect quantities, units, batches and uncertainty. Where a quantity or match is uncertain, ask the person instead of guessing.

---

## 8. The human loop (Proposed — a candidate, not a settled decision)

```
DISCOVER → CHOOSE → PREPARE → COOK → EAT → REMEMBER → LEARN
```

This is a proposed loop specific to Kitchen. It is recorded as a candidate only.

**Doctrine** (whether or not the loop is adopted), Kitchen should remember:

- what was cooked
- whether people enjoyed it
- changes that were made
- the ingredients actually used
- whether it was worth repeating
- practical lessons
- household favourites

**Doctrine:**

- **A recipe saved is not necessarily a recipe cooked.**
- **A recipe cooked is not necessarily a recipe loved.**
- Keep these distinctions in the data model and in everything Kitchen says.

---

## 9. Experience and personality (Doctrine)

Kitchen should feel **warm, capable, useful and enjoyable**. It should not feel clinical, corporate, or like a giant spreadsheet.

Someone opening Kitchen should feel:

> "Oh, that's a great idea for dinner."
> "We already have everything!"
> "That sounds freaking delicious."

Kitchen should make cooking easier, and now and then inspire people to try something new. **The interface should reduce work, not become another household chore.**

---

## 10. Near-term priorities (Proposed — not automatic approval)

1. Finish family recipe sharing.
2. Keep and import existing household recipes.
3. Improve how Pantry is organised.
4. Establish shared ingredient identity.
5. Introduce reliable nutrition knowledge.
6. Connect Kitchen recipes to Pantry quantities.
7. Build meal suggestions that fit the household's context.
8. Learn from cooking history and preferences.
9. Explore future Health integration.

This order is a proposal. Each item still needs its own approval before work begins. Listing an item here does not authorise building it.

---

## 11. Non-negotiables carried forward from the current implementation (Doctrine)

These safety properties already exist in shared recipes (`supabase/kitchen.sql`, `README.md`). They are consistent with this doctrine and should be kept unless a recorded decision changes them:

- **Only the family can see anything.** Access uses the ELK family list (`elk_is_family_member()`). Being signed in is not enough. The database enforces this, not only the app.
- **Nothing is lost.**
  - Recipes can't be deleted through the app or the API.
  - Every edit keeps the previous version (`kitchen_recipe_revisions`).
  - Imports never overwrite existing data.
  - Imported legacy records are kept word for word.
- **Edits don't silently clobber each other.** Each edit names the version it started from, and conflicts are shown to the person.
- **Cooking history is its own record, separate from the recipe**, and entries are only ever added. Only the person who recorded an entry can remove it, and they have to confirm.
- **Favourites belong to each person**, not to the household.

---

## 12. Open questions (unresolved — do not close by inference)

| # | Question | What exists today (evidence only) |
|---|---|---|
| Q1 | **Who owns the shared ingredient catalog?** | Inventory treats each `inventory_items` row as the product. Pantry matches products by name only, ignoring case and spaces. There's no catalog, barcode or GTIN. Kitchen's ingredients are free text. |
| Q2 | **Where does nutrition data come from?** | None is chosen. Inventory seed items carry an informal `attributes.estimatedTotalCalories`. Kitchen has a single `approx_calories` number. |
| Q3 | **Is nutrition tracked per specific product or per generic ingredient?** | Undecided. |
| Q4 | **Are preferences held per household or per person?** | Favourites are per person. Ratings and reactions are recorded on each cooking entry. There is no preference model. |
| Q5 | **How are AI-generated recipes verified?** | Inventory has a Draft → Review → Approve pipeline for AI intake. Kitchen has no AI path in production. |
| Q6 | **How do substitutions change nutrition?** | Undecided. Substitutions are free text on cooking entries. |
| Q7 | **How are pantry deductions confirmed?** | Kitchen's README plans to call Inventory's `pantry_*` functions, referencing a cooking-entry id. There's no confirmation design yet. |
| Q8 | **Planned meals or spontaneous suggestions?** | Undecided. Inventory's vision text mentions "meal planning" under Kitchen. |
| Q9 | **Who owns the shopping list?** | It isn't built and has no owner. Pantry has a "Running low" list driven by `lowStockAt`. |
| Q10 | **Where are the boundaries on recipe import and copyright?** | Undecided. Imports today are the household's own recipes only. |
| Q11 | **How do future Health integration and privacy work?** | Future scope. Undecided. |
| Q12 | **Do Kitchen and Pantry share one interface?** | Today they're separate apps (Kitchen; Pantry at `/pantry` in ELK Inventory) that share one Supabase project and one family list. |

---

## 13. Existing architecture — findings (as of 2026-10-10)

This section records evidence. It is not intent.

### ELK Kitchen

**Where it lives**

- `albatross/elk-kitchen` (a subdirectory of the `albatross` monorepo).
- React + Vite + TypeScript, deployed on Vercel, Supabase optional.

**Data model** (`src/types/recipe.ts`, `supabase/kitchen.sql`)

- `kitchen_recipes`: title, author name, `ingredients` (free text), `instructions`, `notes`, `tags`, `suggested_tags`, `approx_calories` (an integer with no provenance), `legacy` (JSONB, verbatim), and `version`.
- `kitchen_cooking_entries`: cooked on, cook, ingredients used, substitutions, family reaction, improve next time, notes, and rating (0–10, optional).
- `kitchen_favourites`: per person.
- `kitchen_recipe_revisions`: written only by a trigger.

**Storage modes**

- Browser-only when Supabase isn't configured.
- Shared once the family list and `kitchen.sql` are in place.

**Suggested tags** (`src/lib/suggestedTags.ts`)

- A keyword heuristic. The code calls it "placeholder 'AI'", but no AI is involved.
- Stored apart from tags the person chose, and shown in a separate, muted "Suggested tags" section.

**Scribe module** (`src/lib/scribe/*`, plus middleware in `vite.config.ts`)

- Calls OpenAI `gpt-4o-mini` to turn messy text into a recipe. It also has a "mechanic" mode that isn't for Kitchen.
- Nothing in the UI calls it.
- It's served only by the Vite **dev server**, so it has no production endpoint.

**Boundary with Inventory** (stated in the README)

- Kitchen never reads or writes Inventory's tables.
- Inventory owns physical stock.
- "I cooked this" is planned to go through Inventory's `pantry_*` functions.

### ELK Pantry (inside ELK Inventory, a separate repository: `lodge/elk-inventory`)

**What it is**

- A module, not an app: the `/pantry` route, plus `pantryModel.ts`, `pantryDb.ts` and `supabase-pantry.sql`.
- A pantry item is an `inventory_items` row with `domain = 'food-storage'`.

**Stock model**

- `stock_lots` (batches), each with location, `best_before`, `purchased_on` and source.
- `stock_movements`, append-only, with kinds `received`, `used`, `undo` and `count-correction`.
- Writes happen only through SECURITY DEFINER functions:
  - `pantry_receive`
  - `pantry_use`, which takes stock oldest-first by **purchase date**, not by expiry, and refuses if stock is short
  - `pantry_undo`
  - `pantry_set_low_stock`

**Units and expiry**

- Quantities are **whole numbers only**. The unit is a free-text label, and there's no conversion between weights or volumes.
- `best_before` is used only for warnings.

**Shared with Kitchen**

- Both use the same Supabase project and the same family list.

**AI intake** (`api/extract.ts`)

- An OpenAI Structured Outputs endpoint, family-only and server-side. Results go into drafts that a person must approve.

### Ecosystem decisions already on record (`lodge/elk-engineering-os/architecture/engineering-decisions.md`)

- **Draft Pipeline Pattern:** "Nothing should enter the real inventory without explicit human approval."
- **Supabase Direct** (no custom backend) for ELK Inventory.

### Other relevant docs

- `elk-inventory/docs/vision/life-operating-system.md`: "ELK Inventory is the asset backbone. Other apps are domain-specific lenses on the same data."
- `elk-inventory/docs/concepts/life-inventory.md`: "ELK Kitchen will consume pantry inventory for meal planning and recipe suggestions."

---

## 14. Known conflicts between implementation, existing docs and this doctrine

Each item here is named, not resolved. None of them authorises a code change on its own.

**C1. Where Pantry sits.**

- This doctrine treats Pantry as its own product responsibility.
- In code, Pantry is a module of ELK Inventory.
- Inventory's vision table assigns "Pantry, food — ingredient stock, expiry, meal planning" to the ELK Kitchen *lens*.
- Kitchen's README says Inventory owns all physical stock.
- *These three framings need reconciling* (relates to Q1, Q12). The README boundary — Kitchen owns recipes and cooking knowledge; stock lives with Inventory/Pantry — is compatible with this doctrine and stays in force for now.

**C2. Calories have no provenance.**

- `approx_calories` is one unlabelled number. It may have been typed in, imported from the legacy app, or (through Scribe) estimated by keyword heuristics or AI.
- §5 and §6 require estimates to be distinguishable.
- Today's UI says "Approx", which partly signals this.

**C3. Scribe invents data.**

- The dormant Scribe prompt and its fallback set `rating` to 8 by default, and estimate calories from keywords ("chicken → higher").
- That conflicts with §4: don't invent preferences or reactions.
- When AI is unavailable, the heuristic fallback runs silently, and its output can't be told apart from AI output.
- Scribe's output shape also mixes the recipe with a single cooking occasion. That is the legacy shape that shared recipes deliberately split apart.
- *Scribe should not be wired into the product as-is.*

**C4. "AI" labelling of suggested tags.**

- The code describes suggested tags as placeholder AI, but they come from keyword rules.
- Keeping them separate from tags people chose is consistent with doctrine.
- The wording should never suggest to users that intelligence is involved when it isn't.

**C5. No ingredient identity or units.**

- Kitchen's ingredients are free text.
- Pantry quantities are whole numbers with a free-text unit and no conversion.
- Pantry products are matched by name.
- The recipe-to-pantry matching in §7 (insufficient quantity, scaling, substitutes) can't be delivered reliably until Q1 is decided and units are addressed.

**C6. Expiry versus use order.**

- §3 and §4 call for "use what's getting old".
- Pantry takes stock oldest-first by purchase date, not by best-before date, and only *warns* when a newer batch expires sooner.
- This isn't a bug, but suggestions should rely on `best_before` rather than on the order Pantry consumes stock.

**C7. AI hosting versus "Supabase direct".**

- AI built into Kitchen needs a server-side endpoint, because model keys must never reach the browser.
- Inventory already has one (`api/extract.ts`) with a family-only check, which is a precedent.
- Kitchen currently has no production endpoint. The "Supabase Direct" decision was scoped to Inventory.

**C8. Stale docs elsewhere** (outside this repository; noted only):

- `elk-inventory/docs/README.md` says Pantry is "Not yet started".
- `elk-engineering-os/working-context.md` describes access as "authenticated users see all rows", which predates the family-only access model.

---

## 15. Decision log

Add canonical product decisions here: the date, the decision, the reason, and a link to an ADR if one exists. Moving an item out of §12 requires an entry here.

| Date | Decision | Notes |
|---|---|---|
| 2026-10-10 | This doctrine is adopted as Kitchen's product authority. | Priorities (§10) and the human loop (§8) are recorded as proposals, not decisions. |
