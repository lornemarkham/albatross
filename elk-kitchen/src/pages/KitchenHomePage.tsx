import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { usePantry } from "../lib/usePantry";
import { supabase } from "../lib/supabase";
import { addToShoppingList, type PantryItem } from "../lib/pantry";
import { loadShoppingList, onListAlready, setShoppingDone, type ShoppingItem } from "../lib/companion/shopping";
import { cookingHistory } from "../lib/cooking/history";
import { useWakeLock } from "../lib/cooking/device";
import { useDrafts } from "../lib/cooking/useCookingSession";
import { ensureHouseholdRecipes } from "../lib/household/staples";
import { localToday } from "../prototype/ideas/context";
import { kitchenToday, type DinnerIdea } from "../lib/home/kitchenToday";
import { MealPlanStore, type PlannedMeal } from "../lib/home/mealPlan";
import { readSnapshot, saveSnapshot, type KitchenSnapshot } from "../lib/home/snapshot";
import { stockLabel, whenLabel } from "../lib/companion/pantryView";
import { useOnline } from "../components/HomeShell";
import { ChipList, Muted, OfflineBoard, Panel, Sub } from "../components/KitchenPanels";
import { ContinueCooking, useStartCooking } from "./StartCookingPage";
import { INVENTORY_PANTRY_URL } from "./PantryPage";
import { SausageDayHome } from "../components/SausageDayHome";
import { ModeNotice } from "../components/ModeNotice";
import type { RecipeSummary } from "../types/recipe";

// ELK Home · Kitchen: the screen on the kitchen wall. Read from across the
// room, used with one finger. Everything on it is the family's own: recipes
// and ratings (Kitchen), food and the shopping list (ELK Inventory's Pantry).
// Nothing changes stock from here; adding to the shopping list and ticking it
// off are the only writes, both through Inventory's own list.

const WALL_KEY = "elk-kitchen-wall-mode";
const REFRESH_MS = 60_000;

const QUICK: { to: string; icon: string; label: string; tone: string }[] = [
  { to: "/tonight", icon: "🍲", label: "What can we cook?", tone: "bg-sage text-white" },
  { to: "/food", icon: "🛍️", label: "Add groceries", tone: "bg-leaf text-white" },
  { to: "/food?say=Leftover%20", icon: "🥡", label: "Add leftovers", tone: "bg-saffron text-cocoa" },
  { to: "/cook", icon: "🎤", label: "Start cooking", tone: "bg-tomato text-white" },
  { to: "/shopping", icon: "🛒", label: "Shopping list", tone: "bg-cocoa text-butter" },
];

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Ticks every minute (and when the screen comes back, or the internet does), so a wall screen stays current.
function useRefresh(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => { if (!document.hidden) setN((x) => x + 1); };
    const t = window.setInterval(bump, REFRESH_MS);
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("online", bump);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", bump); window.removeEventListener("online", bump); };
  }, []);
  return n;
}

export function KitchenHomePage() {
  const { store, member } = useKitchen();
  const online = useOnline();
  const tick = useRefresh();
  const [wall, setWall] = useState(() => window.localStorage.getItem(WALL_KEY) === "on");
  useEffect(() => { window.localStorage.setItem(WALL_KEY, wall ? "on" : "off"); }, [wall]);
  useWakeLock(wall);

  const recipes = useLoad(async () => { await ensureHouseholdRecipes(store).catch(() => 0); return store.listRecipes(); }, [store, tick]);
  const feedback = useLoad(() => store.listFeedback(), [store, tick]);
  const profiles = useLoad(() => store.listProfiles(), [store]);
  const history = useLoad(() => cookingHistory(store, 8), [store, tick]);
  const { pantry } = usePantry(tick);
  const shopping = useLoad(async () => (member && supabase ? loadShoppingList(supabase) : null), [member, tick]);
  const plans = useMemo(() => new MealPlanStore(window.localStorage), []);
  const [planned, setPlanned] = useState<PlannedMeal[]>([]);
  const today = localToday();
  useEffect(() => { setPlanned(plans.upcoming(today)); }, [plans, today]);

  const pantryItems: PantryItem[] | null = pantry && pantry !== "off" && pantry.status === "ready" ? pantry.items : null;
  const shopItems: ShoppingItem[] | null = shopping.data?.status === "ready" ? shopping.data.items : null;

  // Keep a read-only copy for when the internet drops; read it back only when the live load fails.
  useEffect(() => {
    if (recipes.data) saveSnapshot(window.localStorage, { at: new Date().toISOString(), recipes: recipes.data, pantry: pantryItems, shopping: shopItems?.map((s) => s.name) ?? null });
  }, [recipes.data, pantryItems, shopItems]);
  const snapshot = useMemo<KitchenSnapshot | null>(() => (recipes.error || !online ? readSnapshot(window.localStorage) : null), [recipes.error, online]);

  const view = useMemo(() => recipes.data ? kitchenToday({
    recipes: recipes.data,
    feedback: feedback.data?.status === "ready" ? feedback.data.items : [],
    profiles: profiles.data?.status === "ready" ? profiles.data.items : [],
    history: history.data ?? [],
    pantry: pantryItems,
    planned,
    today,
  }) : null, [recipes.data, feedback.data, profiles.data, history.data, pantryItems, planned, today]);

  const drafts = useDrafts();
  const unsaved = drafts.unsaved();
  const now = new Date();

  function plan(r: RecipeSummary, date = today) {
    plans.add(date, r.title, r.id);
    setPlanned(plans.upcoming(today));
  }
  function unplan(id: string) {
    plans.remove(id);
    setPlanned(plans.upcoming(today));
  }

  return (
    <div className={`mx-auto max-w-[1400px] px-4 py-5 sm:px-6 ${wall ? "text-lg" : ""}`}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-sage">ELK Home · Kitchen</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-bark sm:text-5xl">{greeting(now)}</h1>
          <p className="mt-1 text-lg text-bark/70">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={wall} onClick={() => setWall((w) => !w)}
            className={`min-h-14 rounded-2xl border px-5 text-base font-semibold ${wall ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>
            {wall ? "🖼 Wall mode on · screen stays awake" : "🖼 Wall mode"}
          </button>
          <Link to="/data" className="min-h-14 rounded-2xl border border-clay bg-cream px-5 py-4 text-base text-bark">Backup</Link>
        </div>
      </header>

      <nav aria-label="Quick actions" className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {QUICK.map((q) => (
          <Link key={q.label} to={q.to} className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center text-sm font-bold leading-tight shadow-md transition active:scale-[0.98] sm:min-h-24 sm:rounded-3xl sm:text-xl ${q.tone}`}>
            <span aria-hidden className="text-2xl leading-none sm:text-4xl">{q.icon}</span>{q.label}
          </Link>
        ))}
      </nav>

      <ModeNotice />
      {unsaved.length > 0 && <div className="mb-5"><ContinueCooking sessions={unsaved} /></div>}
      {recipes.error && !snapshot ? (
        <ErrorCard text={`Couldn't load the family's recipes: ${recipes.error}`} />
      ) : snapshot && (!online || recipes.error) ? (
        <OfflineBoard snap={snapshot} />
      ) : !view ? (
        <p className="py-16 text-center text-2xl text-bark/60">Loading the kitchen…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* ── TODAY ── */}
          <div className="space-y-5">
            <Panel title="Tonight" more={{ to: "/tonight", label: "More ideas" }}>
              {view.dinner.length === 0 ? (
                <p className="text-bark/70">No dinner recipes in the book yet. <Link to="/add" className="font-semibold text-sage underline">Add one</Link>.</p>
              ) : (
                <>
                  <DinnerCard idea={view.dinner[0]} lead onPlan={() => plan(view.dinner[0].suggestion.recipe)}
                    planned={planned.some((p) => p.date === today && p.recipeId === view.dinner[0].suggestion.recipe.id)} openList={shopItems?.map((s) => s.name) ?? null} />
                  {view.dinner.slice(1).map((d) => (
                    <DinnerCard key={d.suggestion.recipe.id} idea={d} onPlan={() => plan(d.suggestion.recipe)}
                      planned={planned.some((p) => p.date === today && p.recipeId === d.suggestion.recipe.id)} openList={shopItems?.map((s) => s.name) ?? null} />
                  ))}
                </>
              )}
            </Panel>

            <Panel title="Meals planned">
              {view.planned.length === 0 ? (
                <p className="text-bark/70">Nothing planned. Tap <strong>Plan for tonight</strong> on an idea.</p>
              ) : (
                <ul className="divide-y divide-clay/60">
                  {view.planned.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold uppercase tracking-wide text-sage">{m.date === today ? "Tonight" : new Date(`${m.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}</p>
                        {m.recipeId ? <Link to={`/recipe/${encodeURIComponent(m.recipeId)}`} className="block truncate text-xl font-semibold text-bark">{m.title}</Link> : <p className="truncate text-xl font-semibold text-bark">{m.title}</p>}
                      </div>
                      <button type="button" onClick={() => unplan(m.id)} className="min-h-12 shrink-0 rounded-xl border border-clay px-4 text-base text-bark/70">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-bark/50">The plan is kept on this screen; other phones don't see it yet.</p>
            </Panel>

            <Panel title="Needs attention">
              {!view.pantryConnected ? <PantryOff /> : view.soon.length === 0 && view.leftovers.length === 0 ? (
                <p className="text-bark/70">Pantry shows nothing near its best-before date, and no leftovers.</p>
              ) : (
                <ul className="space-y-2">
                  {view.soon.slice(0, 6).map((s) => (
                    <li key={`soon-${s.item.name}`} className={`rounded-2xl px-4 py-3 ${s.daysLeft <= 1 ? "bg-tomato/15" : "bg-saffron/15"}`}>
                      <p className="text-xl font-semibold text-bark">{s.item.name}</p>
                      <p className="text-base text-bark/75">{whenLabel(s.daysLeft)} · {stockLabel(s.item)}</p>
                    </li>
                  ))}
                  {view.leftovers.filter((l) => !view.soon.some((s) => s.item.name === l.name)).slice(0, 4).map((l) => (
                    <li key={`left-${l.name}`} className="rounded-2xl bg-butter px-4 py-3">
                      <p className="text-xl font-semibold text-bark">🥡 {l.name}</p>
                      <p className="text-base text-bark/75">Leftovers · {stockLabel(l)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* ── PANTRY ── */}
          <div className="space-y-5">
            <Panel title="Pantry" more={{ to: "/pantry", label: "Everything" }}>
              {!view.pantryConnected ? <PantryOff /> : (
                <>
                  <p className="text-lg text-bark"><strong className="text-3xl">{view.available.length}</strong> foods in stock</p>
                  <Sub title="Running low">
                    {view.low.length === 0 ? <Muted>Nothing below its low-stock level.</Muted> : (
                      <ChipList items={view.low.slice(0, 8).map((p) => ({ key: p.name, text: `${p.name} · ${p.onHand} ${p.unit}`, warn: p.onHand === 0 }))} />
                    )}
                  </Sub>
                  <Sub title="Expiring soon">
                    {view.soon.length === 0 ? <Muted>Nothing in the next 4 days.</Muted> : (
                      <ChipList items={view.soon.slice(0, 8).map((s) => ({ key: s.item.name, text: `${s.item.name} · ${whenLabel(s.daysLeft).replace("best before ", "")}`, warn: s.daysLeft <= 1 }))} />
                    )}
                  </Sub>
                  <Sub title="Recently added">
                    {view.recentlyAdded.length === 0 ? <Muted>Nothing new this week.</Muted> : (
                      <ChipList items={view.recentlyAdded.slice(0, 8).map((p) => ({ key: p.name, text: p.name }))} />
                    )}
                  </Sub>
                  <Sub title="In stock">
                    <ChipList items={view.available.slice(0, 18).map((p) => ({ key: p.name, text: p.name }))} />
                    {view.available.length > 18 && <Link to="/pantry" className="mt-2 inline-block text-base font-semibold text-sage underline">+ {view.available.length - 18} more</Link>}
                  </Sub>
                  <p className="mt-3 text-xs text-bark/50">From ELK Inventory. Counts are packages, not amounts. <a href={INVENTORY_PANTRY_URL} className="underline">Change stock in Inventory</a>.</p>
                </>
              )}
            </Panel>
          </div>

          {/* ── RECIPES + SHOPPING ── */}
          <div className="space-y-5">
            <Panel title="Recipes" more={{ to: "/recipes", label: "All recipes" }}>
              <RecipeSearch />
              <Sub title="Family favourites">
                {view.favourites.length === 0 ? <Muted>Rate dinners after you cook and favourites appear here.</Muted> : (
                  <ul className="space-y-1">
                    {view.favourites.slice(0, 5).map((f) => (
                      <li key={f.recipe.id}>
                        <Link to={`/recipe/${encodeURIComponent(f.recipe.id)}`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl px-2 hover:bg-clay/30">
                          <span className="truncate text-lg font-semibold text-bark">{f.recipe.title}</span>
                          <span className="shrink-0 text-base text-saffron">{f.stars != null ? `★ ${f.stars}` : f.recipe.favourite ? "♥" : ""}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Sub>
              <Sub title="Recently cooked">
                {view.recentlyCooked.length === 0 ? <Muted>Nothing cooked yet.</Muted> : (
                  <ul className="space-y-1">
                    {view.recentlyCooked.map((h) => (
                      <li key={h.entry.id}>
                        <Link to={`/recipe/${encodeURIComponent(h.recipe.id)}/batch/${encodeURIComponent(h.entry.id)}`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl px-2 hover:bg-clay/30">
                          <span className="truncate text-lg text-bark">{h.recipe.title}</span>
                          <span className="shrink-0 text-sm text-bark/60">{h.entry.cookedOn || "—"} · Rate</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Sub>
            </Panel>

            <Panel title="Shopping" more={{ to: "/shopping", label: "Whole list" }}>
              <ShoppingBox items={shopItems} state={shopping.data} reload={shopping.reload} limit={8} />
            </Panel>
          </div>
        </div>
      )}
      {/* Sausage Day (its week only) sits under the board, so today's kitchen stays above the fold. */}
      <div className="mt-5"><SausageDayHome /></div>
    </div>
  );
}

function DinnerCard({ idea, lead = false, onPlan, planned, openList }: { idea: DinnerIdea; lead?: boolean; onPlan: () => void; planned: boolean; openList: string[] | null }) {
  const { suggestion: s, why } = idea;
  const start = useStartCooking();
  const missing = s.missing.map((m) => (m.status.state === "missing" ? m.status.item.name : m.name));
  const toBuy = openList ? missing.filter((n) => !onListAlready(n, openList)) : missing;
  const [shop, setShop] = useState<string | null>(null);
  async function addMissing() {
    if (!supabase || toBuy.length === 0) return;
    setShop("Adding…");
    const r = await addToShoppingList(supabase, toBuy, s.recipe.title);
    setShop(r.ok ? (r.added ? `Added ${r.added} to the list` : "Already on the list") : r.error);
  }
  return (
    <div className={lead ? "rounded-3xl bg-cocoa p-5 text-butter shadow-md" : "mt-3 rounded-2xl border border-clay bg-white/70 p-4"}>
      {lead && <p className="text-sm font-bold uppercase tracking-widest text-saffron">Suggested dinner</p>}
      <Link to={`/recipe/${encodeURIComponent(s.recipe.id)}`} className={`block font-display font-semibold leading-tight ${lead ? "mt-1 text-3xl" : "text-2xl text-bark"}`}>{s.recipe.title}</Link>
      {why.length > 0 && (
        <ul className={`mt-2 space-y-0.5 ${lead ? "text-lg text-butter/90" : "text-base text-bark/80"}`}>
          {why.map((w) => <li key={w}>· {w}</li>)}
        </ul>
      )}
      {s.unknown.length > 0 && <p className={`mt-1 text-sm ${lead ? "text-butter/60" : "text-bark/55"}`}>Pantry doesn't know about {s.unknown.length} ingredient{s.unknown.length === 1 ? "" : "s"} — check the cupboard.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {lead && (
          <button type="button" onClick={() => start(s.recipe)} className="min-h-14 rounded-2xl bg-tomato px-5 text-lg font-bold text-white">🎤 Start cooking</button>
        )}
        <button type="button" onClick={onPlan} disabled={planned}
          className={`min-h-14 rounded-2xl px-5 text-lg font-semibold disabled:opacity-60 ${lead ? "border border-butter/40" : "border border-clay text-bark"}`}>
          {planned ? "✓ Planned for tonight" : "Plan for tonight"}
        </button>
        {missing.length > 0 && supabase && (
          <button type="button" onClick={addMissing} disabled={toBuy.length === 0 || !!shop}
            className={`min-h-14 rounded-2xl px-5 text-lg font-semibold disabled:opacity-60 ${lead ? "bg-butter text-cocoa" : "bg-sage text-white"}`}>
            {shop ?? (toBuy.length === 0 ? "Missing items are on the list" : `🛒 Add ${toBuy.length} missing`)}
          </button>
        )}
      </div>
      {missing.length > 0 && <p className={`mt-2 text-sm ${lead ? "text-butter/70" : "text-bark/60"}`}>Pantry shows none left of: {missing.join(", ")}</p>}
    </div>
  );
}

export function ShoppingBox({ items, state, reload, limit = Infinity }: {
  items: ShoppingItem[] | null; state: Awaited<ReturnType<typeof loadShoppingList>> | null | undefined; reload: () => void; limit?: number;
}) {
  const { member } = useKitchen();
  const online = useOnline();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [undo, setUndo] = useState<ShoppingItem | null>(null);
  const [busy, setBusy] = useState(false);

  if (!member || !supabase) return <p className="text-bark/70">The family shopping list is for people signed in and on the family list.</p>;
  if (state === undefined) return <Muted>Loading the list…</Muted>;
  if (state?.status === "not-set-up") return <p className="text-bark/70">The shopping list isn't switched on in ELK Pantry yet.</p>;
  if (state?.status === "error") return <ErrorCard text={`Couldn't load the shopping list: ${state.error}`} />;

  async function add() {
    const names = text.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    if (!names.length || !supabase) return;
    setBusy(true); setMsg(null);
    const r = await addToShoppingList(supabase, names, "", "added in Kitchen");
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setText("");
    setMsg(r.added === names.length ? `Added ${r.added}.` : r.added === 0 ? "Already on the list." : `Added ${r.added}; the rest were on the list already.`);
    reload();
  }
  async function done(item: ShoppingItem, on: boolean) {
    if (!supabase) return;
    setBusy(true); setMsg(null);
    const r = await setShoppingDone(supabase, item.id, on);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setUndo(on ? item : null);
    reload();
  }

  const list = items ?? [];
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add to the list (milk, eggs…)" aria-label="Add to the shopping list"
          className="min-h-14 min-w-0 flex-1 rounded-2xl border border-clay bg-white px-4 text-lg text-bark" disabled={!online} />
        <button type="submit" disabled={busy || !text.trim() || !online} className="min-h-14 shrink-0 rounded-2xl bg-sage px-5 text-lg font-bold text-white disabled:opacity-50">Add</button>
      </form>
      {msg && <p className="mt-2 text-base text-sage">{msg}</p>}
      {undo && (
        <p className="mt-2 flex items-center gap-3 text-base text-bark">Ticked off {undo.name}.
          <button type="button" className="min-h-11 rounded-xl border border-clay px-3 font-semibold" onClick={() => done(undo, false)}>Undo</button>
        </p>
      )}
      {list.length === 0 ? <p className="mt-3 text-bark/70">The list is empty.</p> : (
        <ul className="mt-3 divide-y divide-clay/60">
          {list.slice(0, limit).map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xl text-bark">{i.name}</p>
                {i.note && <p className="truncate text-sm text-bark/55">{i.note}</p>}
              </div>
              <button type="button" disabled={busy || !online} onClick={() => done(i, true)} aria-label={`Got ${i.name}`}
                className="min-h-12 shrink-0 rounded-xl border border-sage px-4 text-base font-semibold text-sage disabled:opacity-50">✓ Got it</button>
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && <Link to="/shopping" className="mt-2 inline-block text-base font-semibold text-sage underline">+ {list.length - limit} more on the list</Link>}
      <p className="mt-3 text-xs text-bark/50">The family's one list, in ELK Inventory — every phone sees the same items. "Got it" doesn't change stock; put food away in Inventory.</p>
    </div>
  );
}

function RecipeSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); navigate(`/recipes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); }} className="flex gap-2">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes"
        className="min-h-14 min-w-0 flex-1 rounded-2xl border border-clay bg-white px-4 text-lg text-bark" />
      <button type="submit" className="min-h-14 shrink-0 rounded-2xl border border-clay bg-cream px-5 text-lg font-semibold text-bark">Search</button>
    </form>
  );
}

const ErrorCard = ({ text }: { text: string }) => <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-lg text-red-800">{text}</p>;
const PantryOff = () => <p className="text-bark/70">ELK Pantry shows here once you're signed in with a family account.</p>;
