import { useState } from "react";
import { Link } from "react-router-dom";
import { checkRecipe } from "../lib/pantryCheck";
import { usePantry } from "../lib/usePantry";
import { sectionLabel } from "./ui";

// This recipe against ELK Pantry: what Pantry confirms, what it shows none
// of, and what it simply doesn't know (asked, not assumed missing).
export function PantryCheck({ ingredients }: { ingredients: string }) {
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
      <p className="mt-2 text-xs text-bark/50">Pantry counts packages, not amounts, and only knows what's been entered in ELK Inventory.</p>
    </section>
  );
}
