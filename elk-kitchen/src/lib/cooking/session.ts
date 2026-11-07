// The cooking session as a pure state machine: what was said in, the new
// session and what to say back out. No browser APIs, so all of it is tested.
//
// Rules that keep measurements honest:
// - The transcript line is stored exactly as heard, before anything else.
// - A quantity with no unit, a big jump, a unit change, a repeat of an
//   ingredient already added, or a removal is never applied straight away:
//   Kitchen asks, and only "yes" applies it.
// - Every change to an ingredient is kept in its history and as an event.
import type { Recipe } from "../../types/recipe";
import type {
  CookingSession, IngredientChange, NoteCategory, PantryAction, Pending, PendingAction, MediaRef, Qty, SessionEvent,
  SessionIngredient, TempUnit, TempWhat, TranscriptLine,
} from "../../types/cooking";
import { newId } from "../recipeModel";
import { requiredInternalC, seasoningLines } from "../meat";
import { stepsFromText } from "../../prototype/ideas/cookSteps";
import type { BatchPlan, Preferences } from "../../types/sausage";
import { adviceFor, afterWeighing, parseProgress, planAnswer, STAGE_DOING, STAGE_LABEL } from "../sausage/stages";
import { weighOut } from "../sausage/plan";
import { blankPrefs } from "../sausage/preferences";
import {
  TEMP_LABEL, convert, convertible, durationText, grams, parseCommand, qtySpoken, qtyText, quantityAt, round, tempText, toC, toF,
  type Command,
} from "./parse";

export type Result = { session: CookingSession; reply: string; stopListening?: boolean };

export function newSession(args: { recipe: Recipe | null; title?: string; cookName: string; now: string; id?: string; plan?: BatchPlan | null }): CookingSession {
  const at = args.now;
  return {
    format: 1,
    id: args.id ?? newId(),
    recipeId: args.recipe?.id ?? null,
    recipeTitle: args.recipe?.title ?? (args.title?.trim() || "New cook"),
    cookName: args.cookName,
    startedAt: at,
    endedAt: null,
    transcript: [],
    events: [{ id: newId(), at, kind: "started" }],
    ingredients: [],
    timers: [],
    pending: [],
    stepIndex: -1,
    lastIngredientId: null,
    lastReply: "",
    awaitingNote: null,
    savedEntryId: null,
    ...(args.plan ? { plan: args.plan, stageLog: [] } : {}),
  };
}

export const stepsOf = (recipe: Recipe | null) => (recipe ? stepsFromText(recipe.instructions) : []);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/(es|s)$/, "");

export function findIngredient(s: CookingSession, name: string): SessionIngredient | null {
  const n = norm(name);
  if (!n) return null;
  const live = s.ingredients.filter((i) => !i.removed);
  return live.find((i) => norm(i.name) === n)
    ?? live.find((i) => norm(i.name).includes(n) || n.includes(norm(i.name)))
    ?? null;
}

// ── Low-level updates (also used by the manual editor) ───────────────────────
type NewEvent = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, "id"> : never) : never;
function event(s: CookingSession, e: NewEvent): CookingSession {
  return { ...s, events: [...s.events, { ...e, id: newId() } as SessionEvent] };
}

export function setIngredient(
  s: CookingSession, args: { ingredientId: string | null; name: string; qty: Qty | null; why: IngredientChange["why"]; now: string; lineId: string | null },
): CookingSession {
  const existing = args.ingredientId ? s.ingredients.find((i) => i.id === args.ingredientId) ?? null : null;
  const change: IngredientChange = { at: args.now, qty: args.qty, why: args.why, lineId: args.lineId };
  let ingredients: SessionIngredient[];
  let id: string;
  if (existing) {
    id = existing.id;
    ingredients = s.ingredients.map((i) => (i.id === id
      ? { ...i, name: args.name.trim() || i.name, qty: args.why === "removed" ? i.qty : args.qty, removed: args.why === "removed", history: [...i.history, change] }
      : i));
  } else {
    id = newId();
    ingredients = [...s.ingredients, { id, name: args.name.trim(), qty: args.qty, removed: false, history: [change] }];
  }
  const next = { ...s, ingredients, lastIngredientId: args.why === "removed" ? null : id };
  return event(next, {
    at: args.now, kind: "ingredient", ingredientId: id, name: args.name.trim() || existing?.name || "", action: args.why,
    before: existing?.qty ?? null, after: args.why === "removed" ? null : args.qty, lineId: args.lineId,
  });
}

export function addNote(s: CookingSession, category: NoteCategory, text: string, now: string, lineId: string | null = null): CookingSession {
  return event(s, { at: now, kind: "note", category, text: text.trim(), lineId });
}

export function addTemperature(s: CookingSession, what: TempWhat, value: number, unit: TempUnit, now: string, lineId: string | null = null): CookingSession {
  return event(s, { at: now, kind: "temperature", what, value, unit, lineId });
}

export function addMedia(s: CookingSession, media: MediaRef, now: string): CookingSession {
  return event(s, { at: now, kind: "media", media });
}

export function startTimer(s: CookingSession, seconds: number, label: string, now: string): CookingSession {
  const id = newId();
  const n = s.timers.length + 1;
  const name = label.trim() || `Timer ${n}`;
  const endsAt = new Date(Date.parse(now) + seconds * 1000).toISOString();
  const next = { ...s, timers: [...s.timers, { id, label: name, seconds, endsAt, done: false, cancelled: false }] };
  return event(next, { at: now, kind: "timer", timerId: id, label: name, seconds, action: "started" });
}

export function endTimer(s: CookingSession, timerId: string, how: "done" | "cancelled", now: string): CookingSession {
  const t = s.timers.find((x) => x.id === timerId);
  if (!t || t.done || t.cancelled) return s;
  const next = { ...s, timers: s.timers.map((x) => (x.id === timerId ? { ...x, done: how === "done", cancelled: how === "cancelled" } : x)) };
  return event(next, { at: now, kind: "timer", timerId, label: t.label, seconds: t.seconds, action: how });
}

export const activeTimers = (s: CookingSession) => s.timers.filter((t) => !t.done && !t.cancelled);

export function recordPantry(s: CookingSession, action: PantryAction, now: string): CookingSession {
  return event(s, { at: now, kind: "pantry", action });
}

export function finish(s: CookingSession, now: string): CookingSession {
  if (s.endedAt) return s;
  let next = s;
  for (const t of activeTimers(s)) next = endTimer(next, t.id, "cancelled", now);
  return event({ ...next, endedAt: now, pending: [] }, { at: now, kind: "finished" });
}

export function resume(s: CookingSession): CookingSession {
  return { ...s, endedAt: null, events: s.events.filter((e) => e.kind !== "finished") };
}

// ── Speech in, reply out ─────────────────────────────────────────────────────
type Context = { recipe: Recipe | null; source: "voice" | "typed"; now: string; prefs?: Preferences };

export function hear(s0: CookingSession, text: string, ctx: Context): Result {
  const heard = text.trim();
  if (!heard) return { session: s0, reply: "" };
  const line: TranscriptLine = { id: newId(), at: ctx.now, text: heard, source: ctx.source, understood: "" };
  const s = { ...s0, transcript: [...s0.transcript, line] };
  const cmd = parseCommand(heard);
  const progress = s.awaitingNote ? null : parseProgress(heard);
  const r = s.awaitingNote && !["stop", "no", "yes"].includes(cmd.kind)
    ? noted(s, s.awaitingNote, heard, ctx, line.id)
    : progress ? stages(s, progress, ctx, line.id)
    : act(s, cmd, ctx, line.id);
  const understood = r.understood ?? r.reply;
  const transcript = r.session.transcript.map((l) => (l.id === line.id ? { ...l, understood } : l));
  const session = { ...r.session, transcript, lastReply: cmd.kind === "repeat" ? r.session.lastReply : r.reply || r.session.lastReply };
  return { session, reply: r.reply, ...(r.stopListening ? { stopListening: true } : {}) };
}

type Inner = { session: CookingSession; reply: string; understood?: string; stopListening?: boolean };

// "I've finished grinding the pork. Now I'm grinding the chicken." Kept as notes and in the stage log.
function stages(s0: CookingSession, items: NonNullable<ReturnType<typeof parseProgress>>, ctx: Context, lineId: string): Inner {
  let s = s0;
  for (const p of items) {
    const text = `${p.action === "finished" ? "Finished" : "Started"} ${STAGE_DOING[p.stage]}${p.subject ? `: ${p.subject}` : ""}`;
    s = addNote(s, "observation", text, ctx.now, lineId);
    s = { ...s, stageLog: [...(s.stageLog ?? []), { at: ctx.now, stage: p.stage, subject: p.subject, action: p.action }] };
  }
  const understood = items.map((p) => `${p.action === "finished" ? "Done" : "Now"}: ${STAGE_LABEL[p.stage]}${p.subject ? ` (${p.subject})` : ""}`).join("; ");
  return { session: s, reply: adviceFor(items, s, ctx.prefs ?? s.plan?.prefs ?? blankPrefs()), understood };
}

// A planned cook: "how much salt?" from the plan's ratio and the meat weighed so far.
function planScale(s: CookingSession, ingredient: string, amount: Qty): string | null {
  if (!s.plan) return null;
  const g = grams(amount);
  const want = norm(ingredient);
  const hit = s.plan.seasonings.find((x) => norm(x.name).includes(want) || want.includes(norm(x.name)));
  if (g == null || !hit) return null;
  const a = weighOut(hit, g, s.plan.tweaks, s.plan.excluded);
  return a.text ? `${hit.name}: ${a.text} for ${qtySpoken(amount)} of meat (from the approved plan's ratio).` : null;
}

const CATEGORY_WORD: Record<NoteCategory, string> = { observation: "Note", "next-time": "Note for next time", tasting: "Tasting note", equipment: "Equipment", substitution: "Substitution" };

function noted(s: CookingSession, category: NoteCategory, text: string, ctx: Context, lineId: string): Inner {
  const clean = text.replace(/[.!?]+$/, "").trim();
  const t = clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
  return { session: { ...addNote(s, category, t, ctx.now, lineId), awaitingNote: null }, reply: `${CATEGORY_WORD[category]} saved.`, understood: `${CATEGORY_WORD[category]}: ${t}` };
}

function ask(s: CookingSession, lineId: string, question: string, onYes: PendingAction, onNo: PendingAction | null = null): Inner {
  const p: Pending = { id: newId(), lineId, question, onYes, onNo };
  return { session: { ...s, pending: [...s.pending, p] }, reply: `${question} Say yes or no.`, understood: `Asked: ${question}` };
}

function act(s: CookingSession, cmd: Command, ctx: Context, lineId: string): Inner {
  const steps = stepsOf(ctx.recipe);
  switch (cmd.kind) {
    case "stop":
      return { session: { ...s, awaitingNote: null }, reply: "Stopped listening.", stopListening: true };
    case "yes":
    case "no": {
      if (s.awaitingNote) return { session: { ...s, awaitingNote: null }, reply: "Okay, no note." };
      const p = s.pending[0];
      if (!p) return { session: s, reply: "There's nothing to confirm right now." };
      const r = answer(s, p.id, cmd.kind === "yes", ctx.now, lineId, ctx.recipe);
      return { session: r.session, reply: r.reply };
    }
    case "next-step":
    case "previous-step":
    case "current-step": {
      if (!steps.length) return { session: s, reply: ctx.recipe ? "This recipe doesn't have written steps." : "This cook doesn't have written steps." };
      const i = cmd.kind === "next-step" ? Math.min(steps.length, s.stepIndex + 1)
        : cmd.kind === "previous-step" ? Math.max(0, s.stepIndex - 1) : Math.max(0, s.stepIndex);
      if (i >= steps.length) return { session: { ...s, stepIndex: steps.length }, reply: "That was the last step." };
      return { session: { ...s, stepIndex: i }, reply: `Step ${i + 1} of ${steps.length}. ${steps[i]}` };
    }
    case "repeat":
      return { session: s, reply: s.lastReply || "I haven't said anything yet.", understood: "Repeated the last reply" };
    case "ingredients-list": {
      const live = s.ingredients.filter((i) => !i.removed);
      return { session: s, reply: live.length ? `So far: ${live.map((i) => `${i.name}, ${qtySpoken(i.qty)}`).join("; ")}.` : "Nothing added yet." };
    }
    case "add": {
      const r = addIngredient(s, cmd.name, cmd.qty, ctx, lineId);
      return r.session.pending.length > s.pending.length ? r : { ...r, reply: r.reply + afterWeighing(r.session) };
    }
    case "correct": return correct(s, cmd.target, cmd.qty, ctx, lineId);
    case "remove": {
      const ing = cmd.target ? findIngredient(s, cmd.target) : s.ingredients.find((i) => i.id === s.lastIngredientId && !i.removed) ?? null;
      if (!ing) return { session: s, reply: cmd.target ? `I can't find ${cmd.target} in this cook.` : "Which ingredient? Say, for example, “remove the salt”." };
      return ask(s, lineId, `Remove ${ing.name} (${qtyText(ing.qty)}) from this cook?`,
        { kind: "set-ingredient", ingredientId: ing.id, name: ing.name, qty: ing.qty ?? { value: 0, unit: "" }, why: "removed" });
    }
    case "timer": {
      const label = cmd.label || (s.stepIndex >= 0 && s.stepIndex < steps.length ? `Step ${s.stepIndex + 1}` : "");
      const next = startTimer(s, cmd.seconds, label, ctx.now);
      return { session: next, reply: `Timer set for ${durationText(cmd.seconds)}${cmd.label ? ` (${cmd.label.toLowerCase()})` : ""}.` };
    }
    case "timer-cancel": {
      const t = activeTimers(s).slice(-1)[0];
      if (!t) return { session: s, reply: "There's no timer running." };
      return { session: endTimer(s, t.id, "cancelled", ctx.now), reply: `${t.label} timer cancelled.` };
    }
    case "timer-check": {
      const live = activeTimers(s);
      if (!live.length) return { session: s, reply: "There's no timer running." };
      const now = Date.parse(ctx.now);
      return { session: s, reply: live.map((t) => `${t.label}: ${durationText(Math.max(0, Math.round((Date.parse(t.endsAt) - now) / 1000)))} left`).join(". ") + "." };
    }
    case "scale": return { session: s, reply: planScale(s, cmd.ingredient, cmd.amount) ?? scaleAnswer(ctx.recipe, cmd.ingredient, cmd.amount) };
    case "temperature": {
      if (cmd.unit) return temperature(s, cmd.what, cmd.value, cmd.unit, ctx, lineId);
      const guess: TempUnit = cmd.value > 100 ? "F" : "C";
      const other: TempUnit = guess === "F" ? "C" : "F";
      return ask(s, lineId, `${TEMP_LABEL[cmd.what]} ${cmd.value} degrees — is that ${guess === "F" ? "Fahrenheit" : "Celsius"}? (No means ${other === "F" ? "Fahrenheit" : "Celsius"}.)`,
        { kind: "temperature", what: cmd.what, value: cmd.value, unit: guess }, { kind: "temperature", what: cmd.what, value: cmd.value, unit: other });
    }
    case "note": {
      const next = addNote(s, cmd.category, cmd.text, ctx.now, lineId);
      return { session: next, reply: `${CATEGORY_WORD[cmd.category]} saved.`, understood: `${CATEGORY_WORD[cmd.category]}: ${cmd.text}` };
    }
    case "substitution": {
      const text = `${cap(cmd.used)} instead of ${cmd.insteadOf}`;
      return { session: addNote(s, "substitution", text, ctx.now, lineId), reply: `Substitution noted: ${text.toLowerCase()}.`, understood: `Substitution: ${text}` };
    }
    case "scale-recipe": return { session: s, reply: scaleRecipe(ctx.recipe, cmd.factor), understood: `Recipe × ${cmd.factor} (read back, nothing changed)` };
    case "question": return { session: s, reply: planAnswer(s, cmd.text) ?? lookUp(ctx.recipe, cmd.text), understood: `Question: ${cmd.text}` };
    case "note-prompt":
      return { session: { ...s, awaitingNote: cmd.category }, reply: cmd.category === "next-time" ? "Okay. What should we do differently next time?" : cmd.category === "tasting" ? "Okay. How does it taste?" : "Okay. What's the note?" };
  }
}

function addIngredient(s: CookingSession, name: string, qty: Qty, ctx: Context, lineId: string): Inner {
  const existing = findIngredient(s, name);
  if (!qty.unit) {
    const guess = existing?.qty?.unit || "g";
    return ask(s, lineId, `I heard ${qty.value} ${name} with no unit. Did you mean ${qtySpoken({ value: qty.value, unit: guess })} of ${existing?.name ?? name}?`,
      existing
        ? { kind: "set-ingredient", ingredientId: existing.id, name: existing.name, qty: sum(existing.qty, { value: qty.value, unit: guess }), why: "added-more" }
        : { kind: "set-ingredient", ingredientId: null, name, qty: { value: qty.value, unit: guess }, why: "said" });
  }
  if (existing) {
    const total = existing.qty && convertible(existing.qty.unit, qty.unit) ? sum(existing.qty, qty) : null;
    if (!total) {
      return ask(s, lineId, `${cap(existing.name)} is already ${qtySpoken(existing.qty)}. Change it to ${qtySpoken(qty)}?`,
        { kind: "set-ingredient", ingredientId: existing.id, name: existing.name, qty, why: "corrected" });
    }
    return ask(s, lineId, `${cap(existing.name)} is already ${qtySpoken(existing.qty)}. Add another ${qtySpoken(qty)}, making ${qtySpoken(total)}?`,
      { kind: "set-ingredient", ingredientId: existing.id, name: existing.name, qty: total, why: "added-more" },
      { kind: "none", reply: `Kept ${existing.name} at ${qtySpoken(existing.qty)}. To change it, say “change the ${existing.name} to …”.` });
  }
  const next = setIngredient(s, { ingredientId: null, name, qty, why: "said", now: ctx.now, lineId });
  return { session: next, reply: `Added ${name}, ${qtySpoken(qty)}.`, understood: `Added ${name}: ${qtyText(qty)}` };
}

function sum(a: Qty | null, b: Qty): Qty {
  if (!a) return b;
  const bAsA = convert(b, a.unit);
  return bAsA ? { value: round(a.value + bAsA.value), unit: a.unit } : b;
}

function correct(s: CookingSession, target: string | null, qty: Qty, ctx: Context, lineId: string): Inner {
  const ing = target ? findIngredient(s, target) : s.ingredients.find((i) => i.id === s.lastIngredientId && !i.removed) ?? null;
  if (!ing) {
    if (target) {
      const q = qty.unit ? qty : { value: qty.value, unit: "g" };
      return ask(s, lineId, `${cap(target)} isn't in this cook yet. Add ${qtySpoken(q)} of ${target}?`,
        { kind: "set-ingredient", ingredientId: null, name: target, qty: q, why: "said" });
    }
    return { session: s, reply: `Which ingredient should be ${qtySpoken(qty)}? Say, for example, “change the salt to ${qtySpoken(qty)}”.` };
  }
  const before = ing.qty;
  const to: Qty = qty.unit ? qty : { value: qty.value, unit: before?.unit ?? "" };
  const change = `Change ${ing.name} from ${qtySpoken(before)} to ${qtySpoken(to)}?`;
  if (!qty.unit) return ask(s, lineId, change, { kind: "set-ingredient", ingredientId: ing.id, name: ing.name, qty: to, why: "corrected" });
  if (before && !convertible(before.unit, to.unit)) return ask(s, lineId, `That changes the unit. ${change}`, { kind: "set-ingredient", ingredientId: ing.id, name: ing.name, qty: to, why: "corrected" });
  const b = before ? convert(before, to.unit) : null;
  if (b && b.value > 0 && (to.value / b.value >= 2 || to.value / b.value <= 0.5)) {
    return ask(s, lineId, `That's a big change. ${change}`, { kind: "set-ingredient", ingredientId: ing.id, name: ing.name, qty: to, why: "corrected" });
  }
  const next = setIngredient(s, { ingredientId: ing.id, name: ing.name, qty: to, why: "corrected", now: ctx.now, lineId });
  return { session: next, reply: `Changed ${ing.name} from ${qtySpoken(before)} to ${qtySpoken(to)}.`, understood: `Corrected ${ing.name}: ${qtyText(before)} → ${qtyText(to)}` };
}

function temperature(s: CookingSession, what: TempWhat, value: number, unit: TempUnit, ctx: Context, lineId: string | null): Inner {
  const next = addTemperature(s, what, value, unit, ctx.now, lineId);
  let reply = `${TEMP_LABEL[what]} ${tempText(value, unit)} noted.`;
  const r = ctx.recipe;
  if (what === "internal" && ((r && r.kind !== "general") || s.plan)) {
    // A planned mix with chicken in it takes the poultry temperature.
    const need = s.plan?.poultry ? 74 : requiredInternalC(r?.details.meatType ?? "");
    if (toC(value, unit) < need) reply += ` That's below the ${need} °C (${Math.round(toF(need, "C"))} °F) safe internal temperature.`;
  }
  return { session: next, reply, understood: `${TEMP_LABEL[what]}: ${tempText(value, unit)}` };
}

// Yes / no to a question Kitchen asked.
export function answer(s: CookingSession, pendingId: string, yes: boolean, now: string, lineId: string | null = null, recipe: Recipe | null = null): { session: CookingSession; reply: string } {
  const p = s.pending.find((x) => x.id === pendingId);
  if (!p) return { session: s, reply: "" };
  const rest = { ...s, pending: s.pending.filter((x) => x.id !== pendingId) };
  const a = yes ? p.onYes : p.onNo;
  if (!a) return { session: rest, reply: "Okay, nothing changed." };
  switch (a.kind) {
    case "none": return { session: rest, reply: a.reply };
    case "set-ingredient": {
      const next = setIngredient(rest, { ingredientId: a.ingredientId, name: a.name, qty: a.why === "removed" ? null : a.qty, why: a.why, now, lineId: lineId ?? p.lineId });
      const reply = (a.why === "removed" ? `Removed ${a.name}.` : a.why === "said" ? `Added ${a.name}, ${qtySpoken(a.qty)}.` : `${cap(a.name)} is now ${qtySpoken(a.qty)}.`) + afterWeighing(next);
      return { session: next, reply };
    }
    case "temperature":
      return temperature(rest, a.what, a.value, a.unit, { recipe, source: "voice", now }, lineId ?? p.lineId);
  }
}

// "How much pepper for 3 kg?" Only from what the recipe actually says.
export function scaleAnswer(recipe: Recipe | null, ingredient: string, amount: Qty): string {
  const g = grams(amount);
  if (!recipe) return "There's no recipe open, so I don't have a ratio to work from.";
  if (g == null) return `I can only scale by weight. Say it in grams, kilograms or pounds.`;
  const want = norm(ingredient);
  const match = (name: string) => { const n = norm(name); return n === want || n.includes(want) || want.includes(n); };
  const line = seasoningLines(recipe.details.seasoning, null).find((l) => l.percent != null && match(l.name));
  if (line && line.percent != null) {
    const need = round((g * line.percent) / 100);
    return `${line.name} is ${line.percent}% of the meat weight, so for ${qtySpoken(amount)} you need ${fmtG(need)}.`;
  }
  const base = recipe.details.meatWeightG;
  if (base && base > 0) {
    for (const raw of recipe.ingredients.split("\n")) {
      const q = quantityAt(raw.trim().replace(/^[-•*]\s*/, ""));
      if (!q || !match(q.rest)) continue;
      const scaled = { value: round((q.qty.value * g) / base), unit: q.qty.unit };
      return `The recipe uses ${qtySpoken(q.qty)} of ${q.rest} for ${fmtG(base)} of meat, so for ${qtySpoken(amount)}: ${qtySpoken(scaled)}.`;
    }
  }
  return `This recipe doesn't give an amount for ${ingredient} that I can scale, so I won't guess.`;
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const fmtG = (g: number) => (g >= 1000 ? qtySpoken({ value: round(g / 1000), unit: "kg" }) : qtySpoken({ value: Math.round(g * 10) / 10, unit: "g" }));

// ── Answers from the recipe's own text (no AI, nothing invented) ────────────
const FRACTION: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
function leadingAmount(line: string): { value: number; rest: string } | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)?\s*(?:(\d+)\/(\d+)|([¼½¾⅓⅔⅛]))?(?=\s|[a-zA-Z])/.exec(line);
  if (!m || (!m[1] && !m[2] && !m[4])) return null;
  let v = m[1] ? Number(m[1].replace(",", ".")) : 0;
  if (m[2] && m[3] && Number(m[3]) > 0) v += Number(m[2]) / Number(m[3]);
  if (m[4]) v += FRACTION[m[4]];
  return v > 0 ? { value: v, rest: line.slice(m[0].length).trim() } : null;
}
const nice = (v: number) => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

export function scaleRecipe(recipe: Recipe | null, factor: number): string {
  if (!recipe?.ingredients.trim()) return "This cook has no written ingredient list to scale.";
  const lines = recipe.ingredients.split("\n").map((l) => l.replace(/^[-•*·]\s*/, "").trim()).filter((l) => l && !/:$/.test(l));
  if (!lines.some((l) => leadingAmount(l))) return "The recipe doesn't write down amounts, so there's nothing to scale. Say what you add as you go and I'll keep track.";
  const out = lines.map((l) => { const a = leadingAmount(l); return a ? `${nice(a.value * factor)} ${a.rest}` : `${l} (no amount written)`; });
  const word = factor === 2 ? "Doubled" : factor === 0.5 ? "Halved" : factor === 3 ? "Tripled" : `Times ${nice(factor)}`;
  return `${word}, from the recipe's own amounts: ${out.join("; ")}. Nothing in this cook was changed — say what you actually add as you go.`;
}

const STOP_WORDS = new Set("a an the i we do does is it to of for in on how what when which where why should can much many long it's its my our you your this that be with and or at by from".split(" "));
export function lookUp(recipe: Recipe | null, question: string): string {
  if (!recipe) return "There's no written recipe for this cook, so I can't look that up. I've kept your question in the transcript.";
  const want = question.toLowerCase().replace(/[^a-z0-9°\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map((w) => w.replace(/s$/, ""));
  if (!want.length) return "I didn't catch what to look up. Try “what temperature does the oven go to?”";
  // Ingredient sections ("Dressing:" and the lines under it) count as one passage.
  const sections = recipe.ingredients.split(/\n\s*\n/).flatMap((block) => {
    const ls = block.split("\n").map((x) => x.trim()).filter(Boolean);
    return ls[0]?.endsWith(":") && ls.length > 1 ? [`${ls[0]} ${ls.slice(1).join(", ")}`] : ls;
  });
  const sentences = [...[recipe.instructions, recipe.notes].join("\n").split(/(?<=[.!?])\s+|\n+/), ...sections].map((x) => x.trim()).filter(Boolean);
  const scored = sentences.map((x) => {
    const words = x.toLowerCase().replace(/[^a-z0-9°\s]/g, " ").split(/\s+/).map((w) => w.replace(/s$/, ""));
    return { x, n: want.filter((w) => words.includes(w)).length };
  }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return "The recipe doesn't say. I've kept your question in the transcript.";
  return `The recipe says: ${scored.slice(0, 2).map((r) => r.x).join(" … ")}`;
}
