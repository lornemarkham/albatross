import { useState } from "react";
import { Link } from "react-router-dom";
import { inputClass } from "../components/ui";
import { usePantry } from "../lib/usePantry";

export const INVENTORY_PANTRY_URL = "https://elk-inventory.vercel.app/pantry";

// "What's in the pantry?" — ELK Inventory's Pantry, read-only. Changing stock
// happens in Inventory, so there's one pantry, not two.
export function PantryPage() {
  const { pantry, error } = usePantry();
  const [q, setQ] = useState("");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Recipes</Link>
      <h1 className="mt-4 text-2xl font-bold text-bark">What's in the pantry?</h1>
      <p className="mt-1 text-sm text-bark/70">
        From ELK Pantry, as the family last entered it. It only knows what's been added there — if something isn't listed,
        that doesn't mean you're out. Counts are packages, not amounts.{" "}
        <a href={INVENTORY_PANTRY_URL} className="font-semibold text-sage underline">Update it in ELK Inventory</a>
      </p>

      {error ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn't load ELK Pantry: {error}</p>
      ) : pantry === undefined ? (
        <p className="mt-6 text-bark/60">Loading…</p>
      ) : pantry === "off" ? (
        <p className="mt-6 rounded-xl border border-clay bg-cream p-4 text-sm text-bark/80">ELK Pantry is for people signed in and on the family list.</p>
      ) : pantry.status === "not-set-up" ? (
        <p className="mt-6 rounded-xl border border-clay bg-cream p-4 text-sm text-bark/80">ELK Pantry isn't set up in the family account yet.</p>
      ) : pantry.status === "error" ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn't load ELK Pantry: {pantry.error}</p>
      ) : pantry.items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-clay p-6 text-center text-bark/70">
          ELK Pantry is empty. <a href={INVENTORY_PANTRY_URL} className="font-semibold text-sage underline">Add food in ELK Inventory</a>.
        </p>
      ) : (
        <>
          <input type="search" placeholder="Search the pantry" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputClass} mt-6`} aria-label="Search the pantry" />
          <ul className="mt-4 divide-y divide-clay/60 rounded-2xl border border-clay bg-cream">
            {pantry.items
              .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
              .sort((a, b) => Number(b.onHand > 0) - Number(a.onHand > 0) || a.name.localeCompare(b.name))
              .map((p) => (
                <li key={p.name} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
                  <span className={p.onHand > 0 ? "font-medium text-bark" : "text-bark/50"}>{p.name}</span>
                  <span className="text-sm text-bark/70">
                    {p.onHand > 0 ? `${p.onHand} ${p.unit}` : "none left"}
                    {p.location && ` · ${p.location}`}
                    {p.bestBefore && p.onHand > 0 && ` · best before ${p.bestBefore}`}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
