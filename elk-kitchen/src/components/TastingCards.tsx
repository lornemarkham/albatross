import { Link } from "react-router-dom";
import { madeOf } from "../lib/sausage/finish";
import { sausageState, familyView, type Tasting } from "../lib/sausage/tasting";
import type { SausagePlan } from "../types/sausage";

// "Potato Sausage — Rate it": one big, simple card per sausage that was made.
export function TastingCards({ plan, tastings, onDark = false }: { plan: SausagePlan; tastings: Tasting[]; onDark?: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {madeOf(plan).map((m) => {
        const st = sausageState(m, plan.id, tastings);
        const fam = familyView(tastings.filter((t) => t.planId === plan.id && t.recipeId === m.recipeId));
        const cta = st === "awaiting" ? "Rate it" : st === "partial" ? "Finish rating" : "Change rating";
        return (
          <li key={m.recipeId}>
            <Link to={`/taste/${encodeURIComponent(plan.id)}/${encodeURIComponent(m.recipeId)}`}
              className={`block min-h-28 rounded-2xl p-4 shadow-sm ${onDark ? "bg-white text-bark" : "border border-clay bg-white text-bark"}`}>
              <p className="font-display text-xl font-bold leading-tight">{m.title}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-sage">
                {st === "awaiting" ? "Made — awaiting tasting" : st === "partial" ? "Rating started" : `Rated${fam.average.overall != null ? ` · ${fam.average.overall}/10` : ""}`}
              </p>
              <span className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-tomato text-lg font-bold text-white">{m.title} — {cta}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
