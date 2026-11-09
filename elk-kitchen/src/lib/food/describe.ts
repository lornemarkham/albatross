// Turn what someone says or types about food into a draft record to confirm:
//   "Two frozen pork shoulder bones with meat attached"  → Pork shoulder bones · 2 bones · Freezer · "with meat attached"
//   "I made three containers of chicken stock"            → Homemade chicken stock · 3 containers
//   "half a bag of split peas in the pantry"              → Split peas · 1 half bag · Pantry
//   "approximately two pounds of stew meat"               → Stew meat · 2 lb · approximate
//
// This is rules, not AI, and it never invents: what isn't said stays empty
// (no place, no date, amount "not known"). The person confirms the draft
// before anything reaches ELK Inventory.
//
// ELK Inventory counts whole numbers with a free-text unit, so the draft keeps
// the person's own words (`quantityText`) next to the whole-number count that
// Inventory will hold. "Half a bag" is 1 "half bag"; no amount is 1 "portion"
// and says so (`amountKnown: false`).

export type FoodKind = "raw" | "homemade" | "leftover" | "opened" | "prepared" | "garden";

export type FoodDraft = {
  name: string;
  // The whole number Inventory holds, in `unit`.
  count: number;
  unit: string;
  // The amount in the person's words ("two bones", "half a bag"); empty when none was said.
  quantityText: string;
  amountKnown: boolean;
  approximate: boolean;
  // "" when not said; the person picks.
  location: string;
  // Where `location` came from, so the page can say it ("you said frozen").
  locationFrom: "said" | "frozen" | "";
  kinds: FoodKind[];
  // Anything else said about it: "with meat attached", "from the garden".
  notes: string;
  madeOn: string | null;
  // What was said, word for word.
  said: string;
};

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, couple: 2, pair: 2,
};
const NUM = "(?:\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen|dozen|a couple of|a couple|a pair of)";

// Containers: the count is of these, and the food follows "of".
const CONTAINERS = ["bag", "container", "batch", "jar", "can", "tin", "pack", "package", "packet", "tray", "bowl", "bunch", "head", "loaf", "bottle", "tub", "box", "carton", "portion", "serving", "pot", "tupperware", "ziploc", "zip-lock"];
// Weights and volumes: counted in whole units, with "of" before the food.
const MEASURES: Record<string, string> = {
  pound: "lb", pounds: "lb", lb: "lb", lbs: "lb", kilo: "kg", kilos: "kg", kg: "kg", kgs: "kg", gram: "g", grams: "g", g: "g", ounce: "oz", ounces: "oz", oz: "oz",
  cup: "cups", cups: "cups", litre: "L", litres: "L", liter: "L", liters: "L", l: "L", quart: "quarts", quarts: "quarts", pint: "pints", pints: "pints", ml: "ml",
};
// Foods that are counted as themselves: "two bones" is 2 bones, not 2 of something.
const COUNTABLE = ["bone", "link", "chop", "steak", "rib", "breast", "thigh", "leg", "wing", "fillet", "filet", "roast", "hock", "patty", "slice", "piece", "sausage", "bratwurst", "brat", "smokie", "burger", "drumstick", "egg", "tomato", "potato", "onion", "apple", "pepper", "cucumber", "zucchini", "carrot"];

const LOCATION = /\b(?:in|into|to|on|at|from)\s+(?:the |my |our |your )?((?:(?:chest|deep|garage|basement|upright|kitchen|spare|top|bottom|small|big|cold|root)\s+)?(?:freezer|fridge|refrigerator|pantry|cupboard|cellar|cooler|larder|counter|shelf))\b/;
const LOCATION_FRONT = /\b(?:(?:chest|deep|garage|basement|upright|kitchen|spare)\s+)(?:freezer|fridge)\b/;
const FILLER_LEAD = /^(?:please\s+)?(?:(?:can|could) you\s+)?(?:(?:add|put|save|store|log|record|note)\s+(?:these|this|those|the|my|our|some)?\s*|(?:i|we)(?:'ve| have)?\s+(?:just\s+)?(?:got|have|bought|found|picked|picked up|grabbed|made|cooked|baked|froze|frozen)\s+(?:a batch of\s+|some\s+)?|there(?:'s| is| are)\s+|(?:these|this|those) (?:are|is)\s+)/;

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();

function numberOf(word: string): number {
  const w = word.replace(/^a (?=dozen|couple|pair)/, "").replace(/ of$/, "").trim();
  return /^\d/.test(w) ? Number(w) : NUMBERS[w] ?? 1;
}

function dateOffset(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const singular = (w: string) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("ches") || w.endsWith("shes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const plural = (w: string, n: number) => (n === 1 ? w : w.endsWith("y") && !/[aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`);

// One piece of the sentence (already split on "and"), for one food.
function parseOne(raw: string, today: string): FoodDraft | null {
  let t = clean(raw).replace(/[.!?]+$/, "");
  if (!t) return null;
  const said = raw.trim();

  const kinds = new Set<FoodKind>();
  let madeOn: string | null = null;
  let notes = "";

  // Where.
  let location = "";
  let locationFrom: FoodDraft["locationFrom"] = "";
  const loc = LOCATION.exec(t) ?? null;
  if (loc) { location = titleCase(loc[1]); locationFrom = "said"; t = t.replace(loc[0], " "); }
  else {
    const front = LOCATION_FRONT.exec(t);
    if (front) { location = titleCase(front[0]); locationFrom = "said"; t = t.replace(front[0], "frozen "); }
  }

  // When it was made.
  const when = /\b(today|yesterday|last night|this morning|last weekend|last week|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.exec(t);
  if (when) {
    if (/today|this morning/.test(when[1])) madeOn = today;
    else if (/yesterday|last night/.test(when[1])) madeOn = dateOffset(today, -1);
    t = t.replace(when[0], " ");
  }

  // Lead-in ("Add these", "I made", "we have").
  const lead = FILLER_LEAD.exec(t);
  if (lead) {
    if (/made|cooked|baked/.test(lead[0])) kinds.add("homemade");
    t = t.slice(lead[0].length);
  }
  t = t.replace(/^(?:these|those|this|that|the|my|our|some)\s+/, "").replace(/\b(?:to|in|into) (?:the |my |our )?(?:inventory|pantry list|kitchen)\b/, " ").trim();

  // "with meat attached", "from the garden", "that i opened": kept as a note, not part of the name.
  const tail = /\s+((?:with|without|from|that|which|still|still in|in a|in the|opened|cut|trimmed)\b.*)$/.exec(t);
  if (tail && !/^from (?:the )?(?:freezer|fridge)/.test(tail[1])) {
    notes = tail[1].trim();
    t = t.slice(0, tail.index);
  }

  if (/\b(?:home ?made|home-made|i made|we made)\b/.test(`${clean(raw)}`)) kinds.add("homemade");
  if (/\bleft ?-?overs?\b/.test(t)) kinds.add("leftover");
  if (/\b(?:garden|homegrown|home-grown|harvest(?:ed)?|picked)\b/.test(`${t} ${notes}`)) kinds.add("garden");
  if (/\b(?:opened|partial|partly|half[- ](?:used|eaten|full|empty))\b/.test(`${t} ${notes}`)) kinds.add("opened");
  if (/\b(?:chopped|diced|sliced|shredded|cubed|grated|minced|marinated|cooked|roasted|prepped|peeled|blanched)\b/.test(t)) kinds.add("prepared");

  const frozen = /\bfrozen\b/.test(t);
  if (frozen && !location) { location = "Freezer"; locationFrom = "frozen"; }

  // Words that describe the state, not the food.
  t = t.replace(/\b(?:home ?made|home-made|frozen|fresh|leftover|left over|left-over|opened|garden)\b/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:of|the|some)\s+/, "");

  // Quantity.
  let count = 1, unit = "portion", quantityText = "", amountKnown = false, approximate = false;
  const approx = /^(?:approximately|approx\.?|about|around|roughly|maybe|nearly|almost|just under|just over|over|under)\s+/.exec(t);
  if (approx) { approximate = true; t = t.slice(approx[0].length); }

  const half = /^(half|1\/2|a half)(?: of)?(?: an?| the)?\s+/.exec(t);
  const num = new RegExp(`^(${NUM})\\s+`).exec(t);
  if (half) {
    const rest = t.slice(half[0].length);
    const cont = CONTAINERS.find((c) => new RegExp(`^${c}(?:s|es)?\\b`).test(rest));
    if (cont) {
      unit = `half ${cont}`; count = 1; amountKnown = true; approximate = true;
      quantityText = `half a ${cont}`;
      t = rest.replace(new RegExp(`^${cont}(?:s|es)?\\s*(?:of\\s+)?`), "");
    } else {
      unit = "half"; count = 1; amountKnown = true; approximate = true; quantityText = "half"; t = rest;
    }
  } else if (num) {
    const n = numberOf(num[1]);
    const rest = t.slice(num[0].length);
    const word = /^([a-z-]+)(.*)$/.exec(rest);
    const w = word?.[1] ?? "";
    const measure = MEASURES[w];
    const cont = CONTAINERS.find((c) => w === c || w === `${c}s` || w === `${c}es`);
    if (measure && /^\s*(?:of\s+)?/.test(word?.[2] ?? "")) {
      const whole = Number.isInteger(n) && n >= 1;
      count = whole ? n : 1; unit = whole ? measure : `${n} ${measure}`;
      amountKnown = true; quantityText = `${n} ${w}`;
      t = (word?.[2] ?? "").replace(/^\s*(?:of\s+)?/, "").trim();
      if (!whole) approximate = true;
    } else if (cont) {
      count = Number.isInteger(n) && n >= 1 ? n : 1; unit = plural(cont, count); amountKnown = true; quantityText = `${num[1].replace(/^a (?=dozen)/, "")} ${w}`;
      t = (word?.[2] ?? "").replace(/^\s*(?:of\s+)?/, "").trim();
    } else {
      // "two pork shoulder bones": the thing itself is what's counted.
      const last = singular(t.split(" ").pop() ?? "");
      const countable = COUNTABLE.includes(last);
      count = Number.isInteger(n) && n >= 1 ? n : 1;
      amountKnown = true; quantityText = `${num[1]}`;
      if (countable) { unit = plural(last, count); quantityText = `${num[1]} ${unit}`; }
      else if (/^(?:a|an)$/.test(num[1])) { count = 1; amountKnown = false; quantityText = ""; unit = "portion"; }
      else unit = "items";
      t = rest;
    }
    if (/^(?:a couple|a pair|couple|pair)/.test(num[1])) approximate = true;
  } else {
    // A bare container or count at the end: "pork bones, two of them" isn't handled; no amount.
    const cont = CONTAINERS.find((c) => new RegExp(`^${c}(?:s|es)?\\s+of\\s+`).test(t));
    if (cont) { count = 1; unit = cont; amountKnown = true; quantityText = `a ${cont}`; t = t.replace(new RegExp(`^${cont}(?:s|es)?\\s+of\\s+`), ""); }
  }
  if (approximate && !amountKnown) approximate = false;
  if (approximate && quantityText && !/^(?:half|a couple|a pair|couple|pair)/.test(quantityText)) quantityText = `about ${quantityText}`;

  t = t.replace(/^(?:of|the|some)\s+/, "").replace(/[,;]+$/, "").trim();
  if (t.length < 2 || t.length > 60 || /^(?:it|them|this|that|these|those|food|stuff|something|things?)$/.test(t)) return null;

  const homemade = kinds.has("homemade");
  // The state stays in the name where it matters to cooking: Kitchen reads "Leftover chili" as a leftover.
  const lead2 = homemade && !/^homemade/.test(t) ? "homemade " : kinds.has("leftover") ? "leftover " : kinds.has("garden") ? "garden " : "";
  const name = titleCase(`${lead2}${t}`);
  if (!kinds.size) kinds.add("raw");
  if (kinds.size > 1) kinds.delete("raw");

  return { name, count, unit, quantityText, amountKnown, approximate, location, locationFrom, kinds: [...kinds], notes: notes.replace(/^(?:that |which )/, ""), madeOn, said };
}

// "Two pork bones and three containers of chicken stock" is two foods. Only a
// quantity starts a new food ("split peas and carrots" stays one phrase per name).
const SPLIT = new RegExp(`\\s*(?:,|;|\\band\\b|\\bplus\\b|\\balso\\b)\\s+(?=${NUM}\\s|half\\b)`, "i");

export function parseFoodDescription(text: string, today: string): FoodDraft[] {
  const parts = text.split(/(?<=[.!?])\s+|\n+/).flatMap((s) => s.split(SPLIT)).map((s) => s.trim()).filter(Boolean);
  const out: FoodDraft[] = [];
  let lastLocation: Pick<FoodDraft, "location" | "locationFrom"> | null = null;
  for (const p of parts) {
    const d = parseOne(p, today);
    if (!d) continue;
    // "...and three containers of stock to my freezer": a place said once covers the rest of the sentence.
    out.push(d);
    if (d.location && d.locationFrom === "said") lastLocation = d;
  }
  // The place said at the end of the sentence covers foods that didn't name one (not ones that said "frozen").
  if (lastLocation) for (const d of out) if (!d.location) { d.location = lastLocation.location; d.locationFrom = "said"; }
  return out;
}

