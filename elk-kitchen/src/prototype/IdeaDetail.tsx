import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { foodFacts, nutritionForSample } from "./ideas/nutrition";
import { sampleById } from "./ideas/sampleIdeas";
import { reasonsFor } from "./ideas/suggest";
import { photoFor } from "./photos";
import { DishImage, NutritionPanel, PantryCheck, PrototypeHeader, PrototypeRibbon, Reasons, chipClass, display } from "./components";
import { useIdeas } from "./IdeasSession";

const NEEDS_AI = ["Dairy-free", "Without an oven", "Use up my spinach", "Make it spicier"];

export function IdeaDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const idea = sampleById(id);
  const { pantry, answers, moment } = useIdeas();
  const [serves, setServes] = useState(() => Number(params.get("serves")) || moment.people || idea?.serves || 4);
  const [change, setChange] = useState<string | null>(null);

  if (!idea) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-cocoa/70">That idea isn't in this prototype.</p>
        <Link to="/ideas" className="mt-3 inline-block text-tomato underline">Back to ideas</Link>
      </div>
    );
  }

  const factor = serves / idea.serves;
  const { fit, reasons } = reasonsFor(idea, pantry, answers, moment);
  const variation = idea.variations?.find((v) => v.ask === change);

  return (
    <div className="min-h-screen bg-parchment pb-24 text-cocoa">
      <PrototypeRibbon />
      <PrototypeHeader />
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <Link to="/ideas" className="text-sm font-medium text-tomato hover:underline">← Today's ideas</Link>
      </div>

      <article className="mx-auto mt-4 grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <DishImage idea={idea} big className="aspect-[4/3] rounded-[2rem] shadow-[0_24px_60px_-24px_rgba(61,44,34,0.55)]" />
          <PhotoCaption id={idea.id} />
        </div>

        <div>
          <p className="inline-block rounded-full bg-butter px-3 py-1 text-xs font-semibold text-cocoa/70 ring-1 ring-saffron/30">
            Example idea written for this prototype · not a family recipe
          </p>
          <h1 className={`${display} mt-3 text-4xl leading-tight tracking-tight sm:text-5xl`}>{idea.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-cocoa/75">{idea.blurb}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-white px-3 py-1.5 font-semibold ring-1 ring-cocoa/10">⏱ About {idea.minutes} min</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1 ring-1 ring-cocoa/10">
              Serves
              <button type="button" aria-label="Fewer" onClick={() => setServes((n) => Math.max(1, n - 1))} className="grid h-7 w-7 place-items-center rounded-full bg-cocoa/5 hover:bg-cocoa/10">−</button>
              <strong className="w-6 text-center tabular-nums">{serves}</strong>
              <button type="button" aria-label="More" onClick={() => setServes((n) => Math.min(40, n + 1))} className="grid h-7 w-7 place-items-center rounded-full bg-cocoa/5 hover:bg-cocoa/10">+</button>
            </span>
            {idea.equipment.filter((e) => e !== "none").map((e) => (
              <span key={e} className="rounded-full bg-white px-3 py-1.5 capitalize ring-1 ring-cocoa/10">{e === "bbq" ? "BBQ" : e}</span>
            ))}
          </div>

          <div className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-cocoa/10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa/55">Why this?</h2>
            <div className="mt-2"><Reasons reasons={reasons} max={4} /></div>
          </div>

          <Link
            to={`/ideas/cook/idea/${idea.id}?serves=${serves}`}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-tomato px-6 py-4 text-lg font-semibold text-white shadow-[0_12px_30px_-10px_rgba(200,85,61,0.7)] transition hover:bg-tomato/90"
          >
            👩‍🍳 Start cooking
          </Link>
        </div>

        <section className="lg:col-span-2 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className={`${display} text-2xl`}>Ingredients</h2>
            <p className="mb-3 text-sm text-cocoa/55">{factor === 1 ? `For ${serves}` : `Scaled from ${idea.serves} to ${serves} — plain arithmetic, so check anything that doesn't scale neatly.`}</p>
            <PantryCheck fit={fit} factor={factor} />
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl bg-white p-5 ring-1 ring-cocoa/10">
              <h2 className={`${display} text-xl`}>Change it</h2>
              <p className="mt-1 text-sm text-cocoa/60">Your original is never overwritten — a change would be saved as your family's version, alongside it.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={chipClass(serves !== idea.serves)} onClick={() => setServes(serves === 8 ? idea.serves : 8)}>
                  Serve 8
                </button>
                {idea.variations?.map((v) => (
                  <button key={v.ask} type="button" className={chipClass(change === v.ask)} onClick={() => setChange(change === v.ask ? null : v.ask)}>{v.ask}</button>
                ))}
                {NEEDS_AI.map((a) => (
                  <button key={a} type="button" className={chipClass(change === a)} onClick={() => setChange(change === a ? null : a)}>{a}</button>
                ))}
              </div>
              {variation && (
                <div className="mt-4 rounded-2xl bg-butter p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cocoa/50">Example written by hand — this is how an AI suggestion would be shown</p>
                  <p className="mt-1 font-semibold">“{variation.ask}” would change:</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {variation.changes.map((c) => <li key={c} className="flex gap-2"><span className="text-saffron">↻</span>{c}</li>)}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled className="rounded-full bg-cocoa/10 px-4 py-1.5 text-sm font-semibold text-cocoa/40" title="Prototype — nothing is saved">Keep this version</button>
                    <button type="button" onClick={() => setChange(null)} className="rounded-full px-4 py-1.5 text-sm text-cocoa/60 underline">Not now</button>
                  </div>
                </div>
              )}
              {change && !variation && (
                <p className="mt-4 rounded-2xl bg-cocoa/[0.04] p-4 text-sm text-cocoa/75">
                  “{change}” needs live AI, which this prototype doesn't have. The real version would show the proposed changes here, line by line, labelled as AI suggestions, for you to keep or skip.
                </p>
              )}
            </section>

            <NutritionPanel
              nutrition={nutritionForSample()}
              facts={foodFacts(idea)}
              serves={serves}
              note="No nutrition source has been chosen yet, so Kitchen shows no calorie, protein or fibre numbers. Once one is, each value will say whether it's verified or an estimate."
            />

            <section>
              <h2 className={`${display} text-2xl`}>Method</h2>
              <ol className="mt-3 space-y-3">
                {idea.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`${display} grid h-8 w-8 shrink-0 place-items-center rounded-full bg-saffron/20 text-lg text-cocoa`}>{i + 1}</span>
                    <p className="pt-1 text-[17px] leading-relaxed">{s}</p>
                  </li>
                ))}
              </ol>
            </section>

            <button type="button" disabled className="w-full rounded-full border border-dashed border-cocoa/25 px-6 py-3 text-sm text-cocoa/50" title="Prototype — nothing is saved">
              Save to family recipes · in the real version you'd review it first
            </button>
          </div>
        </section>
      </article>
    </div>
  );
}

function PhotoCaption({ id }: { id: string }) {
  const photo = photoFor(id);
  if (!photo) return <p className="mt-3 text-xs text-cocoa/50">Illustration — no photo of this dish yet.</p>;
  const c = photo.credit;
  return (
    <p className="mt-3 text-xs leading-relaxed text-cocoa/50">
      Photo of a similar dish ({c.depicts}), not this recipe. <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">{c.author}</a>,{" "}
      {c.licenseUrl ? <a href={c.licenseUrl} target="_blank" rel="noreferrer" className="underline">{c.license}</a> : c.license}, via Wikimedia Commons.
    </p>
  );
}
