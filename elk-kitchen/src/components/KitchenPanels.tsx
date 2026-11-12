import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { KitchenSnapshot } from "../lib/home/snapshot";

// The kitchen screen's building blocks, and its offline board.

// No internet: the last good read, labelled with its time. Read-only.
export function OfflineBoard({ snap }: { snap: KitchenSnapshot }) {
  const [open, setOpen] = useState<string | null>(null);
  const at = new Date(snap.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title={`Recipes · saved ${at}`}>
        <ul className="space-y-1">
          {snap.recipes.slice(0, 60).map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="min-h-12 w-full rounded-xl px-2 text-left text-lg font-semibold text-bark hover:bg-clay/30" aria-expanded={open === r.id}>{r.title}</button>
              {open === r.id && (
                <div className="mb-3 rounded-2xl bg-white/70 p-4 text-lg">
                  <p className="text-sm font-bold uppercase text-sage">Ingredients</p>
                  <p className="whitespace-pre-wrap text-bark">{r.ingredients || "—"}</p>
                  <p className="mt-3 text-sm font-bold uppercase text-sage">Method</p>
                  <p className="whitespace-pre-wrap text-bark">{r.instructions || "—"}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={`Pantry · as of ${at}`}>
        {!snap.pantry ? <Muted>No pantry copy on this screen.</Muted> : <ChipList items={snap.pantry.filter((p) => p.onHand > 0).map((p) => ({ key: p.name, text: `${p.name} · ${p.onHand} ${p.unit}` }))} />}
      </Panel>
      <Panel title={`Shopping · as of ${at}`}>
        {!snap.shopping ? <Muted>No list copy on this screen.</Muted> : snap.shopping.length === 0 ? <Muted>The list was empty.</Muted> : (
          <ul className="space-y-1 text-xl text-bark">{snap.shopping.map((n) => <li key={n}>• {n}</li>)}</ul>
        )}
      </Panel>
    </div>
  );
}

export function Panel({ title, more, children }: { title: string; more?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-clay bg-cream p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold text-bark">{title}</h2>
        {more && <Link to={more.to} className="flex min-h-11 items-center text-base font-semibold text-sage underline">{more.label}</Link>}
      </div>
      {children}
    </section>
  );
}

export const Sub = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-4"><h3 className="mb-1.5 text-sm font-bold uppercase tracking-wide text-sage">{title}</h3>{children}</div>
);
export const Muted = ({ children }: { children: ReactNode }) => <p className="text-base text-bark/60">{children}</p>;
export const ChipList = ({ items }: { items: { key: string; text: string; warn?: boolean }[] }) => (
  <ul className="flex flex-wrap gap-2">
    {items.map((i) => <li key={i.key} className={`rounded-full px-3 py-1.5 text-base ${i.warn ? "bg-tomato/15 text-bark" : "bg-white text-bark ring-1 ring-clay"}`}>{i.text}</li>)}
  </ul>
);
