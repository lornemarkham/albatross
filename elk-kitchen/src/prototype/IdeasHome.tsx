import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { greeting, seasonOf, upcomingHolidays, whenLabel, WEATHER_LABEL } from "./ideas/context";
import { SAMPLE_IDEAS } from "./ideas/sampleIdeas";
import { INVITATIONS, shelfFor, type HealthyAngle, type IdeaKey } from "./ideas/suggest";
import type { Equipment, Weather } from "./ideas/types";
import { AskBox, Conversation } from "./AskKitchen";
import { FoodArt, PrototypeHeader, PrototypeRibbon, SampleCard, SavedCard, chipClass, display } from "./components";
import { useIdeas } from "./IdeasSession";

const SEASON_LABEL = { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" };

export function IdeasHome() {
  const { moment, saved } = useIdeas();
  const [open, setOpen] = useState<IdeaKey | null>(null);
  const [angle, setAngle] = useState<HealthyAngle>("veg");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6) + 1);

  const date = new Date(`${moment.today}T12:00:00`).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
  const holiday = upcomingHolidays(moment.today)[0];

  function choose(key: IdeaKey) {
    if (key === "surprise") setSeed((s) => s + 7919);
    setOpen(key);
    requestAnimationFrame(() => document.getElementById("shelf")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#fff4dc_0%,#faf7f2_55%)] pb-20 text-cocoa">
      <PrototypeRibbon />
      <PrototypeHeader />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 sm:pt-14">
        <p className="text-sm font-medium text-tomato">
          {greeting()} · {date} · {SEASON_LABEL[seasonOf(moment.today)]}
        </p>
        <h1 className={`${display} mt-3 max-w-3xl text-[2.6rem] leading-[1.05] tracking-tight text-cocoa sm:text-6xl`}>
          What should we cook today?
        </h1>
        {holiday && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-sm text-cocoa ring-1 ring-saffron/40">
            <span aria-hidden>🍂</span>{holiday.name} is {whenLabel(holiday.inDays, holiday.date)}
          </p>
        )}
        <div className="mt-7 max-w-3xl">
          <AskBox />
        </div>
      </section>

      <Conversation />

      {/* Invitations */}
      <section className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
        <h2 className={`${display} text-3xl text-cocoa`}>Today's ideas</h2>
        <p className="mt-1 text-cocoa/65">Tap one and Kitchen will pick a few — and say why.</p>
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {INVITATIONS.map((inv) => (
            <li key={inv.key}>
              <button
                type="button"
                onClick={() => choose(inv.key)}
                aria-pressed={open === inv.key}
                className={`group relative flex h-full w-full flex-col overflow-hidden rounded-3xl text-left shadow-[0_12px_30px_-14px_rgba(61,44,34,0.45)] transition hover:-translate-y-0.5 ${
                  open === inv.key ? "ring-4 ring-cocoa" : "ring-1 ring-cocoa/5"}`}
              >
                <FoodArt emoji={inv.emoji} palette={inv.palette} className="aspect-[5/3] sm:aspect-[4/3]" />
                <span className="flex flex-1 flex-col bg-white px-3.5 py-3">
                  <span className={`${display} text-lg leading-tight text-cocoa sm:text-xl`}>{inv.title}</span>
                  <span className="mt-0.5 text-xs text-cocoa/60 sm:text-sm">{inv.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <AboutTonight />

      {open && <Shelf ideaKey={open} angle={angle} setAngle={setAngle} seed={seed} reroll={() => setSeed((s) => s + 7919)} />}

      <RecipeBook saved={saved} />

      <WhatsReal />
    </div>
  );
}

function AboutTonight() {
  const { moment, setMoment, pantryMode, setPantryMode } = useIdeas();
  const toggleEquip = (e: Equipment) =>
    setMoment({ equipment: moment.equipment.includes(e) ? moment.equipment.filter((x) => x !== e) : [...moment.equipment, e] });

  return (
    <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
      <div className="rounded-3xl bg-white/70 p-4 ring-1 ring-cocoa/10 sm:p-5">
        <p className="text-sm font-semibold text-cocoa">A little about tonight <span className="font-normal text-cocoa/50">— optional, and only for this visit</span></p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Row label="Weather" hint="No weather feed — tap if it matters">
            {(Object.keys(WEATHER_LABEL) as Weather[]).map((w) => (
              <button key={w} type="button" className={chipClass(moment.weather === w)} aria-pressed={moment.weather === w}
                onClick={() => setMoment({ weather: moment.weather === w ? null : w })}>{WEATHER_LABEL[w]}</button>
            ))}
          </Row>
          <Row label="Time">
            {[20, 30, 60, 180].map((m) => (
              <button key={m} type="button" className={chipClass(moment.minutes === m)} aria-pressed={moment.minutes === m}
                onClick={() => setMoment({ minutes: moment.minutes === m ? null : m })}>
                {m < 60 ? `${m} min` : m === 60 ? "An hour" : "All afternoon"}
              </button>
            ))}
          </Row>
          <Row label="Cooking with">
            {([["stovetop", "Stovetop"], ["oven", "Oven"], ["bbq", "BBQ"]] as [Equipment, string][]).map(([e, l]) => (
              <button key={e} type="button" className={chipClass(moment.equipment.includes(e))} aria-pressed={moment.equipment.includes(e)} onClick={() => toggleEquip(e)}>{l}</button>
            ))}
          </Row>
          <Row label="Pantry" hint={pantryMode === "sample" ? "Pretend data — not your real Pantry" : "See how Kitchen copes with nothing"}>
            <button type="button" className={chipClass(pantryMode === "sample")} aria-pressed={pantryMode === "sample"} onClick={() => setPantryMode("sample")}>Sample pantry</button>
            <button type="button" className={chipClass(pantryMode === "none")} aria-pressed={pantryMode === "none"} onClick={() => setPantryMode("none")}>Not connected</button>
          </Row>
        </div>
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-cocoa/50">{label}</p>
      <div className="no-scrollbar mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-cocoa/45">{hint}</p>}
    </div>
  );
}

function Shelf({ ideaKey, angle, setAngle, seed, reroll }: { ideaKey: IdeaKey; angle: HealthyAngle; setAngle: (a: HealthyAngle) => void; seed: number; reroll: () => void }) {
  const { saved, pantry, answers, moment } = useIdeas();
  const inv = INVITATIONS.find((i) => i.key === ideaKey)!;
  const shelf = useMemo(
    () => shelfFor(ideaKey, { samples: SAMPLE_IDEAS, saved: saved ?? [], pantry, answers, moment, angle, seed }),
    [ideaKey, saved, pantry, answers, moment, angle, seed],
  );

  return (
    <section id="shelf" className="mx-auto mt-10 max-w-6xl scroll-mt-4 px-4 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className={`${display} text-3xl text-cocoa`}><span aria-hidden>{inv.emoji} </span>{inv.title}</h2>
        {ideaKey === "surprise" && <button type="button" onClick={reroll} className={chipClass(false)}>🎲 Another!</button>}
      </div>

      {ideaKey === "healthy" && (
        <div className="mt-3">
          <p className="text-sm text-cocoa/70">Healthy means different things on different days. What matters tonight?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([["veg", "More vegetables"], ["protein", "More protein"], ["beans", "Beans & lentils"]] as [HealthyAngle, string][]).map(([a, l]) => (
              <button key={a} type="button" className={chipClass(angle === a)} aria-pressed={angle === a} onClick={() => setAngle(a)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {shelf.note && <p className="mt-4 max-w-2xl rounded-2xl bg-butter px-4 py-3 text-sm text-cocoa/80">{shelf.note}</p>}

      {shelf.saved.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-cocoa/55">From your recipe book</h3>
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shelf.saved.map((s) => <li key={s.recipe.id}><SavedCard s={s} /></li>)}
          </ul>
        </>
      )}
      {shelf.samples.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-cocoa/55">New ideas</h3>
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shelf.samples.map((s) => <li key={s.idea.id}><SampleCard s={s} /></li>)}
          </ul>
        </>
      )}
    </section>
  );
}

function RecipeBook({ saved }: { saved: ReturnType<typeof useIdeas>["saved"] }) {
  const { savedError } = useIdeas();
  const shown = [...(saved ?? [])].sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.timesCooked - a.timesCooked).slice(0, 4);
  return (
    <section className="mx-auto mt-14 max-w-6xl px-4 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className={`${display} text-3xl text-cocoa`}>Your recipe book</h2>
          <p className="mt-1 text-cocoa/65">The family's own recipes — real, and unchanged by this prototype.</p>
        </div>
        <Link to="/" className="shrink-0 text-sm font-semibold text-tomato hover:underline">See all →</Link>
      </div>
      {savedError ? (
        <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{savedError}</p>
      ) : !saved ? (
        <p className="mt-4 text-cocoa/50">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-3xl border border-dashed border-cocoa/20 p-8 text-center text-cocoa/60">
          No family recipes here yet. <Link to="/add" className="font-semibold text-tomato underline">Add the first one</Link> and it will show up in ideas.
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-2">
              <SavedCard s={{ recipe: r, reasons: [r.timesCooked ? `Cooked ${r.timesCooked}×` : "Not cooked yet"] }} />
              <Link to={`/ideas/cook/saved/${encodeURIComponent(r.id)}`} className="text-center text-sm font-semibold text-tomato hover:underline">
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
          <div><dt className="font-semibold text-leaf">Real</dt><dd>Your family recipes, favourites and cooking history (read only). Today's date, season and holidays. Scaling a recipe. Cook-along mode and its timers.</dd></div>
          <div><dt className="font-semibold text-saffron">Simulated</dt><dd>Chat replies — simple keyword rules, not AI. The “New ideas” are a dozen samples written for this prototype. The Pantry is a pretend snapshot.</dd></div>
          <div><dt className="font-semibold text-tomato">Not known — so not shown</dt><dd>Live weather, your real Pantry, household tastes, and nutrition for the sample ideas. Kitchen asks or leaves it blank rather than guess.</dd></div>
        </dl>
        <p className="mt-3 text-xs text-cocoa/50">Nothing you tap here is saved. More: docs/prototypes/WHAT-SHOULD-WE-COOK.md</p>
      </div>
    </section>
  );
}
