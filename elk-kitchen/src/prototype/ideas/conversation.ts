// SIMULATED conversation. This is keyword matching written for the prototype,
// not a language model. The UI says so on every reply. It exists so we can
// react to the *shape* of the interaction: short reply → recipe cards →
// a couple of next steps, and what the person said feeding back into the page.
//
// What a real version would send to a model is sketched in groundingFor().

import type { RecipeSummary } from "../../types/recipe";
import { upcomingHolidays, whenLabel } from "./context";
import { normName } from "./pantryMatch";
import { vegCount } from "./suggest";
import type { Answers, Moment, Mood, PantryItem, SampleIdea } from "./types";

export type Reply = {
  heard: string[];          // what the rules picked up, shown to the person
  text: string;
  sampleIds: string[];
  savedIds: string[];
  // Why each card is here, in terms of what the person said.
  why: Record<string, string>;
  chips: string[];          // suggested next things to say
  serves: number | null;    // cards open scaled to this many people
  moment: Partial<Moment>;
  answers: Answers;         // ingredients the person said they have
  understood: boolean;
};

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

export function peopleIn(text: string): number | null {
  const m = text.toLowerCase().match(/\b(?:for|feed|feeds|serves|serving)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
}

export function minutesIn(text: string): number | null {
  const m = text.toLowerCase().match(/\b(\d{1,3})\s*(?:min|mins|minutes)\b/);
  if (m) return Number(m[1]);
  if (/\b(half an hour)\b/i.test(text)) return 30;
  if (/\b(an hour|one hour)\b/i.test(text)) return 60;
  return null;
}

// Words a person might use → the sample ingredients that saying it confirms.
// "chicken" confirms chicken thighs/breasts but not chicken stock; "cheese"
// confirms nothing specific (cheddar? feta?) — it only steers the ranking.
const INGREDIENT_WORDS: { word: RegExp; label: string; confirms: string[]; matches: RegExp }[] = [
  { word: /\bblack beans?\b/, label: "black beans", confirms: ["black beans"], matches: /black beans/ },
  { word: /\bchickpeas?\b/, label: "chickpeas", confirms: ["chickpeas"], matches: /chickpea/ },
  { word: /\blentils?\b/, label: "lentils", confirms: ["red lentils"], matches: /lentil/ },
  { word: /\bchicken\b(?! stock| broth)/, label: "chicken", confirms: ["chicken thighs", "chicken breasts"], matches: /chicken (thigh|breast)/ },
  { word: /\bturkey\b/, label: "turkey", confirms: [], matches: /turkey/ },
  { word: /\bcheese\b/, label: "cheese", confirms: [], matches: /cheese|parmesan|feta/ },
  { word: /\bpeppers?\b/, label: "peppers", confirms: ["bell peppers", "bell pepper"], matches: /pepper(s)?$/ },
  { word: /\bcorn\b/, label: "corn", confirms: ["corn on the cob"], matches: /corn/ },
  { word: /\btomato(es)?\b/, label: "tomatoes", confirms: [], matches: /tomato/ },
  { word: /\bpasta\b/, label: "pasta", confirms: ["small pasta"], matches: /pasta/ },
  { word: /\brice\b/, label: "rice", confirms: ["rice"], matches: /^rice$/ },
  { word: /\boats\b/, label: "oats", confirms: ["rolled oats"], matches: /oats/ },
  { word: /\bpotato(es)?\b/, label: "potatoes", confirms: [], matches: /potato/ },
];

type Intent = { label: string; moods: Mood[]; why: string };

const INTENTS: { test: RegExp; intent: Intent }[] = [
  { test: /\b(snacks?|ski|trip|hike|hiking|road ?trip|lunch ?box|picnic|camping)\b/, intent: { label: "snacks to travel", moods: ["snack", "travels"], why: "snacks that pack well" } },
  { test: /\b(thanksgiving|christmas dinner|holiday dinner|feast)\b/, intent: { label: "a feast", moods: ["feast"], why: "a holiday table" } },
  { test: /\b(bbq|barbecue|grill|grilling)\b/, intent: { label: "BBQ", moods: ["bbq"], why: "things for the BBQ" } },
  { test: /\b(hot|heat ?wave|sweltering|scorching|warm out)\b/, intent: { label: "hot weather", moods: ["fresh", "no-cook", "bbq"], why: "light, fresh food that keeps the kitchen cool" } },
  { test: /\b(cold|freezing|chilly|cozy|cosy|comfort|rainy|snowing)\b/, intent: { label: "cold weather", moods: ["comfort"], why: "something warm and comforting" } },
  { test: /\b(healthy|vegetables?|veg|veggies|greens|light)\b/, intent: { label: "vegetables", moods: ["veg"], why: "meals that lean on vegetables" } },
  { test: /\b(protein)\b/, intent: { label: "protein", moods: ["protein"], why: "hearty, protein-rich meals" } },
  { test: /\b(quick|fast|hurry|no time|easy)\b/, intent: { label: "quick", moods: ["quick"], why: "quick ones" } },
  { test: /\b(make[- ]ahead|batch|freezer|freeze)\b/, intent: { label: "make-ahead", moods: ["make-ahead"], why: "things you can make ahead" } },
  { test: /\b(kids?|children|picky)\b/, intent: { label: "kids", moods: ["kids"], why: "family-friendly ones" } },
];

const EXAMPLES = [
  "I need snacks for Emi's ski trip.",
  "Help me plan Thanksgiving dinner for eight.",
  "It's hot outside. What should we BBQ?",
  "I have black beans and chicken.",
  "Something healthy with lots of vegetables.",
];
export { EXAMPLES as CONVERSATION_EXAMPLES };

function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// `previous` is the last thing the person asked. A follow-up that only adds a
// detail ("make them nut-free", "we only have 30 minutes") builds on it.
export function simulateReply(input: string, samples: SampleIdea[], saved: RecipeSummary[], today: string, previous = ""): Reply {
  let text = input.toLowerCase();
  const isRefinement = !INTENTS.some((i) => i.test.test(text)) && !INGREDIENT_WORDS.some((w) => w.word.test(text))
    && (peopleIn(text) !== null || minutesIn(text) !== null || /nut[- ]?free|no nuts/.test(text));
  if (isRefinement && previous) text = `${previous.toLowerCase()} ${text}`;
  const intents = INTENTS.filter((i) => i.test.test(text)).map((i) => i.intent);
  const ingredients = INGREDIENT_WORDS.filter((w) => w.word.test(text));
  const people = peopleIn(text);
  const minutes = minutesIn(text);
  const nutFree = /\b(nut[- ]?free|no nuts|allerg)/.test(text);

  const heard = [
    ...intents.map((i) => i.label),
    ...ingredients.map((i) => i.label),
    ...(people ? [`${people} people`] : []),
    ...(minutes ? [`${minutes} minutes`] : []),
    ...(nutFree ? ["nut-free"] : []),
  ];

  const moment: Partial<Moment> = {};
  if (intents.some((i) => i.label === "hot weather")) moment.weather = "hot";
  if (intents.some((i) => i.label === "cold weather")) moment.weather = /rain/.test(text) ? "rainy" : "cold";
  if (minutes) moment.minutes = minutes;
  if (people) moment.people = people;
  if (intents.some((i) => i.label === "BBQ")) moment.equipment = ["bbq"];

  const answers: Answers = {};
  if (/\b(i|we) (have|got|'ve got)\b|\bhave some\b|\bleftover\b/.test(text)) {
    for (const w of ingredients) for (const c of w.confirms) answers[normName(c)] = { said: w.label };
  }

  if (!heard.length) {
    return {
      heard, text: "I'm only a prototype, so I understand a handful of example requests. The real Kitchen would answer this using your recipes and what's in the Pantry. Try one of these:",
      sampleIds: [], savedIds: [], why: {}, chips: EXAMPLES, serves: null, moment, answers, understood: false,
    };
  }

  const isFeast = intents.some((i) => i.label === "a feast");
  const scored = samples.map((s) => {
    let score = 0;
    for (const i of intents) score += i.moods.filter((m) => s.moods.includes(m)).length * 2;
    for (const w of ingredients) if (s.ingredients.some((ing) => w.matches.test(ing.name))) score += 3;
    if (minutes && s.minutes > minutes) score -= 5;
    if (intents.some((i) => i.label === "vegetables")) score += vegCount(s) / 2;
    if (nutFree && s.moods.includes("nut") && !s.variations?.some((v) => /nut-free/i.test(v.ask))) score -= 10;
    if (intents.some((i) => i.label === "hot weather") && (s.moods.includes("comfort") || s.equipment.includes("oven"))) score -= 3;
    return { s, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.s.minutes - b.s.minutes);

  let picks: SampleIdea[];
  if (isFeast) {
    const main = scored.find((x) => x.s.course === "main")?.s;
    const sides = scored.filter((x) => x.s.course === "side").map((x) => x.s).slice(0, 2);
    picks = [main, ...sides].filter((x): x is SampleIdea => !!x);
  } else {
    picks = scored.slice(0, 3).map((x) => x.s);
  }

  const why: Record<string, string> = {};
  for (const p of picks) {
    const used = ingredients.filter((w) => p.ingredients.some((ing) => w.matches.test(ing.name))).map((w) => w.label);
    if (used.length) why[p.id] = `Uses ${list(used)}`;
  }
  const savedHits = saved.filter((r) => {
    const hay = `${r.title}\n${r.ingredients}\n${r.tags.join(" ")}`.toLowerCase();
    const used = ingredients.filter((w) => w.word.test(hay)).map((w) => w.label);
    if (used.length) why[r.id] = `Your recipe mentions ${list(used)}`;
    else if (isFeast && /thanksgiving|turkey|stuffing|gravy/.test(hay)) why[r.id] = "From your recipe book";
    return r.id in why;
  }).slice(0, 3);

  const lines: string[] = [];
  if (isFeast) {
    const holiday = upcomingHolidays(today).find((h) => /Thanksgiving/.test(h.name));
    lines.push(`Here's a classic table${people ? ` for ${people}` : ""}: a main and two sides.`);
    if (holiday) lines.push(`${holiday.name} is ${whenLabel(holiday.inDays, holiday.date)}.`);
    if (people) lines.push(`Each card opens scaled to ${people}.`);
  } else if (ingredients.length && Object.keys(answers).length) {
    lines.push(`With ${list(ingredients.map((i) => i.label))}, here are a few good directions. I've noted you have ${ingredients.length === 1 ? "that" : "those"} — I'll still ask about anything else.`);
  } else if (ingredients.length) {
    lines.push(`A few ideas with ${list(ingredients.map((i) => i.label))}.`);
  } else {
    lines.push(`Here are ${list(intents.map((i) => i.why))}.`);
  }
  if (nutFree) lines.push("For nut-free, open a card and tap “Nut-free” to see the swap.");
  if (!picks.length && !savedHits.length) lines.push("Nothing in this prototype's small set of ideas fits that — the real version would draw on far more.");

  const chips: string[] = [];
  if (intents.some((i) => i.label === "snacks to travel") && !nutFree) chips.push("Make them nut-free");
  if (isFeast) chips.push("Something make-ahead");
  if (intents.some((i) => i.label === "vegetables")) chips.push("More protein instead");
  if (!minutes) chips.push("We only have 30 minutes");
  if (ingredients.length === 0 && !isFeast) chips.push("I have black beans and chicken");

  return {
    heard, text: lines.join(" "), sampleIds: picks.map((p) => p.id), savedIds: savedHits.map((r) => r.id), why,
    chips: chips.slice(0, 3), serves: people, moment, answers, understood: true,
  };
}

// What a live version would ground the model in — shown in the UI under
// "What Kitchen would know" so the backend shape is visible. Built only from
// real inputs; nothing invented.
export function groundingFor(moment: Moment, pantry: PantryItem[], saved: RecipeSummary[], answers: Answers): string[] {
  const g: string[] = [`Today is ${moment.today}.`];
  g.push(!moment.weather ? "Weather: not known (only if you tap it, say it, or ask Kitchen to check)."
    : moment.weatherNote ? `Weather: ${moment.weatherNote}.` : `Weather: you said ${moment.weather}.`);
  if (moment.minutes) g.push(`Time: about ${moment.minutes} minutes.`);
  if (moment.people) g.push(`Cooking for ${moment.people}.`);
  if (moment.kids) g.push("Kids at the table.");
  if (moment.equipment.length) g.push(`Wants to use: ${moment.equipment.join(", ")}.`);
  g.push(pantry.length ? `Pantry: ${pantry.filter((p) => p.onHand > 0).length} products in stock (cupboard/freezer only — fridge unknown).` : "Pantry: not connected.");
  const yes = Object.entries(answers).flatMap(([k, v]) => (v === "yes" ? [k] : typeof v === "object" ? [v.said] : []));
  if (yes.length) g.push(`You said you have: ${[...new Set(yes)].join(", ")}.`);
  g.push(`Family recipe book: ${saved.length} recipe${saved.length === 1 ? "" : "s"}, ${saved.filter((r) => r.favourite).length} marked favourite by you.`);
  g.push("Preferences: none recorded — Kitchen won't assume any.");
  return g;
}

