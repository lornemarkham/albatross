// What someone asked Kitchen, in plain rules (not AI): the same words always
// mean the same thing, and what was *said* is kept apart from what ELK
// Pantry *shows* — "we have chicken" is the person's word, never stock.

export type Diet = "vegetarian" | "vegan" | "gluten-free" | "dairy-free";

export type Ask = {
  text: string;
  // ideas: suggest meals · going-off: what needs using · shopping: a list request
  kind: "ideas" | "going-off" | "shopping";
  count: number;
  meal: "dinner" | "lunch" | "breakfast" | null;
  minutes: number | null;
  quick: boolean;
  // Ingredients the person wants to use up ("the leftover chicken").
  use: string[];
  leftover: boolean;
  // Ingredients the person says they have (their word, not Pantry's).
  said: string[];
  avoid: string[];
  diet: Diet[];
  // "the family will like", "favourites", "the kids will eat"
  familyLikes: boolean;
  // "with what we have", "from the pantry"
  fromPantry: boolean;
  people: number | null;
};

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w] ?? null);

// Words that end an ingredient phrase ("chicken tonight", "rice for dinner").
const STOP = /\b(tonight|today|for|before|soon|this|that|please|so|in|on|which|we|i|it|to|and then|because|now|up|by)\b.*$/;
const FILLER = /^(the|some|a|an|our|my|that|those|these|this|any|of|leftover|left over|left-over)\s+/;

function cleanList(phrase: string): string[] {
  return phrase
    .replace(STOP, "")
    .split(/,|\band\b|\bor\b|&|\bplus\b/)
    .map((s) => {
      let t = s.trim().toLowerCase().replace(/[.!?]+$/, "");
      for (let i = 0; i < 4; i++) t = t.replace(FILLER, "");
      return t.trim();
    })
    .filter((s) => s.length > 1 && s.length < 40 && !/^(what|something|anything|stuff|food|it|them|everything)$/.test(s));
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function parseAsk(text: string): Ask {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim()} `;
  const ask: Ask = {
    text: text.trim(), kind: "ideas", count: 3, meal: null, minutes: null, quick: false, use: [], leftover: false,
    said: [], avoid: [], diet: [], familyLikes: false, fromPantry: false, people: null,
  };

  if (/\bshopping\b|\bgrocer(y|ies)\b|\bwe('re| are) (out of|low on|running low on|nearly out of)|\bwe need to (buy|get)\b|\bbuy more\b/.test(t)) ask.kind = "shopping";
  else if (/\b(going (bad|off)|go(es)? (bad|off)|expir|use (it )?soon|needs? (using|to be used)|best before|about to turn|spoil)/.test(t)) ask.kind = "going-off";

  const count = /\b(\d+|one|two|three|four|five|six|couple|few)\s+(dinner |meal |lunch |quick |easy |healthy |different )*(ideas?|options?|meals?|dinners?|suggestions?|recipes?|things)\b/.exec(t);
  if (count) ask.count = Math.max(1, Math.min(6, num(count[1]) ?? 3));

  if (/\b(dinner|tonight|supper|evening)\b/.test(t)) ask.meal = "dinner";
  else if (/\blunch\b/.test(t)) ask.meal = "lunch";
  else if (/\b(breakfast|brunch)\b/.test(t)) ask.meal = "breakfast";

  const mins = /\b(\d{1,3})\s*(-| )?(min|mins|minutes)\b/.exec(t);
  const hours = /\b(an|one|1|two|2) (hour|hours)\b/.exec(t);
  if (mins) ask.minutes = Number(mins[1]);
  else if (/\bhalf an hour\b/.test(t)) ask.minutes = 30;
  else if (hours) ask.minutes = (num(hours[1]) ?? (hours[1] === "an" ? 1 : 1)) * 60;
  ask.quick = (ask.minutes != null && ask.minutes <= 30) || /\b(quick|fast|easy|no time|in a hurry|rushed|simple)\b/.test(t);

  const people = /\bfor (\d+|two|three|four|five|six|seven|eight|nine|ten)( people| of us)?\b/.exec(t);
  if (people && !/\bfor \d+\s*(min|minutes|hour)/.test(t)) ask.people = num(people[1]);

  ask.leftover = /\bleft ?-?overs?\b/.test(t);
  const use = /\buse (up )?(the |our |some |that |those )?(left ?-?over )?([a-z ,&'-]+)/.exec(t);
  if (use && !/^(it|them|what|something|up what)\b/.test(use[4]) && !/^(soon|before)/.test(use[4])) ask.use = cleanList(use[4]);
  const leftoverOf = /\bleft ?-?over ([a-z ,&'-]+)/.exec(t);
  if (leftoverOf) ask.use = uniq([...ask.use, ...cleanList(leftoverOf[1])]);
  const lfFirst = /\b([a-z]+) left ?-?overs?\b/.exec(t);
  if (lfFirst && !/^(the|some|our|any|of|use|with|what|have)$/.test(lfFirst[1])) ask.use = uniq([...ask.use, lfFirst[1]]);

  const said = /\b(we have|we've got|we got|i have|i've got|there's|there is|got some|we still have)\s+([a-z ,&'-]+)/.exec(t);
  if (said && !/^(no|nothing|none|to|time|\d+ min)/.test(said[2])) ask.said = cleanList(said[2]).filter((x) => !/^(minutes?|time|people|kids)$/.test(x));

  const avoid = /\b(no|without|not|avoid|nothing with|skip the|hold the)\s+([a-z ,&'-]+)/g;
  for (const m of t.matchAll(avoid)) {
    if (/^(time|idea|clue|more than|one|too|very|so|longer|later)\b/.test(m[2])) continue;
    ask.avoid = uniq([...ask.avoid, ...cleanList(m[2]).filter((x) => !/^(much|too|very|longer)\b/.test(x))]);
  }

  if (/\bvegan\b/.test(t)) ask.diet.push("vegan");
  if (/\bvegetarian|veggie|meat-?free|no meat\b/.test(t)) ask.diet.push("vegetarian");
  if (/\bgluten-?free|no gluten\b/.test(t)) ask.diet.push("gluten-free");
  if (/\bdairy-?free|no dairy|lactose\b/.test(t)) ask.diet.push("dairy-free");
  ask.avoid = ask.avoid.filter((a) => !/^(meat|gluten|dairy)$/.test(a));

  ask.familyLikes = /\b(family|kids?|everyone|everybody|the boys|the girls|we all) (will |would )?(like|love|enjoy|eat)|\bfavou?rites?\b|\bcrowd.?pleaser\b/.test(t);
  ask.fromPantry = /\b(with |from )?what we (have|'ve got|got)\b|\bfrom the (pantry|freezer|fridge|cupboard)\b|\bwithout (going )?shopping\b/.test(t);
  return ask;
}

// What Kitchen understood, shown under the reply so nothing is hidden.
export function heard(a: Ask): string[] {
  const out: string[] = [];
  if (a.kind === "going-off") out.push("what needs using");
  if (a.meal) out.push(a.meal);
  if (a.count !== 3) out.push(`${a.count} ideas`);
  if (a.minutes) out.push(`${a.minutes} minutes`);
  else if (a.quick) out.push("quick");
  if (a.people) out.push(`${a.people} people`);
  if (a.use.length) out.push(`use up ${a.use.join(", ")}`);
  else if (a.leftover) out.push("leftovers");
  if (a.said.length) out.push(`you have ${a.said.join(", ")}`);
  if (a.avoid.length) out.push(`no ${a.avoid.join(", ")}`);
  out.push(...a.diet);
  if (a.familyLikes) out.push("family favourites");
  if (a.fromPantry) out.push("from what's in Pantry");
  return out;
}
