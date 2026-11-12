import { Link } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { familyRecord } from "../lib/home/kitchenToday";
import type { CookingEntry, Recipe } from "../types/recipe";
import { sectionLabel } from "./ui";

// What the family thinks of this recipe: the average of everyone's latest
// rating, each person's own, how often it's been made and when last. Only
// what people recorded; a recipe nobody rated says so.
export function FamilyRatings({ recipe, entries, favourite }: { recipe: Recipe; entries: CookingEntry[]; favourite: boolean }) {
  const { store } = useKitchen();
  const fb = useLoad(() => store.listFeedback(), [store]);
  const items = fb.data?.status === "ready" ? fb.data.items : [];
  const r = familyRecord(recipe, entries, items, favourite);
  const latest = entries[0];
  return (
    <section className="mt-5 rounded-xl border border-saffron/40 bg-butter/60 p-4" aria-label="Family ratings">
      <p className={sectionLabel}>The family's verdict</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-bold text-bark">{r.stars != null ? <><span className="text-saffron">★</span> {r.stars} <span className="text-base font-normal text-bark/70">from {r.people.length} {r.people.length === 1 ? "person" : "people"}</span></> : <span className="text-lg font-normal text-bark/70">Not rated yet</span>}</p>
        <p className="text-base text-bark/80">Cooked {r.timesCooked === 0 ? "never" : r.timesCooked === 1 ? "once" : `${r.timesCooked} times`}{r.lastCookedOn && ` · last ${r.lastCookedOn}`}</p>
        {r.favourite && <p className="text-base text-sage">♥ Your favourite</p>}
      </div>
      {r.people.length > 0 && (
        <ul className="mt-2 space-y-1">
          {r.people.map((p) => (
            <li key={p.name} className="text-base text-bark">
              <strong>{p.name}</strong> <span className="text-saffron">{"★".repeat(Math.round(p.stars))}</span> {p.stars}
              {p.again === "yes" && <span className="text-sage"> · wants it again</span>}
              {p.again === "no" && <span className="text-tomato"> · not again</span>}
              {p.comment && <span className="text-bark/70"> — “{p.comment.length > 120 ? `${p.comment.slice(0, 120)}…` : p.comment}”</span>}
            </li>
          ))}
        </ul>
      )}
      {latest && (
        <Link to={`/recipe/${encodeURIComponent(recipe.id)}/batch/${encodeURIComponent(latest.id)}`} className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-saffron px-4 font-semibold text-cocoa">
          ★ Rate the last time it was made{latest.cookedOn ? ` (${latest.cookedOn})` : ""}
        </Link>
      )}
    </section>
  );
}
