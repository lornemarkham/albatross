import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import type { RecipeSummary } from "../types/recipe";
import { localToday } from "./ideas/context";
import { simulateReply, type Reply } from "./ideas/conversation";
import { SAMPLE_IDEAS } from "./ideas/sampleIdeas";
import { samplePantry } from "./ideas/samplePantry";
import { NO_MOOD, type MoodFilters } from "./ideas/suggest";
import type { Answers, Moment, PantryItem } from "./ideas/types";

// What the person has told Kitchen during this visit. Held in memory only:
// nothing here is saved, and a reload starts fresh.
type Session = {
  moment: Moment;
  setMoment: (patch: Partial<Moment>) => void;
  answers: Answers;
  answer: (key: string, value: "yes" | "no" | null) => void;
  setAnswers: (a: Answers) => void;
  entry: Entry;
  setEntry: (e: Entry) => void;
  seed: number;
  reroll: () => void;
  mood: MoodFilters;
  setMood: (patch: Partial<MoodFilters>) => void;
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

// Which of the three ways in the person picked ("tonight" = none yet).
export type Entry = "tonight" | "surprise" | "have" | "mood";

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
  const [moment, setMomentState] = useState<Moment>(() => ({ today: localToday(), weather: null, minutes: null, equipment: [], people: null, kids: false, weatherNote: null }));
  const [answers, setAnswers] = useState<Answers>({});
  const [mood, setMoodState] = useState<MoodFilters>(NO_MOOD);
  const [entry, setEntry] = useState<Entry>("tonight");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6) + 1);
  // Pantry isn't connected for real, so Kitchen starts by knowing nothing.
  // The sample Pantry is a demo the person has to switch on.
  const [pantryMode, setPantryMode] = useState<"sample" | "none">("none");
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
    setAnswers,
    entry, setEntry,
    seed, reroll: () => setSeed((n) => n + 7919),
    mood,
    setMood: (patch) => setMoodState((m) => ({ ...m, ...patch })),
    pantryMode, setPantryMode, pantry,
    thread,
    ask: (text) => {
      const q = text.trim();
      if (!q) return;
      const previous = thread.length ? thread[thread.length - 1].ask : "";
      const reply = simulateReply(q, SAMPLE_IDEAS, saved ?? [], moment.today, previous);
      // What the person said becomes part of the moment: "It's hot" sets the
      // weather, "I have black beans" answers that pantry question.
      if (Object.keys(reply.moment).length) {
        setMomentState((m) => ({ ...m, ...reply.moment, ...(reply.moment.weather ? { weatherNote: null } : {}) }));
      }
      if (Object.keys(reply.answers).length) setAnswers((a) => ({ ...a, ...reply.answers }));
      setThread((t) => [...t, { ask: q, reply }]);
    },
    clearThread: () => setThread([]),
    saved, savedError,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
