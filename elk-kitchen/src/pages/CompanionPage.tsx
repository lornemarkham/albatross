import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { usePantry } from "../lib/usePantry";
import { supabase } from "../lib/supabase";
import { addToShoppingList, type PantryItem } from "../lib/pantry";
import { parseAsk, heard } from "../lib/companion/ask";
import { recommend, type Answer, type Reason, type Suggestion } from "../lib/companion/recommend";
import { stockLabel, useSoon, leftovers, whenLabel, isLow } from "../lib/companion/pantryView";
import { loadOpenShopping, parseShopping, reviewLines, type ShoppingLine } from "../lib/companion/shopping";
import { tasteByRecipe } from "../lib/familyMemory";
import { useListening } from "../lib/cooking/device";
import { localToday } from "../prototype/ideas/context";
import { INVENTORY_PANTRY_URL } from "./PantryPage";
import { useStartCooking } from "./StartCookingPage";
import { inputClass, primaryButton, secondaryButton, sectionLabel } from "../components/ui";
import type { MemberProfile } from "../types/feedback";
import { aiRequestFrom, askAi, type AiResult } from "../lib/companion/ai";

export const EXAMPLES = [
  "What should we cook tonight?",
  "What can I make with what we have?",
  "We need to use the leftover chicken",
  "What's going bad soon?",
  "Give me three dinner ideas the family will like",
  "Add cream to the shopping list",
];

// The family cooking companion: what ELK Pantry shows, what the family has
// said about its dinners, and a question box. Rules, not AI — every reason
// says where it came from, and nothing is stored until someone says so.
export function CompanionPage() {
  const { store, member } = useKitchen();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  useEffect(() => { setText(q); }, [q]);
  const { pantry } = usePantry();
  const recipes = useLoad(() => store.listRecipes(), [store]);
  const feedback = useLoad(() => store.listFeedback(), [store]);
  const profiles = useLoad(() => store.listProfiles(), [store]);
  const openList = useLoad(async () => (member && supabase ? loadOpenShopping(supabase) : null), [member]);

  const pantryItems: PantryItem[] | null = pantry && pantry !== "off" && pantry.status === "ready" ? pantry.items : null;
  const today = localToday();
  const taste = useMemo(() => tasteByRecipe(feedback.data?.status === "ready" ? feedback.data.items : []), [feedback.data]);
  const people: MemberProfile[] = profiles.data?.status === "ready" ? profiles.data.items : [];

  const ask = (s: string) => setParams(s.trim() ? { q: s.trim() } : {});
  const shopping = q ? parseShopping(q) : null;
  const answer: Answer | null = useMemo(() => {
    if (!q || shopping || !recipes.data) return null;
    return recommend(parseAsk(q), { recipes: recipes.data, pantry: pantryItems, taste, profiles: people, today });
  }, [q, recipes.data, pantryItems, taste, people, today, shopping]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">What should we cook?</h1>
      <AskBox text={text} setText={setText} onAsk={ask} />

      {!q && <WhatWeHave pantry={pantry} items={pantryItems} recipeTitles={(recipes.data ?? []).map((r) => r.title)} today={today} onAsk={ask} />}

      {q && shopping && (
        <ShoppingReview request={shopping} pantry={pantryItems} openList={openList.data?.status === "ready" ? openList.data.names : []}
          onDone={() => openList.reload()} />
      )}

      {q && !shopping && (recipes.error ? <p className="mt-6 text-red-700">{recipes.error}</p> : !answer ? <p className="mt-6 text-bark/60">Thinking…</p> : (
        <section className="mt-6" aria-live="polite">
          <p className="text-lg text-bark">{answer.reply}</p>
          <p className="mt-1 text-xs text-bark/50">Heard: {heard(parseAsk(q)).join(" · ") || "a request for ideas"} · Kitchen's own rules, not AI</p>
          <ul className="mt-4 space-y-4">
            {answer.suggestions.map((s) => <li key={s.recipe.id}><SuggestionCard s={s} openList={openList.data?.status === "ready" ? openList.data.names : []} pantry={pantryItems} /></li>)}
          </ul>
          {member && supabase && answer.ranked.length > 0 && (
            <AiSecondOpinion key={q} q={q} answer={answer} people={people} pantry={pantryItems} openList={openList.data?.status === "ready" ? openList.data.names : []} />
          )}
        </section>
      ))}

      <FoodNotes profiles={profiles.data} onSaved={() => profiles.reload()} />
      <p className="mt-8 text-xs text-bark/50">
        Stock, places and best-before dates are ELK Pantry's, as entered in ELK Inventory. Ratings and food notes are what
        family members recorded. Kitchen doesn't guess either.
      </p>
    </div>
  );
}

// ── Asking (typed, or one spoken request after a tap) ────────────────────────
export function AskBox({ text, setText, onAsk, compact = false }: { text: string; setText: (s: string) => void; onAsk: (s: string) => void; compact?: boolean }) {
  const mic = useListening({ onHeard: (t) => { setText(t); mic.stop(); onAsk(t); }, keepListening: false });
  const listening = mic.state === "listening" || mic.state === "starting";
  return (
    <div className={compact ? "" : "mt-4"}>
      <form onSubmit={(e) => { e.preventDefault(); onAsk(text); }} className="flex gap-2">
        <input value={listening ? mic.interim || text : text} onChange={(e) => setText(e.target.value)} className={`${inputClass} mt-0 flex-1`}
          placeholder="Ask Kitchen…" aria-label="Ask Kitchen" enterKeyHint="go" />
        {mic.supported && (
          <button type="button" onClick={() => (listening ? mic.stop() : mic.start())} aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Ask out loud (listens once)"}
            className={`min-h-12 min-w-12 rounded-xl text-xl ${listening ? "bg-tomato text-white" : "border border-clay bg-cream"}`}>🎤</button>
        )}
        <button type="submit" className={`${primaryButton} py-3`}>Ask</button>
      </form>
      {listening && <p className="mt-1 text-sm text-tomato">Listening for one request — tap 🎤 to stop.</p>}
      {mic.error && <p className="mt-1 text-sm text-red-700">{mic.error}</p>}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" onClick={() => { setText(x); onAsk(x); }}
            className="shrink-0 rounded-full border border-clay bg-cream px-3 py-2 text-sm text-bark">{x}</button>
        ))}
      </div>
    </div>
  );
}

// ── What ELK Pantry shows right now ──────────────────────────────────────────
function WhatWeHave({ pantry, items, recipeTitles, today, onAsk }: {
  pantry: ReturnType<typeof usePantry>["pantry"]; items: PantryItem[] | null; recipeTitles: string[]; today: string; onAsk: (s: string) => void;
}) {
  if (pantry === undefined) return <p className="mt-6 text-sm text-bark/60">Checking ELK Pantry…</p>;
  if (!items) {
    return (
      <Box title="What we have">
        <p className="text-bark/80">
          {pantry === "off" ? "ELK Pantry isn't connected on this device (it needs the family sign-in)."
            : pantry.status === "not-set-up" ? "ELK Pantry isn't set up in the family database yet."
            : "Couldn't reach ELK Pantry just now."}
          {" "}Kitchen can still suggest from the family's recipes and ratings — and you can tell it what you have.
        </p>
      </Box>
    );
  }
  const soon = useSoon(items, today);
  const left = leftovers(items, recipeTitles);
  const low = items.filter((p) => p.onHand > 0 && isLow(p));
  const inStock = items.filter((p) => p.onHand > 0).length;
  return (
    <Box title="What we have" action={<a href={INVENTORY_PANTRY_URL} className="text-xs text-sage underline">Open Pantry</a>}>
      <p className="text-bark">Pantry shows {inStock} thing{inStock === 1 ? "" : "s"} in stock.</p>
      {soon.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-tomato">Use soon</p>
          <ul className="mt-1 space-y-1 text-sm">
            {soon.slice(0, 6).map((s) => <li key={s.item.name} className="text-bark">{s.item.name} — {whenLabel(s.daysLeft)} <span className="text-bark/60">({stockLabel(s.item)})</span></li>)}
          </ul>
          <button type="button" className="mt-2 text-sm font-semibold text-sage underline" onClick={() => onAsk("What's going bad soon?")}>What can we make with these?</button>
        </div>
      )}
      {left.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-bark">Leftovers in Pantry</p>
          <ul className="mt-1 space-y-1 text-sm">{left.map((p) => <li key={p.name}>{p.name} <span className="text-bark/60">({stockLabel(p)})</span></li>)}</ul>
        </div>
      )}
      {low.length > 0 && <p className="mt-3 text-sm text-bark/70">Running low (Pantry's own level): {low.map((p) => p.name).join(", ")}</p>}
    </Box>
  );
}

// ── One suggestion ───────────────────────────────────────────────────────────
const BADGE: Record<Reason["source"], { label: string; cls: string }> = {
  pantry: { label: "✓ Pantry", cls: "text-sage" },
  said: { label: "🗣 You said", cls: "text-saffron" },
  family: { label: "★ Family", cls: "text-cocoa" },
  recipe: { label: "Recipe", cls: "text-bark/60" },
  caution: { label: "⚠", cls: "text-tomato" },
  missing: { label: "Shopping?", cls: "text-bark/60" },
};

function SuggestionCard({ s, openList, pantry }: { s: Suggestion; openList: string[]; pantry: PantryItem[] | null }) {
  const start = useStartCooking();
  const [shop, setShop] = useState(false);
  const r = s.recipe;
  return (
    <article className="rounded-2xl border border-clay bg-cream p-4 shadow-sm">
      <Link to={`/recipe/${encodeURIComponent(r.id)}`} className="font-display text-xl font-semibold text-bark hover:underline">{r.title}</Link>
      <ul className="mt-2 space-y-1 text-sm">
        {s.reasons.map((x, i) => (
          <li key={i} className="flex gap-2"><span className={`shrink-0 text-xs font-semibold ${BADGE[x.source].cls}`}>{BADGE[x.source].label}</span><span className="text-bark">{x.text}</span></li>
        ))}
        {s.reasons.length === 0 && <li className="text-bark/60">From the family's recipes. No ratings or Pantry matches recorded for it yet.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={() => start(r)}>🎤 Cook this</button>
        {(s.missing.length > 0 || s.unknown.length > 0) && supabase && (
          <button type="button" className={secondaryButton} onClick={() => setShop((v) => !v)} aria-expanded={shop}>Shopping list…</button>
        )}
      </div>
      {shop && (
        <ShoppingReview request={{ kind: "add", names: [...s.missing.map((m) => m.status.state === "missing" ? m.status.item.name : m.name)], reason: "asked" }}
          extra={s.unknown.map((u) => u.name)} recipeTitle={r.title} pantry={pantry} openList={openList} onDone={() => undefined} />
      )}
    </article>
  );
}

// ── Optional AI pass (only when asked; labelled; Pantry facts stay Pantry's) ──
function AiSecondOpinion({ q, answer, people, pantry, openList }: { q: string; answer: Answer; people: MemberProfile[]; pantry: PantryItem[] | null; openList: string[] }) {
  const [result, setResult] = useState<AiResult | "asking" | null>(null);
  const [shopFor, setShopFor] = useState<string | null>(null);
  async function go() {
    setResult("asking");
    const token = (await supabase!.auth.getSession()).data.session?.access_token;
    if (!token) { setResult({ ok: false, error: "Sign in again to use Kitchen's AI." }); return; }
    const ask = parseAsk(q);
    const notes = people.flatMap((p) => [p.avoids && `${p.name} avoids ${p.avoids}`, p.likes && `${p.name} likes ${p.likes}`]).filter((x): x is string => !!x);
    setResult(await askAi(aiRequestFrom(ask, answer, answer.ranked, notes, heard(ask)), token));
  }
  if (!result) return <button type="button" className={`${secondaryButton} mt-4`} onClick={go}>✨ Ask Kitchen's AI for a second opinion</button>;
  if (result === "asking") return <p className="mt-4 text-sm text-bark/60">Asking Kitchen's AI…</p>;
  if (!result.ok) return <p className="mt-4 text-sm text-bark/70">{result.error}</p>;
  const byId = new Map(answer.ranked.map((s) => [s.recipe.id, s]));
  const r = result.reply;
  return (
    <section className="mt-6 rounded-2xl border border-saffron/50 bg-butter/40 p-4">
      <p className={sectionLabel}>✨ AI suggestion · check before relying on it</p>
      {r.reply && <p className="mt-1 text-bark">{r.reply}</p>}
      <ul className="mt-3 space-y-4">
        {r.picks.map((p) => byId.get(p.recipeId) && (
          <li key={p.recipeId}>
            <p className="mb-1 text-sm italic text-bark/80">AI: {p.why}</p>
            <SuggestionCard s={byId.get(p.recipeId)!} openList={openList} pantry={pantry} />
          </li>
        ))}
      </ul>
      {r.ideas.map((i) => (
        <article key={i.title} className="mt-4 rounded-2xl border border-dashed border-saffron bg-cream p-4">
          <p className="text-xs font-semibold text-saffron">AI idea · not a family recipe · not saved</p>
          <h3 className="font-display text-lg font-semibold text-bark">{i.title}</h3>
          <p className="text-sm text-bark">{i.why}</p>
          {i.uses.length > 0 && <p className="mt-1 text-sm text-bark/80">Uses: {i.uses.join(", ")}</p>}
          {i.alsoNeeds.length > 0 && (
            <>
              <p className="text-sm text-bark/80">Would also need: {i.alsoNeeds.join(", ")}</p>
              <button type="button" className="mt-2 text-sm text-sage underline" onClick={() => setShopFor(shopFor === i.title ? null : i.title)}>Shopping list…</button>
              {shopFor === i.title && <ShoppingReview request={{ kind: "add", names: i.alsoNeeds, reason: "asked" }} pantry={pantry} openList={openList} onDone={() => undefined} />}
            </>
          )}
        </article>
      ))}
      {r.followUps.length > 0 && <p className="mt-3 text-sm text-bark/70">You could ask: {r.followUps.map((f, n) => <Link key={n} className="mr-2 text-sage underline" to={`/tonight?q=${encodeURIComponent(f)}`}>{f}</Link>)}</p>}
    </section>
  );
}

// ── Shopping: review, edit, then add through Pantry's own function ──────────
function ShoppingReview({ request, extra = [], recipeTitle = "", pantry, openList, onDone }: {
  request: NonNullable<ReturnType<typeof parseShopping>>; extra?: string[]; recipeTitle?: string;
  pantry: PantryItem[] | null; openList: string[]; onDone: () => void;
}) {
  const navigate = useNavigate();
  const initial = request.kind === "add" ? request.names : [];
  const [lines, setLines] = useState<ShoppingLine[]>(() => [
    ...reviewLines(initial, openList, pantry),
    ...reviewLines(extra, openList, pantry).map((l) => ({ ...l, selected: false, pantryNote: l.pantryNote || "Pantry doesn't know — tick it if you need it" })),
  ]);
  const [extraName, setExtraName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | { done: string } | { error: string }>("idle");

  if (request.kind === "add-missing") {
    return (
      <Box title="Shopping list">
        <p className="text-bark">Which recipe? Open it, or ask for ideas first — each idea has a <strong>Shopping list…</strong> button with what Pantry shows is missing.</p>
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => navigate("/")}>Choose a recipe</button>
      </Box>
    );
  }
  if (!supabase) return <Box title="Shopping list"><p className="text-bark/80">The shopping list lives in ELK Pantry, which needs the family sign-in. It isn't connected on this device.</p></Box>;

  const picked = lines.filter((l) => l.selected && l.name.trim());
  async function add() {
    setState("saving");
    const r = await addToShoppingList(supabase!, picked.map((l) => l.name.trim()), recipeTitle, recipeTitle ? "" : "asked in Kitchen");
    if (!r.ok) { setState({ error: r.error }); return; }
    setState({ done: r.added === picked.length ? `Added ${r.added} to the shopping list.` : r.added === 0 ? "Those are on the list already." : `Added ${r.added}; the rest were already on it.` });
    onDone();
  }
  return (
    <Box title={recipeTitle ? `Shopping for ${recipeTitle}` : "Add to the shopping list"}>
      {request.kind === "add" && request.reason === "out" && <p className="mb-2 text-sm text-bark/70">Adding to the list doesn't change Pantry's stock — that's done in Pantry.</p>}
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-3">
            <input type="checkbox" className="mt-3 h-5 w-5 accent-sage" checked={l.selected} disabled={l.onList}
              onChange={() => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))} aria-label={`Add ${l.name}`} />
            <div className="flex-1">
              <input className={`${inputClass} mt-0 py-2`} value={l.name} disabled={l.onList} aria-label="Item name"
                onChange={(e) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <p className="mt-0.5 text-xs text-bark/60">{l.onList ? "Already on the shopping list" : l.pantryNote}</p>
            </div>
          </li>
        ))}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (extraName.trim()) { setLines((xs) => [...xs, ...reviewLines([extraName.trim()], openList, pantry)]); setExtraName(""); } }}>
        <input className={`${inputClass} mt-0 flex-1 py-2`} value={extraName} onChange={(e) => setExtraName(e.target.value)} placeholder="Add something else" aria-label="Add something else" />
        <button type="submit" className={secondaryButton}>+</button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButton} disabled={picked.length === 0 || state === "saving"} onClick={add}>
          {state === "saving" ? "Adding…" : `Add ${picked.length || ""} to shopping list`}
        </button>
        {typeof state === "object" && "done" in state && <span className="text-sm text-sage">{state.done} <a href={INVENTORY_PANTRY_URL} className="underline">See the list</a></span>}
        {typeof state === "object" && "error" in state && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </Box>
  );
}

// ── Food notes: each person's own ────────────────────────────────────────────
function FoodNotes({ profiles, onSaved }: { profiles: Awaited<ReturnType<ReturnType<typeof useKitchen>["store"]["listProfiles"]>> | undefined; onSaved: () => void }) {
  const { store, myName } = useKitchen();
  const shared = store.mode === "family";
  const [open, setOpen] = useState(false);
  const items = profiles?.status === "ready" ? profiles.items : [];
  const mine = shared ? items.find((p) => p.mine) : undefined;
  const [name, setName] = useState(shared ? myName : "");
  const [avoids, setAvoids] = useState("");
  const [likes, setLikes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (mine) { setAvoids(mine.avoids); setLikes(mine.likes); } }, [mine?.updatedAt]);
  if (profiles?.status === "not-set-up") return null;
  async function save() {
    try {
      await store.saveMyProfile({ name: shared ? myName : name, avoids: avoids.trim(), likes: likes.trim(), notes: "" });
      setMsg("Saved."); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <Box title="Who's eating — food notes">
      {items.length === 0 ? <p className="text-sm text-bark/70">No one has written food notes yet. Kitchen only knows what people write here.</p> : (
        <ul className="space-y-1 text-sm">
          {items.map((p) => <li key={p.key}><strong>{p.name || "Someone"}</strong>{p.avoids && <> avoids {p.avoids}</>}{p.likes && <>{p.avoids ? "; " : " "}likes {p.likes}</>}</li>)}
        </ul>
      )}
      <button type="button" className="mt-2 text-sm text-sage underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {shared ? (mine ? "Change my food notes" : "Add my food notes") : "Add or change someone's food notes"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {!shared && <input className={inputClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />}
          <input className={inputClass} placeholder="Avoids (allergies, dislikes) — e.g. mushrooms, peanuts" value={avoids} onChange={(e) => setAvoids(e.target.value)} aria-label="Avoids" />
          <input className={inputClass} placeholder="Likes — e.g. spicy, anything with rice" value={likes} onChange={(e) => setLikes(e.target.value)} aria-label="Likes" />
          <button type="button" className={primaryButton} onClick={save}>Save food notes</button>
          {msg && <span className="ml-2 text-sm text-bark/70">{msg}</span>}
          <p className="text-xs text-bark/50">Kitchen flags recipes that list something you avoid. It isn't a medical check — always read the ingredients.</p>
        </div>
      )}
    </Box>
  );
}

function Box({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-clay bg-cream p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2"><h2 className={sectionLabel}>{title}</h2>{action}</div>
      {children}
    </section>
  );
}
