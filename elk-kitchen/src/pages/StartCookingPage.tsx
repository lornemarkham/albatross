import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { newSession } from "../lib/cooking/session";
import { useDrafts } from "../lib/cooking/useCookingSession";
import { PhotoImg } from "../components/Photos";
import { inputClass } from "../components/ui";
import { matchesSearch } from "./RecipeListPage";
import type { Recipe } from "../types/recipe";
import type { CookDraft, CookingSession } from "../types/cooking";
import { clock } from "../lib/cooking/parse";

export function useStartCooking() {
  const drafts = useDrafts();
  const { myName } = useKitchen();
  const navigate = useNavigate();
  return (recipe: Recipe | null, title = "", draft: CookDraft | null = null) => {
    const s = newSession({ recipe, title, cookName: myName, now: new Date().toISOString(), draft });
    drafts.put(s);
    navigate(`/cook/${encodeURIComponent(s.id)}`);
  };
}

export function StartCookingButton({ recipe, className = "" }: { recipe: Recipe; className?: string }) {
  const start = useStartCooking();
  return (
    <button type="button" onClick={() => start(recipe)}
      className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-tomato px-6 text-xl font-bold text-white shadow-md transition hover:bg-tomato/90 ${className}`}>
      <span aria-hidden className="text-2xl">🎤</span> Start cooking
    </button>
  );
}

// Unsaved cooks on this device: always offered first, so nothing is lost.
export function ContinueCooking({ sessions }: { sessions: CookingSession[] }) {
  if (!sessions.length) return null;
  return (
    <section aria-label="Cooking now" className="space-y-2">
      {sessions.map((s) => (
        <Link key={s.id} to={s.endedAt ? `/cook/${encodeURIComponent(s.id)}/review` : `/cook/${encodeURIComponent(s.id)}`}
          className="flex items-center gap-3 rounded-2xl border-2 border-saffron bg-butter p-4 text-cocoa shadow-sm">
          <span aria-hidden className="text-3xl">{s.endedAt ? "📝" : "🔥"}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-wide text-tomato">{s.endedAt ? "Not saved yet — review and save" : "Still cooking"}</span>
            <span className="block truncate font-display text-lg font-semibold">{s.recipeTitle}</span>
            <span className="block text-xs text-cocoa/60">Started {new Date(s.startedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {s.transcript.length} notes{s.endedAt ? ` · ${clock((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)}` : ""}</span>
          </span>
          <span aria-hidden className="text-xl">›</span>
        </Link>
      ))}
    </section>
  );
}

export function StartCookingPage() {
  const { store } = useKitchen();
  const drafts = useDrafts();
  const start = useStartCooking();
  const { data: recipes, error } = useLoad(() => store.listRecipes(), [store]);
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const unsaved = drafts.unsaved();
  const shown = (recipes ?? []).filter((r) => matchesSearch(r, q));

  function newCook(e: FormEvent) {
    e.preventDefault();
    start(null, title.trim() || "New cook");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">Start cooking</h1>
      <p className="mt-1 text-bark/70">Pick what you're making. Then talk, tap or type as you go — Kitchen keeps the notes.</p>

      <div className="mt-4"><ContinueCooking sessions={unsaved} /></div>

      <form onSubmit={newCook} className="mt-5 rounded-2xl border border-clay bg-cream p-4">
        <label htmlFor="newcook" className="font-semibold text-bark">Something new (no recipe yet)</label>
        <div className="mt-2 flex gap-2">
          <input id="newcook" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Saturday jerky experiment" className={`${inputClass} mt-0`} />
          <button type="submit" className="shrink-0 rounded-xl bg-sage px-4 font-semibold text-white">Start</button>
        </div>
        <p className="mt-1 text-xs text-bark/60">When you finish, you can save it as a new recipe.</p>
      </form>

      <h2 className="mt-6 text-lg font-bold text-bark">Or cook a recipe</h2>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes…" aria-label="Search recipes" className={`${inputClass} mb-3`} />
      {error ? <p className="text-red-700">{error}</p> : !recipes ? <p className="text-bark/60">Loading…</p> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => start(r)} className="block w-full overflow-hidden rounded-2xl border border-clay bg-cream text-left shadow-sm transition hover:shadow-md">
                {r.photos[0] ? <PhotoImg id={r.photos[0].id} className="h-28 w-full" /> : <div aria-hidden className="flex h-28 items-center justify-center bg-butter text-4xl">{r.kind === "sausage" ? "🌭" : r.kind === "jerky" ? "🥩" : "🍲"}</div>}
                <span className="block p-3">
                  <span className="block font-semibold leading-tight text-bark">{r.title}</span>
                  <span className="mt-0.5 block text-xs text-bark/60">{r.timesCooked ? `Cooked ${r.timesCooked}×` : "Not cooked yet"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
