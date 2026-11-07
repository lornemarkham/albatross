// Understanding what was said while cooking. Plain rules, not AI: the same
// words always mean the same thing, and anything that doesn't match a rule is
// kept as a note rather than guessed at.
import type { Qty, TempUnit, TempWhat } from "../../types/cooking";

// ── Numbers ──────────────────────────────────────────────────────────────────
const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const FRACTIONS: Record<string, number> = { half: 0.5, quarter: 0.25, third: 1 / 3 };

const UNIT_WORDS: [RegExp, string][] = [
  [/^(g|gs|gram|grams|gramme|grammes|gr)$/, "g"],
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilogramme|kilogrammes)$/, "kg"],
  [/^(lb|lbs|pound|pounds)$/, "lb"],
  [/^(oz|ounce|ounces)$/, "oz"],
  [/^(ml|mls|millilitre|millilitres|milliliter|milliliters)$/, "ml"],
  [/^(l|litre|litres|liter|liters)$/, "l"],
  [/^(tsp|tsps|teaspoon|teaspoons)$/, "tsp"],
  [/^(tbsp|tbsps|tablespoon|tablespoons|tbs)$/, "tbsp"],
  [/^(cup|cups)$/, "cup"],
  [/^(%|percent|per cent)$/, "%"],
  [/^(clove|cloves)$/, "cloves"],
  [/^(pinch|pinches)$/, "pinch"],
  [/^(piece|pieces)$/, "pieces"],
  [/^(can|cans)$/, "cans"],
  [/^(feet|foot|ft)$/, "ft"],
  [/^(m|metre|metres|meter|meters)$/, "m"],
];
export function unitOf(word: string): string | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  for (const [re, u] of UNIT_WORDS) if (re.test(w)) return u;
  return null;
}

// Speech engines mostly give digits ("40 grams"), but not always ("forty").
// Rewrites spelled-out numbers into digits; leaves everything else alone.
export function wordsToDigits(text: string): string {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  const word = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[,.!?]$/, "");
  while (i < tokens.length) {
    const t = word(tokens[i]);
    if (t in SMALL || t in TENS || (t === "a" && word(tokens[i + 2]) === "hundred")) {
      let total = 0, current = 0, j = i, last = i;
      while (j < tokens.length) {
        const w = word(tokens[j]);
        if (/^\s+$/.test(tokens[j] ?? "")) { j++; continue; }
        if (w in SMALL) current += SMALL[w];
        else if (w in TENS) current += TENS[w];
        else if (w === "hundred") current = (current || 1) * 100;
        else if (w === "thousand") { total += (current || 1) * 1000; current = 0; }
        else if (w === "a" && word(tokens[j + 2]) === "hundred") current += 0;
        else if (w === "and" && (word(tokens[j + 2]) in SMALL || word(tokens[j + 2]) in TENS)) { /* "a hundred and five" */ }
        else break;
        last = j;
        j++;
      }
      const trailing = (tokens[last] ?? "").match(/[,.!?]$/)?.[0] ?? "";
      out.push(String(total + current) + trailing);
      i = last + 1;
      continue;
    }
    out.push(tokens[i]);
    i++;
  }
  return out.join("");
}

// "1 1/2", "1.5", "1,5", "one and a half", "half a", "a quarter" → number.
function numberAt(s: string): { value: number; rest: string } | null {
  const t = s.trimStart();
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)\b(.*)$/s);
  if (m) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };
  m = t.match(/^(\d+)\/(\d+)\b(.*)$/s);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: m[3] };
  m = t.match(/^(\d+(?:[.,]\d+)?)(?:\s+and\s+(?:a\s+)?(half|quarter|third))?(.*)$/s);
  if (m) return { value: Number(m[1].replace(",", ".")) + (m[2] ? FRACTIONS[m[2]] : 0), rest: m[3] };
  m = t.match(/^(?:an?\s+|one\s+)?(half|quarter|third)(?:\s+(?:of\s+)?an?)?\b(.*)$/s);
  if (m) return { value: FRACTIONS[m[1]], rest: m[2] };
  m = t.match(/^an?\b(.*)$/s);
  if (m && unitOf(m[1].trim().split(/\s+/)[0] ?? "")) return { value: 1, rest: m[1] };
  return null;
}

// A quantity at the start of `s`: "40 grams of salt" → { qty: 40 g, rest: "salt" }.
// unit "" means no unit was said.
export function quantityAt(s: string): { qty: Qty; rest: string } | null {
  const n = numberAt(s);
  if (!n || !Number.isFinite(n.value)) return null;
  let rest = n.rest.replace(/^\s*-\s*/, " ").trimStart();
  // "per cent" is two words.
  const two = rest.match(/^(per cent)\b(.*)$/s);
  const first = two ? two[1] : (rest.match(/^(%|[a-z.]+)/i)?.[1] ?? "");
  const unit = first ? unitOf(first) : null;
  if (unit) rest = (two ? two[2] : rest.slice(first.length));
  rest = rest.replace(/^\s*(of\s+)?/, "");
  return { qty: { value: round(n.value), unit: unit ?? "" }, rest: rest.trim() };
}

export const round = (n: number) => Math.round(n * 1000) / 1000;

// ── Units ────────────────────────────────────────────────────────────────────
const TO_GRAMS: Record<string, number> = { g: 1, kg: 1000, lb: 453.592, oz: 28.3495 };
const TO_ML: Record<string, number> = { ml: 1, l: 1000, tsp: 4.929, tbsp: 14.787, cup: 236.588 };

export function convertible(a: string, b: string): boolean {
  return a === b || (a in TO_GRAMS && b in TO_GRAMS) || (a in TO_ML && b in TO_ML && !(a in { tsp: 1, tbsp: 1, cup: 1 }) && !(b in { tsp: 1, tbsp: 1, cup: 1 }));
}
export function convert(q: Qty, to: string): Qty | null {
  if (q.unit === to) return q;
  if (q.unit in TO_GRAMS && to in TO_GRAMS) return { value: round((q.value * TO_GRAMS[q.unit]) / TO_GRAMS[to]), unit: to };
  if (convertible(q.unit, to) && q.unit in TO_ML && to in TO_ML) return { value: round((q.value * TO_ML[q.unit]) / TO_ML[to]), unit: to };
  return null;
}
export const grams = (q: Qty): number | null => (q.unit in TO_GRAMS ? q.value * TO_GRAMS[q.unit] : null);

const UNIT_SPOKEN: Record<string, [string, string]> = {
  g: ["gram", "grams"], kg: ["kilogram", "kilograms"], lb: ["pound", "pounds"], oz: ["ounce", "ounces"],
  ml: ["millilitre", "millilitres"], l: ["litre", "litres"], tsp: ["teaspoon", "teaspoons"], tbsp: ["tablespoon", "tablespoons"],
  cup: ["cup", "cups"], "%": ["percent", "percent"],
};
const fmtNumber = (n: number) => String(round(n)).replace(/\.0+$/, "");
export function qtyText(q: Qty | null): string {
  if (!q) return "no amount";
  return q.unit ? `${fmtNumber(q.value)} ${q.unit}` : fmtNumber(q.value);
}
export function qtySpoken(q: Qty | null): string {
  if (!q) return "no amount";
  const names = UNIT_SPOKEN[q.unit];
  if (!names) return q.unit ? `${fmtNumber(q.value)} ${q.unit}` : fmtNumber(q.value);
  return `${fmtNumber(q.value)} ${q.value === 1 ? names[0] : names[1]}`;
}

// ── Durations ────────────────────────────────────────────────────────────────
// "20 minutes", "1 hour 30 minutes", "an hour and a half", "90 seconds", "1.5 hours".
export function durationIn(s: string): number | null {
  const t = s.toLowerCase().replace(/-/g, " ");
  let total = 0, found = false;
  const re = /(\d+(?:[.,]\d+)?|an?|half an?)\s*(?:and a half\s*)?(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(\s+and a half)?/g;
  for (const m of t.matchAll(re)) {
    const raw = m[1];
    let n = raw.startsWith("half") ? 0.5 : /^an?$/.test(raw) ? 1 : Number(raw.replace(",", "."));
    if (/and a half/.test(m[0])) n += 0.5;
    const u = m[2];
    total += u.startsWith("h") ? n * 3600 : u.startsWith("m") ? n * 60 : n;
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}
export function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const parts = [h ? `${h} hour${h === 1 ? "" : "s"}` : "", m ? `${m} minute${m === 1 ? "" : "s"}` : "", s ? `${s} second${s === 1 ? "" : "s"}` : ""];
  return parts.filter(Boolean).join(" ") || "0 seconds";
}
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

// ── Temperatures ─────────────────────────────────────────────────────────────
export const toC = (value: number, unit: TempUnit) => (unit === "C" ? value : round(((value - 32) * 5) / 9));
export const toF = (value: number, unit: TempUnit) => (unit === "F" ? value : round((value * 9) / 5 + 32));
export function tempText(value: number, unit: TempUnit): string {
  const other = unit === "C" ? `${Math.round(toF(value, "C"))} °F` : `${Math.round(toC(value, "F"))} °C`;
  return `${fmtNumber(value)} °${unit} (${other})`;
}

function tempWhat(s: string): TempWhat {
  if (/\b(internal|core|inside|probe|meat temp|centre|center)\b/.test(s)) return "internal";
  if (/\b(smoker|smoke|pit)\b/.test(s)) return "smoker";
  if (/\b(oven|dehydrator)\b/.test(s)) return "oven";
  if (/\b(water|bath|poach|sous vide)\b/.test(s)) return "water";
  if (/\b(grill|bbq|barbecue)\b/.test(s)) return "grill";
  if (/\b(fridge|freezer|cooler)\b/.test(s)) return "fridge";
  return "other";
}
export const TEMP_LABEL: Record<TempWhat, string> = {
  internal: "Internal", smoker: "Smoker", oven: "Oven / dehydrator", water: "Water", grill: "Grill", fridge: "Fridge / cold", other: "Temperature",
};

// ── Commands ─────────────────────────────────────────────────────────────────
export type Command =
  | { kind: "yes" } | { kind: "no" }
  | { kind: "stop" }
  | { kind: "next-step" } | { kind: "previous-step" } | { kind: "repeat" } | { kind: "current-step" }
  | { kind: "ingredients-list" }
  | { kind: "add"; name: string; qty: Qty }
  | { kind: "correct"; target: string | null; qty: Qty }
  | { kind: "remove"; target: string | null }
  | { kind: "timer"; seconds: number; label: string }
  | { kind: "timer-cancel" }
  | { kind: "timer-check" }
  | { kind: "scale"; ingredient: string; amount: Qty }
  | { kind: "temperature"; what: TempWhat; value: number; unit: TempUnit | null }
  | { kind: "note"; category: "observation" | "next-time" | "tasting" | "equipment"; text: string }
  | { kind: "note-prompt"; category: "next-time" | "tasting" | "observation" }
  // "Used butter instead of oil" — kept as the batch's substitution.
  | { kind: "substitution"; used: string; insteadOf: string }
  // "Double the recipe" — read the recipe's own amounts back, scaled. Changes nothing.
  | { kind: "scale-recipe"; factor: number }
  // A question no rule answers: looked up in the recipe's own text.
  | { kind: "question"; text: string };

const clean = (s: string) => s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
const stripEnd = (s: string) => s.replace(/[.!?]+$/, "").trim();
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function parseCommand(input: string): Command {
  const original = clean(input);
  const s = stripEnd(wordsToDigits(original.toLowerCase())).replace(/(\d)-(minute|hour|second|min)/g, "$1 $2").replace(/[,]+/g, ",");
  const bare = s.replace(/,/g, "").replace(/^(ok(ay)?|hey kitchen|kitchen|um+|uh+|so)\s+/, "").replace(/\s+please$/, "").trim();

  if (/^(yes|yeah|yep|yup|correct|that'?s (right|correct)|right|confirm(ed)?|do it|sure)$/.test(bare)) return { kind: "yes" };
  if (/^(no|nope|nah|cancel( that)?|wrong|never ?mind|don'?t)$/.test(bare)) return { kind: "no" };
  if (/^(stop|stop listening|stop recording|pause|pause listening|that'?s all|done listening|mic off)$/.test(bare)) return { kind: "stop" };

  const sub = substitution(bare);
  if (sub) return sub;
  const factor = recipeFactor(bare);
  if (factor) return { kind: "scale-recipe", factor };

  if (/\b(next step|what'?s next|what is next|go on|go to the next|next one|^next$)\b/.test(bare)) return { kind: "next-step" };
  if (/\b(previous step|go back|last step|step back|back one)\b/.test(bare)) return { kind: "previous-step" };
  if (/\b(read (that|it|this) again|repeat( that| it)?|say (that|it) again|what was that|come again|once more)\b/.test(bare)) return { kind: "repeat" };
  if (/\b(what step|which step|where am i|read (me )?(the )?step|what'?s the (current )?step|what do i do now)\b/.test(bare)) return { kind: "current-step" };
  if (/\b(what have i added|what('?s| is) in (it|so far)|read (back )?the ingredients|list (the )?ingredients)\b/.test(bare)) return { kind: "ingredients-list" };

  // Timers.
  if (/\b(cancel|stop|clear) (the |my |that )?timers?\b/.test(bare)) return { kind: "timer-cancel" };
  if (/\b(how (long|much time)( is)? left|time left|check (the )?timer)\b/.test(bare)) return { kind: "timer-check" };
  if (/\b(timer|remind me in|countdown)\b/.test(bare)) {
    const seconds = durationIn(bare);
    if (seconds) {
      const label = bare.match(/\b(?:for|called|named)\s+(?:the\s+)?(?!\d)([a-z][a-z ]{1,30})$/)?.[1]?.replace(/\b(minutes?|hours?|seconds?)\b/g, "").trim();
      return { kind: "timer", seconds, label: label ? capital(label) : "" };
    }
  }

  // "How much pepper do I need for 3 kilograms?"
  const scale = bare.match(/^how (?:much|many)\s+(.+?)\s+(?:do i need|should i (?:use|add)|is that|goes in|for)?\s*(?:for|with|in)\s+(.+?)(?:\s+of (?:meat|pork|beef|mix|it))?\??$/);
  if (scale) {
    const amount = quantityAt(scale[2]);
    if (amount) return { kind: "scale", ingredient: scale[1].replace(/\b(do i need|should i use)\b/, "").trim(), amount: amount.qty };
  }

  // Notes.
  const nextTime = original.match(/^(?:ok(?:ay)?,?\s+)?(?:please\s+)?(?:make|add|take|leave)?\s*(?:a\s+)?note for next time\b[:,.\s-]*(.*)$/i)
    ?? original.match(/^(?:ok(?:ay)?,?\s+)?next time[:,\s-]+(.+)$/i)
    ?? original.match(/^(?:remember|reminder) (?:for|to) next time[:,\s-]*(.*)$/i);
  if (nextTime) return nextTime[1]?.trim() ? { kind: "note", category: "next-time", text: capital(stripEnd(nextTime[1].trim())) } : { kind: "note-prompt", category: "next-time" };
  const tasting = original.match(/^(?:tasting note|taste note|tasting)[:,.\s-]*(.*)$/i);
  if (tasting) return tasting[1]?.trim() ? { kind: "note", category: "tasting", text: capital(stripEnd(tasting[1].trim())) } : { kind: "note-prompt", category: "tasting" };
  if (/^(it |this |the \w+ )?(tastes?|taste test|flavou?r is|flavou?r's)\b/i.test(original)) return { kind: "note", category: "tasting", text: capital(stripEnd(original)) };

  // Corrections: "change that to 35 grams", "make the salt 35 grams", "actually 35", "no, 35 grams".
  const THAT = /^(that|it|this|the last one|that one)$/;
  const corr =
    bare.match(/^(?:(?:no|actually|sorry|wait|oops)\s+)*(?:change|make|correct|update|fix|set)\s+(.+?)\s+(?:(?:to|be|should be)\s+)?(\d.*|an?\s+\S.*|half.*)$/)
    ?? bare.match(/^()(?:that|it)\s+(?:should (?:have )?be(?:en)?|was actually|is actually|was|is)\s+(\d.*)$/)
    ?? bare.match(/^()(?:no|actually|sorry|wait|oops)\s+(?:it'?s\s+|make it\s+|it was\s+)?(\d.*)$/);
  if (corr) {
    const q = quantityAt(corr[2]);
    let target: string | null = corr[1] && !THAT.test(corr[1]) ? corr[1].replace(/^the\s+/, "") : null;
    if (q && q.rest && !target) target = tidyName(q.rest);
    if (q && (!q.rest || target)) return { kind: "correct", target, qty: q.qty };
  }
  const rm = bare.match(/^(?:remove|delete|take out|scratch|undo)\s+(?:that|it|the last one|(?:the\s+)?(.+?))$/);
  if (rm && !/\bnote\b/.test(bare)) return { kind: "remove", target: rm[1] ?? null };

  // Temperatures: a number plus a temperature word.
  if (/\b(temp|temperature|degrees?|°|celsius|centigrade|fahrenheit)\b|°/.test(s) || /\b\d+(\.\d+)?\s*(c|f)\b/.test(s) && /\b(internal|smoker|oven|water|grill|probe|core|fridge)\b/.test(s)) {
    const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*(?:degrees?|°)?\s*(celsius|centigrade|fahrenheit|c|f)?\b/);
    if (m) {
      const unit: TempUnit | null = m[2] ? (m[2].startsWith("f") ? "F" : "C") : null;
      return { kind: "temperature", what: tempWhat(s), value: Number(m[1].replace(",", ".")), unit };
    }
  }

  // Equipment.
  const equip = original.match(/^(?:equipment|gear|tools?)[:,.\s-]+(.+)$/i) ?? original.match(/^(?:i'?m |we'?re |i am |we are )?using (?:the |a |an |my )?(.+)$/i);
  const equipQty = equip ? quantityAt(equip[1]) : null;
  if (equip && (!equipQty || !equipQty.qty.unit)) return { kind: "note", category: "equipment", text: capital(stripEnd(equip[1])) };

  // Weighed amounts: "the pork weighs 8.2 kilos", "chicken came to 1.9 kg".
  const weighs = bare.match(/^(?:the\s+|my\s+)?(.+?)\s+(?:weighs(?: in at)?|weighed|came (?:out )?to|comes (?:out )?to|is|was)\s+(\d.*)$/);
  if (weighs && !/^(that|it|this|the last one)$/.test(weighs[1])) {
    const q = quantityAt(weighs[2]);
    if (q && !q.rest && grams(q.qty) != null) return { kind: "add", name: tidyName(weighs[1]), qty: q.qty };
  }

  // Ingredients: "add 40 grams of salt", "I added 2 kg pork", "40 g salt", "add salt, 40 grams".
  const add = bare.match(/^(?:and\s+)?(?:please\s+)?(?:add|added|adding|i added|used|using|i used|i'?m using|i'?m adding|i'?ve added|we added|put in|i put in|throw in|threw in|mix in|mixed in|in goes|plus)\s+(.+)$/);
  const body = add ? add[1] : bare;
  const lead = quantityAt(body);
  if (lead && lead.rest && !/^(minutes?|hours?|seconds?)\b/.test(lead.rest)) {
    return { kind: "add", name: tidyName(lead.rest), qty: lead.qty };
  }
  if (add) {
    // "add salt 40 grams" / "add salt, 40 grams"
    const m = add[1].match(/^(.+?)[\s,]+(\d.*)$/);
    const q = m ? quantityAt(m[2]) : null;
    if (m && q && !q.rest) return { kind: "add", name: tidyName(m[1]), qty: q.qty };
  }

  const noteHead = original.match(/^(?:make a note|note|observation|add a note|remember)[:,.\s-]*(.*)$/i);
  if (noteHead) return noteHead[1]?.trim() ? { kind: "note", category: "observation", text: capital(stripEnd(noteHead[1].trim())) } : { kind: "note-prompt", category: "observation" };

  if (/\?\s*$/.test(original) || /^(how|what|when|which|where|why|should i|should we|can i|can we|do i|do we|does it|is it|is the|are the|how'?s)\b/.test(bare)) {
    return { kind: "question", text: stripEnd(original) };
  }
  return { kind: "note", category: "observation", text: capital(stripEnd(original)) };
}

const subName = (x: string) => tidyName(x.replace(/^(a|an|the|some|my|our)\s+/, "")).replace(/\s+(this time|today|tonight)$/, "");
function substitution(t: string): Command | null {
  // X replaces Y
  let m = /^(?:i |we )?(?:used|use|using|went with|go with|added|put in|tried) (.+?) (?:instead of|in place of|rather than) (.+)$/.exec(t)
    ?? /^(?:i |we )?(?:substituted|substitute|subbed|sub) (.+?) for (.+)$/.exec(t);
  if (m) return { kind: "substitution", used: subName(m[1]), insteadOf: subName(m[2]) };
  // Y replaced by X
  m = /^(?:i |we )?(?:swapped|swap|replaced|replace|switched|switch) (?:out )?(.+?) (?:for|with) (.+)$/.exec(t);
  if (m) return { kind: "substitution", used: subName(m[2]), insteadOf: subName(m[1]) };
  m = /^(?:no|out of|we'?re out of|didn'?t have) (.+?),? (?:so )?(?:i |we )?used (.+)$/.exec(t);
  if (m) return { kind: "substitution", used: subName(m[2]), insteadOf: subName(m[1]) };
  return null;
}

function recipeFactor(t: string): number | null {
  if (!/\b(recipe|batch|everything|the whole thing|it all|all of it)\b/.test(t)) return null;
  if (/\b(double|twice|2 ?x|times 2)\b/.test(t)) return 2;
  if (/\b(triple|three times|3 ?x|times 3)\b/.test(t)) return 3;
  if (/\b(half|halve)\b/.test(t)) return 0.5;
  const m = /\b(?:times|by|scale (?:it |the recipe )?(?:by|to)) (\d+(?:\.\d+)?)\b/.exec(t);
  return m && Number(m[1]) > 0 && Number(m[1]) <= 10 ? Number(m[1]) : null;
}

function tidyName(s: string): string {
  return s.replace(/^(the|some|of)\s+/, "").replace(/\s+(to it|to the mix|in it|into it|in there|please)$/, "").replace(/[,.]+$/, "").trim();
}
