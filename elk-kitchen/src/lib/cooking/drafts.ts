// Cooking sessions in progress, kept on this device so a reload, a locked
// phone or a dead battery doesn't lose anything. Saved after every change.
// A finished session moves into its batch record; the draft is kept until
// then (and for a while after, as a safety copy — see prune).
//
// Uses its own localStorage key. Never touches the recipe keys.
import type { CookingSession } from "../../types/cooking";

export const DRAFTS_KEY = "elk-kitchen-cooking-v1";
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeSession(raw: unknown): CookingSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<CookingSession>;
  if (s.format !== 1 || typeof s.id !== "string" || !Array.isArray(s.transcript) || !Array.isArray(s.events)) return null;
  return {
    ...(s as CookingSession),
    ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
    timers: Array.isArray(s.timers) ? s.timers : [],
    pending: Array.isArray(s.pending) ? s.pending : [],
    awaitingNote: s.awaitingNote ?? null,
    savedEntryId: s.savedEntryId ?? null,
    lastIngredientId: s.lastIngredientId ?? null,
    lastReply: s.lastReply ?? "",
    stepIndex: typeof s.stepIndex === "number" ? s.stepIndex : -1,
  };
}

export class SessionDrafts {
  private storage: KeyValueStorage;
  constructor(storage: KeyValueStorage) { this.storage = storage; }

  private read(): CookingSession[] {
    const raw = this.storage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map(normalizeSession).filter((x): x is CookingSession => !!x) : [];
    } catch {
      return [];
    }
  }

  private write(list: CookingSession[]) {
    const previous = this.storage.getItem(DRAFTS_KEY);
    // Never overwrite something we couldn't read: set it aside first.
    if (previous) {
      try { JSON.parse(previous); } catch { this.storage.setItem(`${DRAFTS_KEY}-unreadable-${Date.now()}`, previous); }
    }
    this.storage.setItem(DRAFTS_KEY, JSON.stringify(list));
  }

  list(): CookingSession[] {
    return this.read().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  // Sessions not yet saved as a batch, newest first.
  unsaved(): CookingSession[] { return this.list().filter((s) => !s.savedEntryId); }
  get(id: string): CookingSession | null { return this.read().find((s) => s.id === id) ?? null; }

  put(s: CookingSession) {
    const list = this.read().filter((x) => x.id !== s.id);
    this.write([s, ...list]);
  }

  // Only drops sessions that are safely saved as a batch, and only once
  // there are more than `keep` of them.
  prune(keep = 10) {
    const list = this.list();
    const saved = list.filter((s) => s.savedEntryId);
    if (saved.length <= keep) return;
    const drop = new Set(saved.slice(keep).map((s) => s.id));
    this.write(list.filter((s) => !drop.has(s.id)));
  }

  // "Throw away" an unsaved cook: kept aside, never silently deleted.
  discard(id: string) {
    const s = this.get(id);
    if (!s) return;
    this.storage.setItem(`${DRAFTS_KEY}-discarded-${id}`, JSON.stringify(s));
    this.write(this.read().filter((x) => x.id !== id));
  }
}
