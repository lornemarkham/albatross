import { useEffect, useRef, useState } from "react";
import { CONVERSATION_EXAMPLES, groundingFor } from "./ideas/conversation";
import { sampleById } from "./ideas/sampleIdeas";
import { reasonsFor } from "./ideas/suggest";
import { SampleCard, SavedCard, chipClass, display } from "./components";
import { useIdeas } from "./IdeasSession";

// The question box in the hero, and the thread below it. Replies come from
// keyword rules (ideas/conversation.ts), and every reply says so.
export function AskBox() {
  const { ask } = useIdeas();
  const [draft, setDraft] = useState("");

  function send(text: string) {
    ask(text);
    setDraft("");
    requestAnimationFrame(() => document.getElementById("conversation")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="flex items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-[0_10px_40px_-12px_rgba(61,44,34,0.35)] ring-1 ring-cocoa/10 focus-within:ring-2 focus-within:ring-saffron"
      >
        <label htmlFor="ask" className="sr-only">Ask Kitchen</label>
        <input
          id="ask"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. “something warm, we have 30 minutes”"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-cocoa placeholder:text-cocoa/40 focus:outline-none"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()} className="shrink-0 rounded-full bg-tomato px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-tomato/90 disabled:opacity-40">
          Ask
        </button>
      </form>
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {CONVERSATION_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => send(ex)} className={chipClass(false)}>{ex}</button>
        ))}
      </div>
    </div>
  );
}

export function Conversation() {
  const { thread, ask, clearThread, saved, pantry, answers, moment } = useIdeas();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [thread.length]);
  if (!thread.length) return null;

  return (
    <section id="conversation" className="mt-5 scroll-mt-4">
      <div className="rounded-[2rem] bg-white/70 p-4 ring-1 ring-cocoa/10 backdrop-blur sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className={`${display} text-2xl text-cocoa`}>Talking it through</h2>
          <button type="button" onClick={clearThread} className="text-sm text-cocoa/50 underline hover:text-cocoa">Start over</button>
        </div>
        <ol className="space-y-6">
          {thread.map(({ ask: question, reply }, i) => (
            <li key={i} className="space-y-3">
              <p className="ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-md bg-cocoa px-4 py-2.5 text-butter">{question}</p>
              <div className="max-w-3xl space-y-3">
                <div className="w-fit max-w-full rounded-3xl rounded-bl-md bg-butter px-4 py-3 text-cocoa">
                  <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-cocoa/50">
                    <span className="rounded bg-cocoa/10 px-1.5 py-0.5 text-cocoa/70">Simulated · keyword rules, not AI</span>
                    {reply.heard.length > 0 && <span>Heard: {reply.heard.join(" · ")}</span>}
                  </p>
                  <p className="leading-relaxed">{reply.text}</p>
                  {Object.keys(reply.answers).length > 0 && (
                    <p className="mt-1.5 text-xs text-leaf">✓ Noted for this visit: you have {[...new Set(Object.values(reply.answers).map((a) => (typeof a === "object" ? a.said : "")))].filter(Boolean).join(" and ")}</p>
                  )}
                </div>
              </div>
              {(reply.sampleIds.length > 0 || reply.savedIds.length > 0) && (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(saved ?? []).filter((r) => reply.savedIds.includes(r.id)).map((r) => (
                    <li key={r.id}><SavedCard s={{ recipe: r, reasons: [reply.why[r.id] ?? "From your recipe book"] }} /></li>
                  ))}
                  {reply.sampleIds.map((id) => {
                    const idea = sampleById(id)!;
                    const { fit, reasons } = reasonsFor(idea, pantry, answers, moment);
                    const all = reply.why[id] ? [reply.why[id], ...reasons] : reasons;
                    return <li key={id}><SampleCard s={{ idea, fit, reasons: all, score: 0 }} serves={reply.serves} /></li>;
                  })}
                </ul>
              )}
              {i === thread.length - 1 && reply.chips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reply.chips.map((c) => <button key={c} type="button" onClick={() => ask(c)} className={chipClass(false)}>{c}</button>)}
                </div>
              )}
            </li>
          ))}
        </ol>
        <details className="mt-6 rounded-2xl bg-cocoa/[0.04] p-4 text-sm text-cocoa/75">
          <summary className="cursor-pointer font-medium text-cocoa">What a real Kitchen would know when answering</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {groundingFor(moment, pantry, saved ?? [], answers).map((g) => <li key={g}>{g}</li>)}
          </ul>
          <p className="mt-2 text-xs text-cocoa/55">A live version would send this — and nothing more personal — to a model on a family-only server endpoint, and ask for short replies that point at recipes.</p>
        </details>
        <div ref={end} />
      </div>
    </section>
  );
}
