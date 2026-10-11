import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import type { RecipeSummary } from "../types/recipe";
import { localToday } from "./ideas/context";
import { simulateReply, type Reply } from "./ideas/conversation";
import { SAMPLE_IDEAS } from "./ideas/sampleIdeas";
import { samplePantry } from "./ideas/samplePantry";
import type { Answers, Moment, PantryItem } from "./ideas/types";

// What the person has told Kitchen during this visit. Held in memory only:
// nothing here is saved, and a reload starts fresh.
type Session = {
  moment: Moment;
  setMoment: (patch: Partial<Moment>) => void;
  answers: Answers;
  answer: (key: string, value: "yes" | "no" | null) => void;
  pantryMode: "sample" | "none";
  setPantryMode: (m: "sample" | "none") => void;
  pantry: PantryItem[];
  thread: { ask: string; reply: Reply }[];
  // Ask the (simulated) Kitchen something; the reply joins the thread.
  ask: (text: string) => void;
  clearThread: () => void;
  saved: RecipeSummary[] | undefined;
  savedError: string | null;
};

const Ctx = createContext<Session | null>(null);

export function useIdeas(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useIdeas outside IdeasSession");
  return s;
}

export function IdeasSession({ children }: { children: ReactNode }) {
  const { store } = useKitchen();
  // Read-only: the prototype lists the family's real recipes and never writes.
  const { data: saved, error: savedError } = useLoad(() => store.listRecipes(), [store]);
  const [moment, setMomentState] = useState<Moment>(() => ({ today: localToday(), weather: null, minutes: null, equipment: [], people: null }));
  const [answers, setAnswers] = useState<Answers>({});
  const [pantryMode, setPantryMode] = useState<"sample" | "none">("sample");
  const [thread, setThread] = useState<{ ask: string; reply: Reply }[]>([]);
  const pantry = useMemo(() => (pantryMode === "sample" ? samplePantry(moment.today) : []), [pantryMode, moment.today]);

  const value: Session = {
    moment,
    setMoment: (patch) => setMomentState((m) => ({ ...m, ...patch })),
    answers,
    answer: (key, v) => setAnswers((a) => {
      const next = { ...a };
      if (v === null) delete next[key]; else next[key] = v;
      return next;
    }),
    pantryMode, setPantryMode, pantry,
    thread,
    ask: (text) => {
      const q = text.trim();
      if (!q) return;
      const previous = thread.length ? thread[thread.length - 1].ask : "";
      const reply = simulateReply(q, SAMPLE_IDEAS, saved ?? [], moment.today, previous);
      // What the person said becomes part of the moment: "It's hot" sets the
      // weather, "I have black beans" answers that pantry question.
      if (Object.keys(reply.moment).length) setMomentState((m) => ({ ...m, ...reply.moment }));
      if (Object.keys(reply.answers).length) setAnswers((a) => ({ ...a, ...reply.answers }));
      setThread((t) => [...t, { ask: q, reply }]);
    },
    clearThread: () => setThread([]),
    saved, savedError,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
