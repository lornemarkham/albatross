import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKitchen } from "../../context/KitchenContext";
import type { Recipe } from "../../types/recipe";
import type { CookingSession } from "../../types/cooking";
import { SessionDrafts } from "./drafts";
import { activeTimers, draftRecipe, endTimer } from "./session";
import { ring } from "./device";

export const useDrafts = () => useMemo(() => new SessionDrafts(window.localStorage), []);

// One cooking session, saved to this device after every change.
export function useCookingSession(id: string) {
  const { store } = useKitchen();
  const drafts = useDrafts();
  const [session, setSession] = useState<CookingSession | null | undefined>(() => drafts.get(id) ?? null);
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => { setSession(drafts.get(id) ?? null); }, [id, drafts]);

  const recipeId = session?.recipeId ?? null;
  const hasDraft = !!session?.draft;
  useEffect(() => {
    if (!recipeId) { setRecipe(session ? draftRecipe(session) : null); return; }
    let cancelled = false;
    store.getRecipe(recipeId).then((d) => { if (!cancelled) setRecipe(d?.recipe ?? null); },
      (e: unknown) => { if (!cancelled) { setRecipe(null); setRecipeError(e instanceof Error ? e.message : String(e)); } });
    return () => { cancelled = true; };
  }, [recipeId, store, hasDraft]);

  const update = useCallback((f: (s: CookingSession) => CookingSession) => {
    const cur = latest.current;
    if (!cur) return;
    const next = f(cur);
    if (next === cur) return;
    latest.current = next;
    drafts.put(next);
    setSession(next);
  }, [drafts]);

  // Timers: tick, and ring once when one ends.
  const [now, setNow] = useState(() => Date.now());
  const running = session ? activeTimers(session).length : 0;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  const [rang, setRang] = useState<string[]>([]);
  useEffect(() => {
    const s = latest.current;
    if (!s) return;
    const due = activeTimers(s).filter((t) => Date.parse(t.endsAt) <= now);
    if (!due.length) return;
    ring();
    const at = new Date().toISOString();
    update((x) => due.reduce((acc, t) => endTimer(acc, t.id, "done", at), x));
    setRang((r) => [...r, ...due.map((t) => t.id)]);
  }, [now, update]);

  return { session, recipe, recipeError, update, now, rang, dismissRang: (id: string) => setRang((r) => r.filter((x) => x !== id)) };
}
