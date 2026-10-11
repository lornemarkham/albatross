import { useState } from "react";
import { Link } from "react-router-dom";
import { addToShoppingList } from "../lib/pantry";
import { checkRecipe, type LineCheck } from "../lib/pantryCheck";
import { supabase } from "../lib/supabase";
import { usePantry } from "../lib/usePantry";
import { INVENTORY_PANTRY_URL } from "../pages/PantryPage";
import { sectionLabel } from "./ui";

// This recipe against ELK Pantry: what Pantry confirms, what it shows none
// of, and what it simply doesn't know (asked, not assumed missing).
export function PantryCheck({ ingredients, title }: { ingredients: string; title: string }) {
  const { pantry, error } = usePantry();
  const [open, setOpen] = useState(false);
  if (!ingredients.trim() || pantry === "off") return null;
  if (error || (pantry && pantry.status === "error")) {
    return <p className="mt-6 text-sm text-bark/60">Couldn't check ELK Pantry right now.</p>;
  }
  if (!pantry) return <p className="mt-6 text-sm text-bark/50">Checking ELK Pantry…</p>;
  if (pantry.status === "not-set-up") return null;

  const c = checkRecipe(ingredients, pantry.items);
  if (c.total === 0) return null;
  return (
    <section className="mt-6 rounded-xl border border-sage/30 bg-white/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={sectionLabel}>ELK Pantry</p>
        <Link to="/pantry" className="text-xs text-sage underline">What's in the pantry?</Link>
      </div>
      <p className="mt-1 font-semibold text-bark">{c.headline}</p>
      {c.prompt && <p className="mt-1 text-bark/80">{c.prompt}</p>}
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-sm text-sage underline" aria-expanded={open}>
        {open ? "Hide details" : "Ingredient by ingredient"}
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-clay/50 text-sm">
          {c.lines.map((l, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
              <span className="text-bark">{l.line}</span>
              <span className={
                l.status.state === "have" ? "text-sage" : l.status.state === "missing" ? "text-red-700" : "text-bark/55"}>
                {l.status.state === "have" && `✓ Pantry: ${l.status.item.onHand} ${l.status.item.unit} ${l.status.item.name}${l.status.item.location ? ` · ${l.status.item.location}` : ""}`}
                {l.status.state === "missing" && `✕ Pantry shows no ${l.status.item.name} left`}
                {l.status.state === "unknown" && (l.status.maybe ? `? Not sure — Pantry has ${l.status.maybe.name}` : "? Pantry doesn't know")}
                {l.status.state === "basic" && "basic"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ShoppingPicker lines={c.lines} title={title} />
      <p className="mt-2 text-xs text-bark/50">Pantry counts packages, not amounts, and only knows what's been entered in ELK Inventory.</p>
    </section>
  );
}

// What this recipe might need buying. Pantry's "none left" are ticked; what
// Pantry doesn't know about is listed unticked — only the person knows.
function ShoppingPicker({ lines, title }: { lines: LineCheck[]; title: string }) {
  const candidates = lines.filter((l) => l.status.state === "missing" || l.status.state === "unknown");
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(candidates.map((l, i) => (l.status.state === "missing" ? i : -1)).filter((i) => i >= 0)));
  const [state, setState] = useState<"idle" | "saving" | { done: string } | { error: string }>("idle");
  if (candidates.length === 0 || !supabase) return null;

  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  async function add() {
    const names = candidates.filter((_, i) => picked.has(i))
      .map((l) => (l.status.state === "missing" ? l.status.item.name : l.name));
    setState("saving");
    const r = await addToShoppingList(supabase!, names, title);
    setState(!r.ok ? { error: r.error }
      : { done: r.added === names.length ? `Added ${r.added} to the shopping list.`
        : r.added === 0 ? "They're on the shopping list already." : `Added ${r.added}; the rest were on the list already.` });
  }

  return (
    <div className="mt-3 border-t border-clay/50 pt-3">
      <p className="text-sm font-semibold text-bark">Need to buy anything?</p>
      <ul className="mt-1 text-sm">
        {candidates.map((l, i) => (
          <li key={i}>
            <label className="flex min-h-11 items-center gap-3 py-1">
              <input type="checkbox" className="h-5 w-5 accent-sage" checked={picked.has(i)} onChange={() => toggle(i)} />
              <span className="text-bark">
                {l.status.state === "missing" ? l.status.item.name : l.name}
                <span className="text-bark/50">{l.status.state === "missing" ? " — Pantry shows none left" : " — Pantry doesn't know"}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={picked.size === 0 || state === "saving"} onClick={add}
          className="min-h-11 rounded-lg bg-sage px-4 font-semibold text-white disabled:opacity-50">
          {state === "saving" ? "Adding…" : `Add ${picked.size || ""} to shopping list`}
        </button>
        {typeof state === "object" && "done" in state && (
          <span className="text-sm text-sage">{state.done} <a href={INVENTORY_PANTRY_URL} className="underline">See the list</a></span>
        )}
        {typeof state === "object" && "error" in state && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </div>
  );
}
