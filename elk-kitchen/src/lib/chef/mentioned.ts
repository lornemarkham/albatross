// What someone *says* about their food, in plain rules (not AI):
//   "I made bratwurst yesterday."            → made: bratwurst (yesterday)
//   "I also have nacho chips and cheese."    → have: nacho chips, cheese
//   "There's half a bag of cheese."          → have: cheese, amount "half a bag" (their words)
//   "I found some peppers."                  → have: peppers
//   "We need to use the sour cream."         → use: sour cream
//
// These are the person's words for this conversation only. They are never
// stock: nothing here is written to ELK Inventory unless the person later
// confirms it on the "Add to Inventory?" card. Amounts are kept exactly as
// said ("half a bag") and never turned into numbers.

export type MentionIntent = "have" | "use" | "made";

export type Mentioned = {
  name: string;
  // As said: "half a bag", "some", "2". Empty when nothing was said.
  amount: string;
  intent: MentionIntent;
  // "yesterday", "last night", "on Saturday" — as said; empty if not said.
  when: string;
  // "fridge", "freezer"… if they said where it is.
  where: string;
  // The sentence it came from, word for word.
  said: string;
};

const WHEN = /\s*\b(yesterday|last night|this morning|earlier( today)?|today|tonight|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|last (week|weekend)|(\d+|a couple of|two|three) days ago|the other day)\b/;
const WHERE = /\s*\b(in|on|at the back of) (the |our )?(fridge|refrigerator|freezer|chest freezer|deep freezer|pantry|cupboard|cooler|garage)\b/;
// Where a list of foods ends: the rest of the sentence is about something else.
const TAIL = /\s+\b(what|which|how|can|could|should|would|give|make|for|to make|so|that (we|i)|because|if|but|left over from|from (the )?(sausage day|last)|please|any ideas|ideas)\b.*$/;
const CLAUSE = /\s*(?:,|\band\b|\bbut\b)?\s*\b(?:there's|there is|there are|i|we|i've|we've|i'm|we're)\b.*$/;
const AMOUNT = /^(half (a|an) ([a-z]+ )?(of )?|a (bag|box|jar|can|tin|tub|block|pack|package|packet|bottle|bunch|head|handful|carton|loaf|tray|bowl|container|pound|lb|kilo|couple|few) (of )?|(a )?(little|lot|bit) (of )?|lots of |some |a few |a couple (of )?|plenty of |loads of |tons of |several |(\d+(\.\d+)?|one|two|three|four|five|six|a dozen|dozen) ((bags?|boxes|box|jars?|cans?|tins?|tubs?|blocks?|packs?|packages?|packets?|bottles?|bunch(es)?|heads?|links?|pounds?|lbs?|kilos?|kg|g|grams?|cups?|dozen|containers?|trays?|loaves) (of )?)?)/;
const FILLER = /^(the|our|my|that|those|these|this|any|some|of|leftover|left over|left-over|extra|an?|also|still)\s+/;
const NOT_FOOD = /^(what|something|anything|stuff|food|it|them|everything|nothing|time|people|kids|guests|friends|ideas?|a (party|game|game day)|game day|the game|company|no idea|to|you|an hour|\d+ minutes?)$/;

const clean = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

function items(list: string, intent: MentionIntent, sentence: string, when: string, where: string): Mentioned[] {
  return list
    // A new clause ("…and there's half a bag of cheese", "…and I found peppers") is read on its own.
    .replace(CLAUSE, "")
    .replace(TAIL, "")
    .split(/,|\band\b|&|\bplus\b|\bas well as\b/)
    .flatMap((part) => {
      let t = part.trim().replace(/[.!?]+$/, "");
      const w = WHERE.exec(t);
      const at = w ? w[3] : where;
      if (w) t = t.replace(WHERE, "");
      const wh = WHEN.exec(t);
      const time = wh ? wh[1] : when;
      if (wh) t = t.replace(WHEN, "");
      for (let i = 0; i < 3; i++) t = t.replace(FILLER, "");
      const a = AMOUNT.exec(t);
      const amount = a ? a[0].replace(/\s+of\s*$/, "").trim() : "";
      if (a) t = t.slice(a[0].length);
      for (let i = 0; i < 3; i++) t = t.replace(FILLER, "");
      t = t.replace(/\s+(left|in there|too|as well|also)$/, "").trim();
      if (t.length < 2 || t.length > 40 || NOT_FOOD.test(t) || /^(some|a|an)$/.test(t)) return [];
      return [{ name: t, amount: amount === "some" ? "" : amount, intent, when: time, where: at, said: sentence.trim() }];
    });
}

// Every food mentioned, in order, without duplicates (a later mention of the same food wins its details).
export function parseMentions(text: string): Mentioned[] {
  const out: Mentioned[] = [];
  const sentences = text.replace(/[’']/g, "'").split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const raw of sentences) {
    const s = ` ${clean(raw)} `;
    const when = (WHEN.exec(s)?.[1] ?? "").trim();
    const where = (WHERE.exec(s)?.[3] ?? "").trim();
    // made: "I made bratwurst yesterday", "we smoked a batch of jerky"
    for (const m of s.matchAll(/\b(?:i|we) (?:just |also )?(?:made|cooked|smoked|baked|grilled|roasted|stuffed|did) (?:up )?(?:a batch of |some |the |a |an )?([a-z0-9 ,&'-]+?)(?=\s*(?:yesterday|last night|this morning|earlier|today|on \w+day|last week|last weekend|\d+ days ago|the other day|[.!?]|$|\s+(?:and )?(?:i|we) ))/g)) {
      out.push(...items(m[1], "made", raw, when, where));
    }
    // use: "we need to use the sour cream", "use up the peppers", "the spinach needs using"
    for (const m of s.matchAll(/\b(?:need to|have to|got to|gotta|want to|should|must) use (?:up )?([a-z0-9 ,&'-]+)/g)) out.push(...items(m[1], "use", raw, when, where));
    for (const m of s.matchAll(/(?:^|\s)use up ([a-z0-9 ,&'-]+)/g)) out.push(...items(m[1], "use", raw, when, where));
    for (const m of s.matchAll(/\b(?:the |our |some |that )?([a-z][a-z '-]{1,30}?) (?:needs?|has to|have to) (?:be )?(?:used|using|eaten)/g)) out.push(...items(m[1], "use", raw, when, where));
    // have: "I also have nacho chips", "there's half a bag of cheese", "I found some peppers"
    for (const m of s.matchAll(/\b(?:(?:i|we)(?: also| still| just)? (?:have|'ve got|have got|got|found|bought|picked up|grabbed)|i've got|we've got|i've also got|we've also got|there's|there is|there are|we've still got|got some)\s+(?:also\s+)?([a-z0-9 ,&'-]+?)(?=\s*(?:,|\band\b|\bbut\b)?\s*\b(?:there's|there is|there are|i|we|i've|we've)\b|\s*[.!?]|\s*$)/g)) {
      if (/^(no|nothing|none|to|time|an? (hour|idea)|\d+ min|people|guests|friends|company)\b/.test(m[1].trim())) continue;
      out.push(...items(m[1], "have", raw, when, where));
    }
  }
  const byName = new Map<string, Mentioned>();
  for (const m of out) {
    const k = m.name;
    const prev = byName.get(k);
    // "made" beats "use" beats "have" for the same food in one message.
    const rank = { made: 3, use: 2, have: 1 } as const;
    if (!prev || rank[m.intent] >= rank[prev.intent]) byName.set(k, { ...m, amount: m.amount || prev?.amount || "", when: m.when || prev?.when || "", where: m.where || prev?.where || "" });
  }
  return [...byName.values()];
}

// Occasions and dish shapes the person asked for ("game day", "snacks").
export type Occasion = "game day" | "party" | "movie night" | "potluck" | "picnic" | "date night" | "brunch" | "camping" | "weeknight" | "holiday";
export function parseOccasion(text: string): { occasion: Occasion | null; snack: boolean } {
  const t = ` ${clean(text)} `;
  const occasion: Occasion | null =
    /\b(game ?day|the game|football|hockey|super ?bowl|grey cup|playoffs?|tailgate|watching the)\b/.test(t) ? "game day"
    : /\bmovie night|movies?\b/.test(t) ? "movie night"
    : /\bpot ?luck\b/.test(t) ? "potluck"
    : /\bpicnic\b/.test(t) ? "picnic"
    : /\bdate night|romantic\b/.test(t) ? "date night"
    : /\bcamping|campfire\b/.test(t) ? "camping"
    : /\b(christmas|thanksgiving|easter|new year)\b/.test(t) ? "holiday"
    : /\bbrunch\b/.test(t) ? "brunch"
    : /\b(party|guests|company coming|people over|crowd)\b/.test(t) ? "party"
    : /\bweeknight\b/.test(t) ? "weeknight"
    : null;
  const snack = /\b(snacks?|appetizers?|apps|finger food|nibbles|dips?|munchies|platter|bites)\b/.test(t) || occasion === "game day" || occasion === "movie night";
  return { occasion, snack };
}
