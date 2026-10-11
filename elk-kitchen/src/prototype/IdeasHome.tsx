import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fetchLocalWeather, greeting, seasonOf, upcomingHolidays, weatherFromReading, whenLabel, WEATHER_LABEL } from "./ideas/context";
import { CHIP_GROUPS, HAVE_CHIPS, chipOn, toggleChip } from "./ideas/haveChips";
import { SAMPLE_IDEAS } from "./ideas/sampleIdeas";
import { haveShelf, moodShelf, shelfFor, type Feel, type Goal, type Meal, type Shelf, type WithIngredient } from "./ideas/suggest";
import type { Weather } from "./ideas/types";
import { AskBox, Conversation } from "./AskKitchen";
import { FoodArt, PrototypeHeader, PrototypeRibbon, SampleCard, SavedCard, chipClass, display } from "./components";
import { PHOTO_CREDITS } from "./photos";
import { useIdeas, type Entry } from "./IdeasSession";

const SEASON_LABEL = { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" };

const ENTRIES: { key: Exclude<Entry, "tonight">; title: string; subtitle: string; emoji: string; palette: [string, string] }[] = [
  { key: "surprise", title: "Surprise me", subtitle: "A few good dinners — no thinking required", emoji: "🎲", palette: ["#ffd6a5", "#e76f51"] },
  { key: "have", title: "Use what we have", subtitle: "Tap a few things in the kitchen", emoji: "🧺", palette: ["#e9c46a", "#a3b18a"] },
  { key: "mood", title: "I'm in the mood for…", subtitle: "Narrow it down in a few taps", emoji: "💭", palette: ["#cdb4db", "#8e7dbe"] },
];

export function IdeasHome() {
  const { moment, saved, entry, setEntry, reroll } = useIdeas();
  const date = new Date(`${moment.today}T12:00:00`).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
  const holiday = upcomingHolidays(moment.today)[0];

  function choose(key: Exclude<Entry, "tonight">) {
    if (key === "surprise") reroll();
    setEntry(entry === key && key !== "surprise" ? "tonight" : key);
    requestAnimationFrame(() => document.getElementById("pick")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#fff4dc_0%,#faf7f2_55%)] pb-20 text-cocoa">
      <PrototypeRibbon />
      <PrototypeHeader />

      <section className="mx-auto max-w-6xl px-4 pb-6 pt-7 sm:px-6 sm:pt-12">
        <p className="text-sm font-medium text-tomato">
          {greeting()} · {date} · {SEASON_LABEL[seasonOf(moment.today)]}
        </p>
        <h1 className={`${display} mt-3 max-w-3xl text-[2.5rem] leading-[1.05] tracking-tight text-cocoa sm:text-6xl`}>
          What should we cook tonight?
        </h1>
        {holiday && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-sm text-cocoa ring-1 ring-saffron/40">
            <span aria-hidden>🍂</span>{holiday.name} is {whenLabel(holiday.inDays, holiday.date)}
          </p>
        )}

        <ul className="mt-7 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {ENTRIES.map((e) => (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => choose(e.key)}
                aria-pressed={entry === e.key}
                className={`flex h-full w-full items-center gap-4 overflow-hidden rounded-3xl bg-white p-3 text-left shadow-[0_12px_30px_-14px_rgba(61,44,34,0.45)] transition hover:-translate-y-0.5 sm:flex-col sm:items-stretch sm:p-0 ${
                  entry === e.key ? "ring-4 ring-cocoa" : "ring-1 ring-cocoa/5"}`}
              >
                <FoodArt emoji={e.emoji} palette={e.palette} className="h-20 w-20 shrink-0 rounded-2xl sm:aspect-[5/2] sm:h-auto sm:w-full sm:rounded-none [&>span]:text-4xl sm:[&>span]:text-6xl" />
                <span className="flex flex-col sm:px-5 sm:pb-5">
                  <span className={`${display} text-2xl leading-tight text-cocoa`}>{e.title}</span>
                  <span className="mt-1 text-[15px] text-cocoa/65">{e.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Tonight />

      <section id="pick" className="mx-auto mt-8 max-w-6xl scroll-mt-4 px-4 sm:px-6">
        {entry === "tonight" && <TonightIdeas />}
        {entry === "surprise" && <SurpriseIdeas />}
        {entry === "have" && <HavePanel />}
        {entry === "mood" && <MoodPanel />}
      </section>

      <RecipeBook saved={saved} />
      <WhatsReal />
    </div>
  );
}

// Optional context that every suggestion uses. Only what the person taps.
function Tonight() {
  const { moment, setMoment } = useIdeas();
  const [checking, setChecking] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  async function checkWeather() {
    setChecking(true); setWeatherError(null);
    try {
      const w = weatherFromReading(await fetchLocalWeather());
      setMoment({ weather: w.weather, weatherNote: w.note });
    } catch (e) {
      setWeatherError(e instanceof Error ? e.message : "Couldn't check the weather.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="rounded-3xl bg-white/70 p-4 ring-1 ring-cocoa/10 sm:p-5">
        <p className="text-sm font-semibold text-cocoa">About tonight <span className="font-normal text-cocoa/50">— optional. Kitchen only uses what you tap.</span></p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Row label="Who's eating">
            {[2, 4, 6, 8].map((n) => (
              <button key={n} type="button" className={chipClass(moment.people === n)} aria-pressed={moment.people === n}
                onClick={() => setMoment({ people: moment.people === n ? null : n })}>{n === 8 ? "8+" : n}</button>
            ))}
            <button type="button" className={chipClass(moment.kids)} aria-pressed={moment.kids} onClick={() => setMoment({ kids: !moment.kids })}>🧒 Kids too</button>
          </Row>
          <Row label="Time">
            {[20, 30, 60].map((m) => (
              <button key={m} type="button" className={chipClass(moment.minutes === m)} aria-pressed={moment.minutes === m}
                onClick={() => setMoment({ minutes: moment.minutes === m ? null : m })}>
                {m < 60 ? `${m} min` : "An hour"}
              </button>
            ))}
            <button type="button" className={chipClass(moment.minutes === null)} aria-pressed={moment.minutes === null} onClick={() => setMoment({ minutes: null })}>No rush</button>
          </Row>
          <Row label="Weather" hint={moment.weatherNote ?? weatherError ?? "Tap one, or let Kitchen check (asks for your location once)"}>
            <button type="button" onClick={checkWeather} disabled={checking} className={chipClass(false)}>{checking ? "Checking…" : "📍 Check"}</button>
            {(Object.keys(WEATHER_LABEL) as Weather[]).map((w) => (
              <button key={w} type="button" className={chipClass(moment.weather === w)} aria-pressed={moment.weather === w}
                onClick={() => setMoment({ weather: moment.weather === w ? null : w, weatherNote: null })}>{WEATHER_LABEL[w]}</button>
            ))}
          </Row>
        </div>
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-cocoa/55">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-cocoa/50">{hint}</p>}
    </div>
  );
}

function useCtx() {
  const { saved, pantry, answers, moment, seed } = useIdeas();
  return { samples: SAMPLE_IDEAS, saved: saved ?? [], pantry, answers, moment, seed };
}

function TonightIdeas() {
  const ctx = useCtx();
  const shelf = useMemo(() => shelfFor("tonight", ctx), [ctx.saved, ctx.pantry, ctx.answers, ctx.moment]);
  return (
    <>
      <Heading title="A few ideas for tonight" sub="Picked for today — tap one of the buttons above to steer." />
      <Results shelf={shelf} />
    </>
  );
}

function SurpriseIdeas() {
  const { reroll } = useIdeas();
  const ctx = useCtx();
  const shelf = useMemo(() => shelfFor("surprise", ctx), [ctx.saved, ctx.pantry, ctx.answers, ctx.moment, ctx.seed]);
  return (
    <>
      <Heading title="How about one of these?" sub="Three dinners, picked at random from what suits tonight.">
        <button type="button" onClick={reroll} className="shrink-0 rounded-full bg-cocoa px-5 py-2.5 font-semibold text-butter hover:bg-cocoa/90">🎲 Show me others</button>
      </Heading>
      <Results shelf={shelf} />
    </>
  );
}

function HavePanel() {
  const { answers, setAnswers, pantryMode, setPantryMode, realPantry } = useIdeas();
  const ctx = useCtx();
  const shelf = useMemo(() => haveShelf(ctx), [ctx.saved, ctx.pantry, ctx.answers, ctx.moment]);
  const anyTapped = HAVE_CHIPS.some((c) => chipOn(c, answers));
  const knowsSomething = anyTapped || pantryMode !== "none" || Object.keys(answers).length > 0;

  return (
    <>
      <Heading title="What's in the kitchen?" sub="Tap a few things you know you have. No need to list everything — Kitchen asks about the rest." />
      <div className="rounded-3xl bg-white p-4 ring-1 ring-cocoa/10 sm:p-5">
        {CHIP_GROUPS.map((g) => (
          <div key={g} className="mb-3 last:mb-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-cocoa/55">{g}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {HAVE_CHIPS.filter((c) => c.group === g).map((c) => {
                const on = chipOn(c, answers);
                return (
                  <button key={c.label} type="button" aria-pressed={on} onClick={() => setAnswers(toggleChip(c, answers))}
                    className={`${chipClass(on)} px-4 py-2 text-[15px]`}>{on ? "✓ " : ""}{c.label}</button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-cocoa/10 pt-3 text-sm">
          {pantryMode === "pantry" ? (
            <>
              <span className="rounded-full bg-leaf/15 px-3 py-1 font-medium text-cocoa">Also using your ELK Pantry</span>
              <Link to="/pantry" className="text-cocoa/60 underline">What's in it?</Link>
              <button type="button" className="text-cocoa/60 underline" onClick={() => setPantryMode("none")}>Ignore it</button>
            </>
          ) : pantryMode === "sample" ? (
            <>
              <span className="rounded-full bg-saffron/20 px-3 py-1 font-medium text-cocoa">Using a pretend Pantry — not your real cupboard</span>
              <button type="button" className="text-cocoa/60 underline" onClick={() => setPantryMode("none")}>Turn it off</button>
            </>
          ) : realPantry === "ready" ? (
            <>
              <span className="text-cocoa/65">Not using ELK Pantry, so Kitchen only knows what you tap.</span>
              <button type="button" className="text-tomato underline" onClick={() => setPantryMode("pantry")}>Use ELK Pantry</button>
            </>
          ) : realPantry === "loading" ? (
            <span className="text-cocoa/65">Checking ELK Pantry…</span>
          ) : (
            <>
              <span className="text-cocoa/65">ELK Pantry isn't available here (it needs the family sign-in), so Kitchen only knows what you tap.</span>
              <button type="button" className="text-tomato underline" onClick={() => setPantryMode("sample")}>Try a pretend Pantry</button>
            </>
          )}
          {Object.keys(answers).length > 0 && <button type="button" className="ml-auto text-cocoa/60 underline" onClick={() => setAnswers({})}>Clear my answers</button>}
        </div>
      </div>
      {!knowsSomething ? (
        <p className="mt-6 rounded-3xl border border-dashed border-cocoa/20 p-8 text-center text-lg text-cocoa/60">Tap two or three things above and Kitchen will find dinners that use them.</p>
      ) : shelf.samples.length + shelf.saved.length === 0 ? (
        <p className="mt-6 rounded-3xl bg-butter p-6 text-cocoa/75">Nothing in your recipe book or the example ideas uses those yet.</p>
      ) : (
        <div className="mt-2"><Results shelf={shelf} /></div>
      )}
    </>
  );
}

const MEALS: [Meal, string][] = [["dinner", "Dinner"], ["lunch", "Lunch"], ["snack", "A snack"], ["side", "A side dish"]];
const FEELS: [Feel, string][] = [["comfort", "Warm & comforting"], ["fresh", "Fresh & light"], ["bbq", "Off the BBQ"]];
const GOALS: [Goal, string][] = [["protein", "More protein"], ["veg", "More vegetables"], ["fibre", "More fibre"]];
const WITHS: [WithIngredient, string][] = [["chicken", "Chicken"], ["turkey", "Turkey"], ["beans", "Beans & lentils"], ["pasta", "Pasta"], ["potatoes", "Potatoes"], ["cheese", "Cheese"]];

function MoodPanel() {
  const { mood, setMood, moment, thread } = useIdeas();
  const ctx = useCtx();
  const shelf = useMemo(() => moodShelf(mood, ctx), [mood, ctx.saved, ctx.pantry, ctx.answers, ctx.moment]);

  function pick<K extends keyof typeof mood>(k: K, options: [NonNullable<(typeof mood)[K]>, string][]) {
    return options.map(([v, l]) => (
      <button key={String(v)} type="button" aria-pressed={mood[k] === v} className={`${chipClass(mood[k] === v)} px-4 py-2 text-[15px]`}
        onClick={() => setMood({ [k]: mood[k] === v ? null : v } as Partial<typeof mood>)}>{l}</button>
    ));
  }

  const said = [
    MEALS.find(([v]) => v === mood.meal)?.[1],
    FEELS.find(([v]) => v === mood.feel)?.[1].toLowerCase(),
    mood.with && `with ${WITHS.find(([v]) => v === mood.with)![1].toLowerCase()}`,
    GOALS.find(([v]) => v === mood.goal)?.[1].toLowerCase(),
    moment.minutes && `in ${moment.minutes < 60 ? `${moment.minutes} minutes` : "an hour"}`,
    moment.people && `for ${moment.people}${moment.kids ? " with kids" : ""}`,
  ].filter(Boolean) as string[];

  return (
    <>
      <Heading title="What are you in the mood for?" sub="Tap whatever matters tonight. Skip the rest." />
      <div className="grid gap-4 rounded-3xl bg-white p-4 ring-1 ring-cocoa/10 sm:p-5 md:grid-cols-2">
        <Row label="Meal">{pick("meal", MEALS)}</Row>
        <Row label="Feeling like">{pick("feel", FEELS)}</Row>
        <Row label="Something with">{pick("with", WITHS)}</Row>
        <Row label="Eating well">{pick("goal", GOALS)}</Row>
      </div>

      <div className="mt-5 rounded-3xl bg-butter px-5 py-4 text-cocoa">
        <p className="text-lg leading-snug">
          {said.length ? <>“{capitalise(said.join(", "))}.” </> : null}
          {shelf.loosened.length
            ? <>Nothing here fits all of that, so these leave out <strong>{shelf.loosened.join(" and ")}</strong>.</>
            : said.length ? "Here's what fits." : "Here are a few to start — tap above to narrow them down."}
        </p>
      </div>
      <Results shelf={shelf} serves={moment.people} />

      <div className="mt-10 rounded-3xl bg-white/70 p-4 ring-1 ring-cocoa/10 sm:p-5">
        <p className="mb-3 font-semibold text-cocoa">Or just say it <span className="text-sm font-normal text-cocoa/55">— a simulated reply, keyword rules not AI</span></p>
        <AskBox />
        {thread.length > 0 && <Conversation />}
      </div>
    </>
  );
}

function capitalise(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Heading({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className={`${display} text-3xl text-cocoa sm:text-4xl`}>{title}</h2>
        <p className="mt-1 text-[15px] text-cocoa/65">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Results({ shelf, serves }: { shelf: Shelf; serves?: number | null }) {
  const { moment } = useIdeas();
  const people = serves ?? moment.people;
  return (
    <>
      {shelf.note && <p className="mt-4 max-w-2xl rounded-2xl bg-butter px-4 py-3 text-sm text-cocoa/80">{shelf.note}</p>}
      {shelf.saved.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-cocoa/55">From your recipe book</h3>
          <ul className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shelf.saved.slice(0, 3).map((s) => <li key={s.recipe.id}><SavedCard s={s} /></li>)}
          </ul>
        </>
      )}
      {shelf.samples.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-cocoa/55">Example ideas <span className="font-normal normal-case tracking-normal text-cocoa/45">— not family recipes</span></h3>
          <ul className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shelf.samples.slice(0, 3).map((s) => <li key={s.idea.id}><SampleCard s={s} serves={people} /></li>)}
          </ul>
        </>
      )}
    </>
  );
}

function RecipeBook({ saved }: { saved: ReturnType<typeof useIdeas>["saved"] }) {
  const { savedError } = useIdeas();
  const shown = [...(saved ?? [])].sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.timesCooked - a.timesCooked).slice(0, 3);
  return (
    <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className={`${display} text-3xl text-cocoa`}>Your recipe book</h2>
          <p className="mt-1 text-cocoa/65">Your own recipes, favourites first. This page only reads them.</p>
        </div>
        <Link to="/" className="shrink-0 text-sm font-semibold text-tomato hover:underline">See all →</Link>
      </div>
      {savedError ? (
        <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{savedError}</p>
      ) : !saved ? (
        <p className="mt-4 text-cocoa/50">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-3xl border border-dashed border-cocoa/20 p-8 text-center text-cocoa/60">
          No recipes here yet. <Link to="/add" className="font-semibold text-tomato underline">Add the first one</Link> and it will show up in ideas.
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-2">
              <SavedCard s={{ recipe: r, reasons: [r.timesCooked ? `Cooked ${r.timesCooked}×${r.lastCookedOn ? ` · last ${r.lastCookedOn}` : ""}` : "Not cooked yet"] }} />
              <Link to={`/ideas/cook/saved/${encodeURIComponent(r.id)}`} className="rounded-full bg-white py-2.5 text-center font-semibold text-tomato ring-1 ring-cocoa/10 hover:bg-butter">
                👩‍🍳 Cook along step by step
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WhatsReal() {
  return (
    <section id="whats-real" className="mx-auto mt-16 max-w-3xl scroll-mt-4 px-4 text-sm text-cocoa/75 sm:px-6">
      <div className="rounded-3xl bg-white/70 p-5 ring-1 ring-cocoa/10 sm:p-6">
        <h2 className={`${display} text-2xl text-cocoa`}>What's real on this page</h2>
        <dl className="mt-3 space-y-3">
          <div><dt className="font-semibold text-leaf">Real</dt><dd>Recipes in your family recipe book, favourites and cooking history (read only). ELK Pantry, read-only, when you're signed in to the family account. Today's date, season and holidays. Weather, if you tap “Check”. What you tap or type. Scaling, cook-along mode and its timers.</dd></div>
          <div><dt className="font-semibold text-saffron">Examples, not family recipes</dt><dd>The “Example ideas” are a dozen ordinary dishes written by hand so there's something to suggest before the recipe book fills up. “Or just say it” replies come from simple keyword rules, not AI. The pretend Pantry only appears when the real one isn't available, and is off unless you switch it on.</dd></div>
          <div><dt className="font-semibold text-tomato">Not known, so not shown</dt><dd>Anything ELK Pantry hasn't been told about, amounts (Pantry counts packages), household tastes, and calories, protein or fibre amounts. Kitchen asks or leaves it blank rather than guess.</dd></div>
        </dl>
        {PHOTO_CREDITS.length > 0 && (
          <details className="mt-3 text-xs text-cocoa/60">
            <summary className="cursor-pointer font-medium text-cocoa/70">Photo credits</summary>
            <p className="mt-1">Photos show similar dishes, not these recipes. From Wikimedia Commons:</p>
            <ul className="mt-1 space-y-0.5">
              {PHOTO_CREDITS.map((c) => (
                <li key={c.id}>{c.depicts}: <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.author}</a>, {c.licenseUrl ? <a className="underline" href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a> : c.license}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-3 text-xs text-cocoa/50">Nothing you tap here is saved, and a reload starts fresh.</p>
      </div>
    </section>
  );
}
