import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { usePantry } from "../lib/usePantry";
import { supabase } from "../lib/supabase";
import { addToShoppingList, type PantryItem } from "../lib/pantry";
import type { Reason, Suggestion } from "../lib/companion/recommend";
import { loadOpenShopping, parseShopping, reviewLines, type ShoppingLine } from "../lib/companion/shopping";
import { useListening } from "../lib/cooking/device";
import { localToday } from "../prototype/ideas/context";
import { INVENTORY_PANTRY_URL } from "./PantryPage";
import { cookingHistory } from "../lib/cooking/history";
import { useStartCooking } from "./StartCookingPage";
import { inputClass, primaryButton, secondaryButton, sectionLabel } from "../components/ui";
import type { MemberProfile } from "../types/feedback";
import type { CookDraft } from "../types/cooking";
import { PlanStore } from "../lib/sausage/preferences";
import { TastingStore } from "../lib/sausage/tasting";
import { VersionStore } from "../lib/sausage/versions";
import { chef, mergeMentions, type ChefAnswer, type ChefTurn } from "../lib/chef/chef";
import { buildKnowledge, recentlyMade, ZONE_LABEL, type Have, type Knowledge, type RecentFood, type Zone } from "../lib/chef/knowledge";
import type { Mentioned } from "../lib/chef/mentioned";
import type { Idea } from "../lib/chef/ideas";
import { familyTaste, tasteFacts, type HouseholdTaste } from "../lib/chef/familyTaste";
import { askChef, chefRequestFrom, ideaFromAi, type ChefAiRequest, type ChefAiResult } from "../lib/chef/ai";
import { loadStock, receiveFinished, type StockItem } from "../lib/pantryStock";
import { newId } from "../lib/recipeModel";

export const EXAMPLES = [
  "I made bratwurst yesterday. I also have nacho chips and cheese. What can I make for game day?",
  "What should we cook tonight?",
  "What's going bad soon?",
  "We need to use the sour cream",
  "Something quick the family will like",
  "Add cream to the shopping list",
];

// The conversation is temporary: kept for this browser tab only, never stock.
const CHAT_KEY = "elk-kitchen-chef-chat-v1";
type Turn = { id: string; text: string; picked: Mentioned[] };

// Kitchen's chef: a cooking conversation grounded in what ELK Inventory shows,
// what Kitchen recently made, what you say, and what each family member
// recorded. Kitchen's own rules always answer first (offline, or with AI off);
// the AI chef adds to them when it's switched on, and its words are labelled.
export function CompanionPage() {
  const { store, member } = useKitchen();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? "[]") as Turn[]; } catch { return []; } });
  const [picked, setPicked] = useState<Mentioned[]>([]);
  useEffect(() => { sessionStorage.setItem(CHAT_KEY, JSON.stringify(turns)); }, [turns]);
  // A question from the home page box (?q=) starts (or continues) the conversation once.
  const lastQ = useRef("");
  useEffect(() => {
    if (q && q !== lastQ.current) { lastQ.current = q; send(q); setParams({}, { replace: true }); }
  }, [q]);

  const { pantry } = usePantry();
  const recipes = useLoad(() => store.listRecipes(), [store]);
  const feedback = useLoad(() => store.listFeedback(), [store]);
  const profiles = useLoad(() => store.listProfiles(), [store]);
  const history = useLoad(() => cookingHistory(store, 40), [store]);
  const openList = useLoad(async () => (member && supabase ? loadOpenShopping(supabase) : null), [member]);
  const plans = useMemo(() => new PlanStore(window.localStorage).list(), []);
  const tastings = useMemo(() => new TastingStore(window.localStorage).list(), []);
  const versions = useMemo(() => new VersionStore(window.localStorage).list(), []);

  const pantryItems: PantryItem[] | null = pantry && pantry !== "off" && pantry.status === "ready" ? pantry.items : null;
  const today = localToday();
  const people: MemberProfile[] = profiles.data?.status === "ready" ? profiles.data.items : [];
  const fb = feedback.data?.status === "ready" ? feedback.data.items : [];
  const recent: RecentFood[] = useMemo(() => recentlyMade(history.data ?? [], plans, pantryItems, today), [history.data, plans, pantryItems, today]);
  const taste: HouseholdTaste = useMemo(() => familyTaste({ recipes: recipes.data ?? [], feedback: fb, tastings, profiles: people, versions }),
    [recipes.data, feedback.data, tastings, profiles.data, versions]);
  const openNames = openList.data?.status === "ready" ? openList.data.names : [];

  // Every answer is recomputed from today's evidence, so a Pantry change shows up straight away.
  const answers: { turn: Turn; answer: ChefAnswer | null; shopping: ReturnType<typeof parseShopping> }[] = useMemo(() => {
    let earlier: Mentioned[] = [];
    return turns.map((turn) => {
      const shopping = parseShopping(turn.text);
      if (shopping || !recipes.data) return { turn, answer: null, shopping };
      const answer = chef({ text: turn.text, earlier, picked: turn.picked, recipes: recipes.data, pantry: pantryItems, recent, feedback: fb, profiles: people, taste, today });
      earlier = answer.mentioned;
      return { turn, answer, shopping };
    });
  }, [turns, recipes.data, pantryItems, recent, feedback.data, people, taste, today]);
  const said = answers.length ? answers[answers.length - 1].answer?.mentioned ?? [] : [];
  const knowledge = useMemo(() => buildKnowledge({ pantry: pantryItems, recent, said: mergeMentions(said, picked), today, recipeTitles: (recipes.data ?? []).map((r) => r.title) }),
    [pantryItems, recent, said, picked, today, recipes.data]);

  function send(s: string, withPicked: Mentioned[] = []) {
    const t = s.trim();
    if (!t) return;
    setTurns((xs) => [...xs, { id: newId(), text: t, picked: withPicked }]);
    setPicked([]);
    setText("");
  }
  const conversation = (upTo: number): ChefTurn[] => answers.slice(0, upTo).flatMap((a) => [{ role: "you" as const, text: a.turn.text }, ...(a.answer ? [{ role: "kitchen" as const, text: a.answer.reply }] : [])]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-bold text-bark">What should we cook?</h1>
        {turns.length > 0 && <button type="button" className="text-sm text-sage underline" onClick={() => { setTurns([]); setPicked([]); }}>Start over</button>}
      </div>
      <p className="mt-1 text-sm text-bark/70">Tell Kitchen what you have, what you made, or what you're in the mood for — or pick from the lists below.</p>

      <HaveTray knowledge={knowledge} pantry={pantry} picked={picked} setPicked={setPicked}
        onAsk={() => send(`What can I make with ${picked.map((p) => p.name).join(", ")}?`, picked)} />

      <ol className="mt-6 space-y-8" aria-live="polite">
        {answers.map(({ turn, answer, shopping }, n) => (
          <li key={turn.id}>
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-sage px-4 py-2 text-white">{turn.text}</p>
            {shopping ? (
              <ShoppingReview request={shopping} pantry={pantryItems} openList={openNames} onDone={() => openList.reload()} />
            ) : recipes.error ? <p className="mt-3 text-red-700">{recipes.error}</p> : !answer ? <p className="mt-3 text-bark/60">Thinking…</p> : (
              <ChefReply answer={answer} question={turn.text} conversation={conversation(n)} taste={taste} pantry={pantryItems} openList={openNames}
                latest={n === answers.length - 1} onAsk={(s) => send(s)} />
            )}
          </li>
        ))}
      </ol>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-clay bg-cream/95 px-4 pb-3 pt-3 backdrop-blur">
        <AskBox text={text} setText={setText} onAsk={(s) => send(s)} compact examples={turns.length === 0} />
      </div>

      <FamilyLearned taste={taste} />
      <FoodNotes profiles={profiles.data} onSaved={() => profiles.reload()} />
      <p className="mt-8 text-xs text-bark/50">
        Stock, places and best-before dates are ELK Inventory's. "Made recently" is Kitchen's own cooking record. What you say stays in this
        conversation unless you add it to Inventory. Ratings and food notes are what family members recorded. Kitchen doesn't guess any of them.
      </p>
    </div>
  );
}

// ── Asking (typed, or one spoken request after a tap) ────────────────────────
export function AskBox({ text, setText, onAsk, compact = false, examples = true }: { text: string; setText: (s: string) => void; onAsk: (s: string) => void; compact?: boolean; examples?: boolean }) {
  const mic = useListening({ onHeard: (t) => { setText(t); mic.stop(); onAsk(t); }, keepListening: false });
  const listening = mic.state === "listening" || mic.state === "starting";
  return (
    <div className={compact ? "" : "mt-4"}>
      <form onSubmit={(e) => { e.preventDefault(); onAsk(text); }} className="flex gap-2">
        <input value={listening ? mic.interim || text : text} onChange={(e) => setText(e.target.value)} className={`${inputClass} mt-0 flex-1`}
          placeholder="I have… / I made… / What can I make…" aria-label="Ask Kitchen" enterKeyHint="go" />
        {mic.supported && (
          <button type="button" onClick={() => (listening ? mic.stop() : mic.start())} aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Ask out loud (listens once)"}
            className={`min-h-12 min-w-12 rounded-xl text-xl ${listening ? "bg-tomato text-white" : "border border-clay bg-cream"}`}>🎤</button>
        )}
        <button type="submit" className={`${primaryButton} py-3`}>Ask</button>
      </form>
      {listening && <p className="mt-1 text-sm text-tomato">Listening for one request — tap 🎤 to stop.</p>}
      {mic.error && <p className="mt-1 text-sm text-red-700">{mic.error}</p>}
      {examples && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => { setText(x); onAsk(x); }}
              className="shrink-0 rounded-full border border-clay bg-cream px-3 py-2 text-sm text-bark">{x.length > 60 ? `${x.slice(0, 57)}…` : x}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── What we have: pick ingredients from every source ─────────────────────────
const SOURCE_BADGE: Record<Have["source"], { label: string; cls: string }> = {
  inventory: { label: "✓ Inventory", cls: "text-sage" },
  recent: { label: "🍳 Made recently", cls: "text-cocoa" },
  said: { label: "🗣 You said", cls: "text-saffron" },
};

function HaveTray({ knowledge: k, pantry, picked, setPicked, onAsk }: {
  knowledge: Knowledge; pantry: ReturnType<typeof usePantry>["pantry"]; picked: Mentioned[]; setPicked: (f: (xs: Mentioned[]) => Mentioned[]) => void; onAsk: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const isPicked = (name: string) => picked.some((p) => p.name.toLowerCase() === name.toLowerCase());
  const toggle = (h: Have) => setPicked((xs) => (isPicked(h.name) ? xs.filter((x) => x.name.toLowerCase() !== h.name.toLowerCase())
    : [...xs, { name: h.name, amount: "", intent: h.wantUsed || h.daysLeft != null && h.daysLeft <= 4 ? "use" : "have", when: "", where: "", said: `Picked from ${h.source === "inventory" ? "Inventory" : h.source === "recent" ? "recently made" : "the conversation"}` }]));
  const zones = (Object.keys(ZONE_LABEL) as Zone[]).filter((z) => k.byZone[z].length);
  const groups: { key: string; title: string; items: Have[]; hint?: string }[] = [
    { key: "recent", title: "Recently made", items: k.have.filter((h) => h.source === "recent" || (h.source === "inventory" && h.leftover)), hint: "From Kitchen's cooking history and Sausage Day" },
    { key: "soon", title: "Use soon", items: k.useSoon, hint: "Best-before within 4 days, opened, leftovers, or you asked" },
    ...zones.map((z) => ({ key: z, title: ZONE_LABEL[z], items: k.byZone[z] })),
    { key: "said", title: "You told Kitchen", items: k.have.filter((h) => h.source === "said"), hint: "This conversation only — not in Inventory" },
  ].filter((g) => g.items.length);
  const status = pantry === undefined ? "Checking ELK Inventory…" : !k.pantryConnected
    ? (pantry === "off" ? "Inventory isn't connected on this device (it needs the family sign-in)." : pantry.status === "not-set-up" ? "ELK Pantry isn't set up in the family database yet." : "Couldn't reach ELK Inventory just now (offline?).") + " Kitchen still knows what it recorded and what you tell it."
    : `Inventory shows ${k.have.filter((h) => h.source === "inventory").length} foods in stock.`;
  return (
    <Box title="What we have" action={<a href={INVENTORY_PANTRY_URL} className="text-xs text-sage underline">Open Inventory</a>}>
      <p className="text-sm text-bark/80">{status}</p>
      {k.expired.length > 0 && <p className="mt-1 text-sm text-tomato">Past best-before: {k.expired.map((h) => h.name).join(", ")} — check before using; Kitchen won't plan around them.</p>}
      <div className="mt-3 space-y-2">
        {groups.map((g) => (
          <div key={g.key}>
            <button type="button" className="flex w-full items-baseline justify-between text-left" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
              <span className="font-semibold text-bark">{g.title} <span className="font-normal text-bark/60">({g.items.length})</span></span>
              <span className="text-sm text-sage">{open === g.key ? "Hide" : "Show"}</span>
            </button>
            {open === g.key && (
              <>
                {g.hint && <p className="text-xs text-bark/60">{g.hint}</p>}
                <ul className="mt-1 flex flex-wrap gap-2">
                  {g.items.map((h) => (
                    <li key={`${g.key}-${h.source}-${h.name}`}>
                      <button type="button" aria-pressed={isPicked(h.name)} onClick={() => toggle(h)} title={h.evidence}
                        className={`rounded-full border px-3 py-1.5 text-left text-sm ${isPicked(h.name) ? "border-sage bg-sage text-white" : "border-clay bg-white text-bark"}`}>
                        {h.name}<span className={`ml-1 text-xs ${isPicked(h.name) ? "text-white/80" : "text-bark/50"}`}>{shortEvidence(h)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
        {groups.length === 0 && <p className="text-sm text-bark/60">Nothing to pick from yet. Just tell Kitchen: "I have nacho chips", "there's half a bag of cheese".</p>}
      </div>
      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={primaryButton} onClick={onAsk}>Ideas with {picked.length} picked</button>
          <button type="button" className="text-sm text-sage underline" onClick={() => setPicked(() => [])}>Clear</button>
        </div>
      )}
    </Box>
  );
}

function shortEvidence(h: Have): string {
  if (h.source === "said") return " · you said";
  if (h.source === "recent") return ` · ${h.evidence.split(" — ")[0].replace(/^Made /, "made ")}`;
  if (h.daysLeft != null && h.daysLeft <= 4) return ` · ${h.daysLeft < 0 ? "past date" : h.daysLeft === 0 ? "today" : `${h.daysLeft}d`}`;
  if (h.opened) return " · opened";
  return "";
}

// ── One reply ────────────────────────────────────────────────────────────────
function ChefReply({ answer: a, question, conversation, taste, pantry, openList, latest, onAsk }: {
  answer: ChefAnswer; question: string; conversation: ChefTurn[]; taste: HouseholdTaste; pantry: PantryItem[] | null; openList: string[]; latest: boolean; onAsk: (s: string) => void;
}) {
  return (
    <div className="mt-3">
      <p className="text-lg text-bark">{a.reply}</p>
      {a.understood.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {a.understood.map((u) => <li key={u.name}><span className={`mr-2 text-xs font-semibold ${SOURCE_BADGE[u.source].cls}`}>{SOURCE_BADGE[u.source].label}</span>{u.name} <span className="text-bark/60">— {u.how}</span></li>)}
        </ul>
      )}
      {a.cautions.map((c) => <p key={c} className="mt-2 text-sm text-tomato">⚠ {c}</p>)}
      <p className="mt-1 text-xs text-bark/50">Kitchen's own rules{a.occasion ? ` · ${a.occasion}` : ""}{a.ask.minutes ? ` · ${a.ask.minutes} min` : a.ask.quick ? " · quick" : ""}{a.ask.diet.length ? ` · ${a.ask.diet.join(", ")}` : ""}{a.ask.avoid.length ? ` · no ${a.ask.avoid.join(", ")}` : ""}</p>

      <ul className="mt-4 space-y-4">
        {a.ideas.map((i) => <li key={i.id}><IdeaCard idea={i} question={question} pantry={pantry} openList={openList} /></li>)}
        {a.family.map((s) => <li key={s.recipe.id}><SuggestionCard s={s} openList={openList} pantry={pantry} /></li>)}
      </ul>

      {a.offerToInventory.length > 0 && latest && <AddToInventory items={a.offerToInventory} />}
      {latest && <AiChef answer={a} question={question} conversation={conversation} taste={taste} pantry={pantry} openList={openList} onAsk={onAsk} />}
    </div>
  );
}

// ── A dish idea (Kitchen's template or the AI's) ─────────────────────────────
const ING_BADGE: Record<Idea["ingredients"][number]["status"], { label: string; cls: string }> = {
  have: { label: "✓", cls: "text-sage" },
  need: { label: "Need", cls: "text-tomato" },
  optional: { label: "Optional", cls: "text-bark/50" },
  basic: { label: "Basic", cls: "text-bark/50" },
};

function IdeaCard({ idea, question, pantry, openList, model = "" }: { idea: Idea; question: string; pantry: PantryItem[] | null; openList: string[]; model?: string }) {
  const start = useStartCooking();
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState(false);
  const ai = idea.kind === "ai-generated";
  function cook() {
    const draft: CookDraft = {
      origin: ai ? "ai" : "kitchen-idea", title: idea.title, question,
      ingredients: idea.ingredients.map((i) => ({ name: i.name, amount: i.amount, status: i.status, evidence: i.evidence })),
      steps: idea.steps, safety: idea.safety, why: idea.why, model, createdAt: new Date().toISOString(),
    };
    start(null, idea.title, draft);
  }
  return (
    <article className={`rounded-2xl border bg-cream p-4 shadow-sm ${ai ? "border-dashed border-saffron" : "border-clay"}`}>
      <p className={`text-xs font-semibold ${ai ? "text-saffron" : "text-bark/60"}`}>
        {ai ? "✨ AI recipe · not a family recipe · not saved unless you cook and save it" : "Kitchen idea · not a family recipe yet"}
      </p>
      <h3 className="font-display text-xl font-semibold text-bark">{idea.title}</h3>
      <p className="text-sm text-bark/70">{[idea.minutes ? `about ${idea.minutes} min` : "", idea.serves].filter(Boolean).join(" · ")}</p>
      <ul className="mt-2 space-y-1 text-sm text-bark">{idea.why.map((w) => <li key={w}>{w}</li>)}</ul>
      {idea.familyNotes.length > 0 && <ul className="mt-2 space-y-1 text-sm text-cocoa">{idea.familyNotes.map((w) => <li key={w}>★ {w}</li>)}</ul>}
      {idea.missing.length > 0 && <p className="mt-2 text-sm text-tomato">Missing: {idea.missing.join(", ")}</p>}
      <button type="button" className="mt-2 text-sm text-sage underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide recipe" : "Ingredients and steps"}</button>
      {open && (
        <div className="mt-2">
          <ul className="space-y-1 text-sm">
            {idea.ingredients.map((i, n) => (
              <li key={n} className="flex gap-2">
                <span className={`w-16 shrink-0 text-xs font-semibold ${ING_BADGE[i.status].cls}`}>{ING_BADGE[i.status].label}</span>
                <span className="text-bark">{i.amount && <span className="text-bark/70">{i.amount} </span>}{i.name}<span className="block text-xs text-bark/50">{i.evidence}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-bark/50">Amounts are for the dish{ai ? " (the AI's suggestion — check them)" : ""}. What you have is only from Inventory, Kitchen's records or what you said.</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-bark">{idea.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
          {idea.safety.map((s) => <p key={s} className="mt-2 text-sm text-tomato">🌡 {s}</p>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={cook}>🎤 Cook this</button>
        {(idea.missing.length > 0 || idea.niceToHave.length > 0) && (
          <button type="button" className={secondaryButton} aria-expanded={shop} onClick={() => setShop((v) => !v)}>Shopping list…</button>
        )}
      </div>
      {shop && <ShoppingReview request={{ kind: "add", names: idea.missing, reason: "asked" }} extra={idea.niceToHave} recipeTitle={idea.title} pantry={pantry} openList={openList} onDone={() => undefined} />}
    </article>
  );
}

// ── A family recipe that fits ────────────────────────────────────────────────
const BADGE: Record<Reason["source"], { label: string; cls: string }> = {
  pantry: { label: "✓ Inventory", cls: "text-sage" },
  said: { label: "🗣 You said", cls: "text-saffron" },
  family: { label: "★ Family", cls: "text-cocoa" },
  recipe: { label: "Recipe", cls: "text-bark/60" },
  caution: { label: "⚠", cls: "text-tomato" },
  missing: { label: "Shopping?", cls: "text-bark/60" },
};

function SuggestionCard({ s, openList, pantry, aiWhy }: { s: Suggestion; openList: string[]; pantry: PantryItem[] | null; aiWhy?: string }) {
  const start = useStartCooking();
  const [shop, setShop] = useState(false);
  const r = s.recipe;
  return (
    <article className="rounded-2xl border border-clay bg-cream p-4 shadow-sm">
      <p className="text-xs font-semibold text-sage">From the family's recipes</p>
      <Link to={`/recipe/${encodeURIComponent(r.id)}`} className="font-display text-xl font-semibold text-bark hover:underline">{r.title}</Link>
      {aiWhy && <p className="mt-1 text-sm italic text-bark/80">✨ AI: {aiWhy}</p>}
      <ul className="mt-2 space-y-1 text-sm">
        {s.reasons.map((x, i) => (
          <li key={i} className="flex gap-2"><span className={`shrink-0 text-xs font-semibold ${BADGE[x.source].cls}`}>{BADGE[x.source].label}</span><span className="text-bark">{x.text}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={() => start(r)}>🎤 Cook this</button>
        {(s.missing.length > 0 || s.unknown.length > 0) && <button type="button" className={secondaryButton} onClick={() => setShop((v) => !v)} aria-expanded={shop}>Shopping list…</button>}
      </div>
      {shop && (
        <ShoppingReview request={{ kind: "add", names: s.missing.map((m) => (m.status.state === "missing" ? m.status.item.name : m.name)), reason: "asked" }}
          extra={s.unknown.map((u) => u.name)} recipeTitle={r.title} pantry={pantry} openList={openList} onDone={() => undefined} />
      )}
    </article>
  );
}

// ── The AI chef (family sign-in + a key on the server; otherwise a quiet note) ──
function AiChef({ answer, question, conversation, taste, pantry, openList, onAsk }: {
  answer: ChefAnswer; question: string; conversation: ChefTurn[]; taste: HouseholdTaste; pantry: PantryItem[] | null; openList: string[]; onAsk: (s: string) => void;
}) {
  const { member } = useKitchen();
  const [result, setResult] = useState<ChefAiResult | "asking" | null>(null);
  const [req, setReq] = useState<ChefAiRequest | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !member || !supabase) return;
    asked.current = true;
    (async () => {
      setResult("asking");
      const token = (await supabase!.auth.getSession()).data.session?.access_token;
      if (!token) { setResult({ ok: false, error: "Sign in again to use Kitchen's AI chef." }); return; }
      const r = chefRequestFrom(answer, question, conversation, tasteFacts(taste));
      setReq(r);
      setResult(await askChef(r, token));
    })();
  }, [member]);
  if (!member || !supabase) {
    return <p className="mt-4 text-xs text-bark/50">Kitchen's AI chef needs the family sign-in, so these are Kitchen's own ideas from its rules.</p>;
  }
  if (result === null || result === "asking") return <p className="mt-4 text-sm text-bark/60">✨ Asking Kitchen's AI chef…</p>;
  if (!result.ok) return <p className="mt-4 text-sm text-bark/60">{result.off ? "Kitchen's AI chef isn't switched on, so these are Kitchen's own ideas." : result.error}</p>;
  const r = result.reply;
  const byId = new Map(answer.familyPool.map((s) => [s.recipe.id, s]));
  return (
    <section className="mt-6 rounded-2xl border border-saffron/50 bg-butter/40 p-4">
      <p className={sectionLabel}>✨ Kitchen's AI chef · check before relying on it</p>
      {r.reply && <p className="mt-1 text-bark">{r.reply}</p>}
      <ul className="mt-3 space-y-4">
        {r.recipes.map((x, n) => <li key={`${n}-${x.title}`}><IdeaCard idea={ideaFromAi(x, req!, n)} question={question} pantry={pantry} openList={openList} model={result.model} /></li>)}
        {r.picks.map((p) => byId.get(p.recipeId) && <li key={p.recipeId}><SuggestionCard s={byId.get(p.recipeId)!} aiWhy={p.why} openList={openList} pantry={pantry} /></li>)}
      </ul>
      {r.followUps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.followUps.map((f) => <button key={f} type="button" className="rounded-full border border-saffron bg-cream px-3 py-1.5 text-sm text-bark" onClick={() => onAsk(f)}>{f}</button>)}
        </div>
      )}
      <p className="mt-2 text-xs text-bark/50">"✓" on an AI recipe is kept only where Inventory, Kitchen's records or you said so. Everything else is marked Need.</p>
    </section>
  );
}

// ── "I found some peppers" → Inventory, only when the person confirms ────────
function AddToInventory({ items }: { items: Mentioned[] }) {
  const { member } = useKitchen();
  const [open, setOpen] = useState(false);
  const stock = useLoad(async () => (open && member && supabase ? loadStock(supabase) : null), [open, member]);
  if (!member || !supabase) return null;
  const list: StockItem[] = stock.data && stock.data.status === "ready" ? stock.data.items : [];
  return (
    <Box title="Add to Inventory?">
      <p className="text-sm text-bark/80">You mentioned {items.map((m) => m.name).join(", ")}. Inventory doesn't have {items.length === 1 ? "it" : "them"}. Kitchen won't add anything unless you confirm each one.</p>
      {!open ? <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setOpen(true)}>Choose what to add…</button> : (
        stock.data === undefined || stock.data === null ? <p className="mt-2 text-sm text-bark/60">Reading Inventory…</p>
        : stock.data.status !== "ready" ? <p className="mt-2 text-sm text-bark/70">{stock.data.status === "not-set-up" ? "ELK Pantry isn't set up in this database yet." : `Couldn't read Inventory: ${stock.data.error}`}</p>
        : <ul className="mt-2 space-y-3">{items.map((m) => <li key={m.name}><AddRow m={m} items={list} onDone={() => stock.reload()} /></li>)}</ul>
      )}
    </Box>
  );
}

function AddRow({ m, items, onDone }: { m: Mentioned; items: StockItem[]; onDone: () => void }) {
  const existing = items.find((x) => x.name.trim().toLowerCase() === m.name.trim().toLowerCase()) ?? null;
  const [name, setName] = useState(m.name.charAt(0).toUpperCase() + m.name.slice(1));
  const [count, setCount] = useState("1");
  const [unit, setUnit] = useState(existing?.unit ?? (/bag/.test(m.amount) ? "bags" : /jar/.test(m.amount) ? "jars" : /can|tin/.test(m.amount) ? "cans" : "packs"));
  const [place, setPlace] = useState(m.where ? m.where.charAt(0).toUpperCase() + m.where.slice(1) : "");
  const [bestBefore, setBestBefore] = useState("");
  const [state, setState] = useState<"idle" | "saving" | { done: string } | { error: string }>("idle");
  const [requestId] = useState(newId);
  const [itemId] = useState(newId);
  async function add() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) { setState({ error: "Inventory counts whole packages: 1 or more." }); return; }
    if (!window.confirm(`Add ${n} ${unit} of ${existing?.name ?? name} to ELK Inventory${place ? ` (${place})` : ""}?`)) return;
    setState("saving");
    const r = await receiveFinished(supabase!, { item: existing, newName: name, unit, quantity: n, location: place, bestBefore: bestBefore || null, madeOn: localToday(), requestId, newItemId: itemId });
    if (!r.ok) { setState({ error: r.error }); return; }
    setState({ done: `Added to Inventory: ${n} ${r.action.unit} of ${r.action.itemName}.` });
    onDone();
  }
  if (typeof state === "object" && "done" in state) return <p className="text-sm text-sage">✓ {state.done}</p>;
  return (
    <div className="rounded-xl border border-clay bg-white/70 p-3">
      <p className="text-xs text-bark/60">You said: “{m.said}”{m.amount ? ` — Inventory counts whole packages, so “${m.amount}” needs a number` : ""}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_4rem_6rem]">
        <input aria-label="Name in Inventory" className={`${inputClass} mt-0`} value={existing?.name ?? name} disabled={!!existing} onChange={(e) => setName(e.target.value)} />
        <input aria-label="How many" type="number" inputMode="numeric" min={1} step={1} className={`${inputClass} mt-0`} value={count} onChange={(e) => setCount(e.target.value)} />
        <input aria-label="Unit" className={`${inputClass} mt-0`} value={unit} disabled={!!existing} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input aria-label="Where it is" list="kitchen-places" placeholder="Where (Fridge, Freezer, Pantry…)" className={`${inputClass} mt-0`} value={place} onChange={(e) => setPlace(e.target.value)} />
        <input aria-label="Best before (optional)" type="date" className={`${inputClass} mt-0`} value={bestBefore} onChange={(e) => setBestBefore(e.target.value)} />
      </div>
      <datalist id="kitchen-places"><option value="Fridge" /><option value="Freezer" /><option value="Pantry" /><option value="Chest freezer" /></datalist>
      {existing && <p className="mt-1 text-xs text-bark/60">Inventory already has “{existing.name}” (none left) — this adds a new batch to it.</p>}
      <button type="button" className={`${secondaryButton} mt-2`} disabled={state === "saving"} onClick={add}>{state === "saving" ? "Adding…" : "Add to Inventory"}</button>
      {typeof state === "object" && "error" in state && <p className="mt-1 text-sm text-red-700">{state.error}</p>}
    </div>
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
    ...reviewLines(extra.filter((x) => !initial.includes(x)), openList, pantry).map((l) => ({ ...l, selected: false, pantryNote: l.pantryNote || "Nice to have — tick it if you want it" })),
  ]);
  const [extraName, setExtraName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | { done: string } | { error: string }>("idle");

  if (request.kind === "add-missing") {
    return (
      <Box title="Shopping list">
        <p className="text-bark">Which dish? Ask for ideas first — each one has a <strong>Shopping list…</strong> button with what's missing.</p>
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => navigate("/")}>Choose a recipe</button>
      </Box>
    );
  }
  const picked = lines.filter((l) => l.selected && l.name.trim());
  async function add() {
    setState("saving");
    const r = await addToShoppingList(supabase!, picked.map((l) => l.name.trim()), recipeTitle, recipeTitle ? "" : "asked in Kitchen");
    if (!r.ok) { setState({ error: r.error }); return; }
    setState({ done: r.added === picked.length ? `Added ${r.added} to the shopping list.` : r.added === 0 ? "Those are on the list already." : `Added ${r.added}; the rest were already on it.` });
    onDone();
  }
  async function copy() {
    const t = picked.map((l) => `• ${l.name.trim()}`).join("\n");
    try { await navigator.clipboard.writeText(`${recipeTitle ? `For ${recipeTitle}:\n` : ""}${t}`); setState({ done: "Copied — paste it wherever you keep your list." }); }
    catch { setState({ error: "Couldn't copy on this device." }); }
  }
  return (
    <Box title={recipeTitle ? `Shopping for ${recipeTitle}` : "Add to the shopping list"}>
      {request.kind === "add" && request.reason === "out" && <p className="mb-2 text-sm text-bark/70">Adding to the list doesn't change Inventory's stock — that's done in Inventory.</p>}
      {!supabase && <p className="mb-2 text-sm text-bark/70">The shared shopping list lives in ELK Inventory, which needs the family sign-in. On this device you can copy the list instead.</p>}
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
        {supabase ? (
          <button type="button" className={primaryButton} disabled={picked.length === 0 || state === "saving"} onClick={add}>
            {state === "saving" ? "Adding…" : `Add ${picked.length || ""} to shopping list`}
          </button>
        ) : (
          <button type="button" className={primaryButton} disabled={picked.length === 0} onClick={copy}>Copy {picked.length || ""} to clipboard</button>
        )}
        {typeof state === "object" && "done" in state && <span className="text-sm text-sage">{state.done} {supabase && <a href={INVENTORY_PANTRY_URL} className="underline">See the list</a>}</span>}
        {typeof state === "object" && "error" in state && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </Box>
  );
}

// ── What Kitchen has learned about the family (only what people recorded) ────
function FamilyLearned({ taste }: { taste: HouseholdTaste }) {
  const [open, setOpen] = useState(false);
  const facts = tasteFacts(taste);
  if (!facts.length) return null;
  return (
    <Box title="What Kitchen has learned" action={<button type="button" className="text-xs text-sage underline" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : `Show (${facts.length})`}</button>}>
      <p className="text-sm text-bark/70">From each person's ratings, tasting cards, comments and food notes. One person's rating is theirs, not the household's.</p>
      {open && <ul className="mt-2 space-y-1 text-sm text-bark">{facts.map((f) => <li key={f}>{f}</li>)}</ul>}
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
          <p className="text-xs text-bark/50">Kitchen flags dishes that list something you avoid. It isn't a medical check — always read the ingredients.</p>
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
