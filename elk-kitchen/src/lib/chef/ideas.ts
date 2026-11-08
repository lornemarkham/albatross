// Kitchen's own idea templates: well-known dishes that can be built from what
// the household has. This is what Kitchen offers when its AI is off, offline
// or unsure. It is rules, not AI, and is labelled "Kitchen idea" on the page.
//
// A template never claims an ingredient: each part is matched against the
// evidence in Knowledge (Pantry, recent cooking, what the person said). An
// unmatched part is "need" (shopping) or "optional". Basics (oil, salt) are
// listed as unchecked basics, as pantryCheck does. Amounts are a starting
// point for the dish, never Pantry quantities.

import type { Knowledge, Have } from "./knowledge";
import { findHave } from "./knowledge";
import { mentions } from "../pantryCheck";
import type { Occasion } from "./mentioned";

export type Meal = "snack" | "dinner" | "lunch" | "breakfast";

type Part = {
  role: string;
  // Words that count for this part; the first is the name used when buying it.
  any: string[];
  amount: string;
  optional?: boolean;
  basic?: boolean;
  // Words that look like a match but aren't ("black pepper" is not a pepper).
  not?: string[];
};

export type Template = {
  id: string;
  // "{main}" is replaced with the matched name of the part with role "main".
  title: string;
  meals: Meal[];
  occasions: Occasion[];
  minutes: number;
  serves: string;
  parts: Part[];
  steps: string[];
};

const SAUSAGE = ["sausage", "bratwurst", "brat", "kielbasa", "chorizo", "smokie", "hot dog", "frank", "wiener"];
const MEAT = [...SAUSAGE, "chicken", "pulled pork", "ground beef", "beef", "pork", "ham", "bacon", "turkey", "steak", "jerky"];
const CHEESE = ["cheese", "cheddar", "mozzarella", "monterey jack", "jack", "queso", "pepper jack", "colby", "swiss", "gouda"];
const PEPPERS = ["bell pepper", "peppers", "pepper", "jalapeño", "jalapeno", "poblano", "banana pepper"];
const NOT_PEPPER = ["black pepper", "pepper flake", "peppercorn", "cayenne", "white pepper", "pepper jack"];
const ONION = ["onion", "green onion", "scallion", "shallot"];
const CHIPS = ["nacho chips", "tortilla chips", "corn chips", "nachos", "chips"];

export const TEMPLATES: Template[] = [
  {
    id: "loaded-nachos", title: "Loaded {main} nachos", meals: ["snack", "dinner"], occasions: ["game day", "party", "movie night"], minutes: 25, serves: "4–6 as a snack",
    parts: [
      { role: "chips", any: CHIPS, amount: "1 large bag" },
      { role: "cheese", any: CHEESE, amount: "2 cups, shredded" },
      { role: "main", any: MEAT, amount: "2–3 links or about 300 g" },
      { role: "sour cream", any: ["sour cream", "crema", "greek yogurt"], amount: "for dolloping", optional: true },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1, sliced", optional: true },
      { role: "salsa", any: ["salsa", "pico de gallo", "tomato"], amount: "½ cup", optional: true },
      { role: "onion", any: ONION, amount: "a handful, sliced", optional: true },
      { role: "beans", any: ["black beans", "refried beans", "beans"], amount: "1 can, drained", optional: true },
    ],
    steps: [
      "Heat the oven to 200 °C (400 °F). Line a sheet pan.",
      "Cook the {main} first (sliced, in a hot pan) until browned and cooked through, then slice into coins.",
      "Spread the chips in one layer, scatter half the cheese, the {main} and any peppers, onion or beans, then the rest of the cheese.",
      "Bake 8–10 minutes until the cheese is melted and bubbling.",
      "Top with sour cream and salsa at the table so the chips stay crisp.",
    ],
  },
  {
    id: "queso-dip", title: "{main} queso dip", meals: ["snack"], occasions: ["game day", "party", "movie night"], minutes: 20, serves: "6 as a dip",
    parts: [
      { role: "cheese", any: CHEESE, amount: "2 cups, shredded" },
      { role: "main", any: MEAT, amount: "2 links or about 250 g, casings off" },
      { role: "dairy", any: ["cream cheese", "milk", "cream", "evaporated milk", "half and half"], not: ["sour cream", "ice cream"], amount: "½ cup milk or 120 g cream cheese" },
      { role: "dippers", any: CHIPS, amount: "for dipping", optional: true },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1–2, diced", optional: true },
      { role: "salsa", any: ["salsa", "rotel", "diced tomatoes", "tomato"], amount: "½ cup", optional: true },
    ],
    steps: [
      "Crumble the {main} into a pan and brown it until cooked through. Spoon off most of the fat.",
      "Lower the heat, add the milk (or cream cheese) and the peppers, then the cheese a handful at a time, stirring until smooth.",
      "Stir in salsa if you have it. Loosen with a splash of milk if it's thick.",
      "Serve warm with chips. Keep it on low heat (or in a small slow cooker) during the game.",
    ],
  },
  {
    id: "sausage-bites", title: "{main} bites with dipping sauces", meals: ["snack"], occasions: ["game day", "party"], minutes: 15, serves: "4–6 as a snack",
    parts: [
      { role: "main", any: SAUSAGE, amount: "4–6 links" },
      { role: "mustard", any: ["mustard", "dijon"], amount: "for dipping" },
      { role: "sauce", any: ["bbq sauce", "barbecue sauce", "honey", "maple syrup", "ketchup", "hot sauce"], amount: "for a sticky glaze", optional: true },
      { role: "sour cream", any: ["sour cream", "ranch", "greek yogurt"], amount: "for a cool dip", optional: true },
      { role: "cheese", any: CHEESE, amount: "cubed, for skewers", optional: true },
      { role: "oil", any: ["oil", "butter"], amount: "1 tbsp", basic: true },
    ],
    steps: [
      "Cook the {main} through (simmer, grill or pan-fry), then slice into thick coins.",
      "Brown the coins in a hot pan with a little oil. Toss in BBQ sauce or honey for the last minute if you like them sticky.",
      "Serve on toothpicks with cheese cubes, mustard and a sour-cream dip.",
    ],
  },
  {
    id: "quesadillas", title: "{main} and cheese quesadillas", meals: ["snack", "lunch", "dinner"], occasions: ["game day", "party", "weeknight", "movie night"], minutes: 20, serves: "4",
    parts: [
      { role: "tortillas", any: ["tortilla", "wrap", "flatbread"], amount: "4 large" },
      { role: "cheese", any: CHEESE, amount: "2 cups, shredded" },
      { role: "main", any: MEAT, amount: "2 links or about 250 g, cooked and sliced" },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1, sliced", optional: true },
      { role: "onion", any: ONION, amount: "½, sliced", optional: true },
      { role: "sour cream", any: ["sour cream", "salsa", "guacamole"], amount: "to serve", optional: true },
    ],
    steps: [
      "Cook the {main} through, slice thinly, and soften any peppers and onion in the same pan.",
      "Fill half of each tortilla with cheese and filling, fold, and cook in a dry pan 2–3 minutes a side until golden and melted.",
      "Cut into wedges. Serve with sour cream or salsa.",
    ],
  },
  {
    id: "sliders", title: "{main} sliders with peppers and onions", meals: ["snack", "dinner"], occasions: ["game day", "party"], minutes: 25, serves: "6–8 sliders",
    parts: [
      { role: "main", any: SAUSAGE, amount: "4 links" },
      { role: "buns", any: ["slider buns", "dinner rolls", "buns", "rolls", "hot dog buns", "bread"], amount: "8 small" },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1–2, sliced", optional: true },
      { role: "onion", any: ONION, amount: "1, sliced", optional: true },
      { role: "mustard", any: ["mustard", "sauerkraut", "relish"], amount: "to serve", optional: true },
      { role: "cheese", any: CHEESE, amount: "slices", optional: true },
    ],
    steps: [
      "Cook the {main} through and cut each link in half (or butterfly it).",
      "Fry the onions and peppers in the same pan until soft and browned.",
      "Pile into buns with cheese, then mustard or sauerkraut.",
    ],
  },
  {
    id: "potato-skins", title: "Loaded potato skins", meals: ["snack"], occasions: ["game day", "party"], minutes: 70, serves: "4–6 as a snack",
    parts: [
      { role: "potatoes", any: ["potato", "russet"], not: SAUSAGE, amount: "4 large baking potatoes" },
      { role: "cheese", any: CHEESE, amount: "1½ cups, shredded" },
      { role: "main", any: ["bacon", ...SAUSAGE, "ham", "pulled pork"], amount: "about 150 g, cooked and chopped", optional: true },
      { role: "sour cream", any: ["sour cream", "greek yogurt"], amount: "to serve", optional: true },
      { role: "onion", any: ["green onion", "scallion", "chive", "onion"], amount: "2 tbsp, sliced", optional: true },
      { role: "oil", any: ["oil", "butter"], amount: "2 tbsp", basic: true },
    ],
    steps: [
      "Bake the potatoes at 200 °C (400 °F) about 45 minutes until tender. Cool a little.",
      "Halve, scoop out most of the flesh (keep it for mash), brush the skins with oil and bake 10 more minutes until crisp.",
      "Fill with cheese and chopped meat, bake until melted, then top with sour cream and onion.",
    ],
  },
  {
    id: "pigs-in-blankets", title: "{main} in a blanket", meals: ["snack"], occasions: ["game day", "party", "holiday"], minutes: 30, serves: "24 pieces",
    parts: [
      { role: "main", any: SAUSAGE, amount: "6 links" },
      { role: "pastry", any: ["puff pastry", "crescent", "pastry", "pizza dough", "biscuit dough", "dough"], amount: "1 sheet or tube" },
      { role: "mustard", any: ["mustard", "dijon"], amount: "for brushing and dipping", optional: true },
      { role: "cheese", any: CHEESE, amount: "a little, grated", optional: true },
      { role: "egg", any: ["egg"], amount: "1, beaten", optional: true },
    ],
    steps: [
      "Cook raw {main} through first, cool, then cut each link into 4.",
      "Cut the pastry into strips, brush with mustard, sprinkle cheese, and roll each piece up.",
      "Brush with egg and bake at 200 °C (400 °F) 15–18 minutes until puffed and golden.",
    ],
  },
  {
    id: "sheet-pan", title: "Sheet-pan {main} with peppers and potatoes", meals: ["dinner"], occasions: ["weeknight"], minutes: 40, serves: "4",
    parts: [
      { role: "main", any: SAUSAGE, amount: "4–6 links" },
      { role: "potatoes", any: ["potato", "baby potato", "sweet potato"], not: SAUSAGE, amount: "600 g, in chunks" },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "2, in strips", optional: true },
      { role: "onion", any: ONION, amount: "1, in wedges", optional: true },
      { role: "oil", any: ["oil"], amount: "2 tbsp", basic: true },
    ],
    steps: [
      "Toss the potatoes with oil and salt; roast at 220 °C (425 °F) for 15 minutes.",
      "Add the {main}, peppers and onion; roast 20–25 minutes more, turning once, until the sausages are cooked through.",
    ],
  },
  {
    id: "sausage-pasta", title: "{main} pasta", meals: ["dinner"], occasions: ["weeknight"], minutes: 30, serves: "4",
    parts: [
      { role: "pasta", any: ["pasta", "penne", "rigatoni", "spaghetti", "macaroni", "noodle"], amount: "400 g" },
      { role: "main", any: MEAT, amount: "3–4 links or 400 g" },
      { role: "sauce", any: ["tomato", "crushed tomatoes", "pasta sauce", "marinara", "cream"], amount: "1 can or jar" },
      { role: "cheese", any: ["parmesan", ...CHEESE], amount: "to finish", optional: true },
      { role: "greens", any: ["spinach", "kale", "peppers", "peas"], not: NOT_PEPPER, amount: "a couple of handfuls", optional: true },
      { role: "onion", any: [...ONION, "garlic"], amount: "1 onion or 2 cloves garlic", optional: true },
    ],
    steps: [
      "Boil the pasta in salted water.",
      "Meanwhile brown the {main} (casings off, crumbled) until cooked through; add onion or garlic for a minute.",
      "Add the sauce and greens, simmer 5 minutes, then toss with the pasta and a splash of pasta water. Finish with cheese.",
    ],
  },
  {
    id: "breakfast-hash", title: "{main} breakfast hash", meals: ["breakfast", "dinner"], occasions: ["brunch", "camping"], minutes: 30, serves: "4",
    parts: [
      { role: "potatoes", any: ["potato", "hash brown", "sweet potato"], not: SAUSAGE, amount: "500 g, diced" },
      { role: "main", any: [...SAUSAGE, "bacon", "ham"], amount: "3 links or 250 g" },
      { role: "eggs", any: ["egg"], amount: "4" },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1, diced", optional: true },
      { role: "onion", any: ONION, amount: "1, diced", optional: true },
      { role: "cheese", any: CHEESE, amount: "a handful", optional: true },
      { role: "oil", any: ["oil", "butter"], amount: "2 tbsp", basic: true },
    ],
    steps: [
      "Fry the potatoes in oil until crisp and tender (12–15 minutes).",
      "Add the {main}, onion and peppers; cook until the meat is cooked through.",
      "Make 4 wells, crack in the eggs, cover and cook until set. Scatter cheese.",
    ],
  },
  {
    id: "frittata", title: "{main} frittata", meals: ["breakfast", "lunch", "dinner"], occasions: ["brunch", "weeknight"], minutes: 25, serves: "4",
    parts: [
      { role: "eggs", any: ["egg"], amount: "8" },
      { role: "main", any: [...MEAT, "spinach", "mushroom", "zucchini", "broccoli", "peppers"], not: NOT_PEPPER, amount: "about 2 cups, chopped" },
      { role: "cheese", any: CHEESE, amount: "1 cup", optional: true },
      { role: "dairy", any: ["milk", "cream", "sour cream"], amount: "¼ cup", optional: true },
      { role: "onion", any: ONION, amount: "1, sliced", optional: true },
    ],
    steps: [
      "Heat the oven to 190 °C (375 °F). Soften the onion and filling in an oven-safe pan; cook any raw meat through.",
      "Whisk eggs with the milk and half the cheese, pour over, and cook on the stove 3 minutes until the edges set.",
      "Top with the rest of the cheese and bake 12–15 minutes until just set in the middle.",
    ],
  },
  {
    id: "fried-rice", title: "{main} fried rice", meals: ["dinner", "lunch"], occasions: ["weeknight"], minutes: 20, serves: "3–4",
    parts: [
      { role: "rice", any: ["cooked rice", "leftover rice", "rice"], not: ["rice vinegar"], amount: "3–4 cups, cooked and cold" },
      { role: "main", any: MEAT, amount: "about 250 g, diced" },
      { role: "eggs", any: ["egg"], amount: "2–3", optional: true },
      { role: "veg", any: ["peas", "carrot", "frozen vegetables", "mixed vegetables", "peppers", "corn", "green onion"], not: NOT_PEPPER, amount: "1½ cups", optional: true },
      { role: "soy", any: ["soy sauce", "tamari"], amount: "2–3 tbsp" },
      { role: "oil", any: ["oil"], amount: "2 tbsp", basic: true },
    ],
    steps: [
      "Brown the {main} in a very hot pan with oil until cooked through; push aside.",
      "Scramble the eggs, add the vegetables, then the cold rice. Fry, tossing, until hot and a little crisp.",
      "Season with soy sauce.",
    ],
  },
  {
    id: "layered-dip", title: "Layered game-day dip", meals: ["snack"], occasions: ["game day", "party", "potluck"], minutes: 15, serves: "8 as a dip",
    parts: [
      { role: "sour cream", any: ["sour cream", "cream cheese", "greek yogurt"], amount: "1 cup" },
      { role: "cheese", any: CHEESE, amount: "1 cup, shredded" },
      { role: "beans", any: ["refried beans", "black beans", "beans"], amount: "1 can" },
      { role: "salsa", any: ["salsa", "tomato", "pico de gallo"], amount: "1 cup" },
      { role: "dippers", any: CHIPS, amount: "1 bag", optional: true },
      { role: "main", any: MEAT, amount: "250 g, cooked and crumbled", optional: true },
      { role: "onion", any: ["green onion", "scallion", "onion"], amount: "2, sliced", optional: true },
    ],
    steps: [
      "Spread the beans in a shallow dish (warm them first if you like).",
      "Layer sour cream, salsa, any cooked meat, then cheese and green onion.",
      "Serve with chips.",
    ],
  },
  {
    id: "stuffed-peppers", title: "{main}-stuffed peppers", meals: ["dinner"], occasions: ["weeknight"], minutes: 50, serves: "4",
    parts: [
      { role: "peppers", any: ["bell pepper", "peppers", "pepper", "poblano"], not: NOT_PEPPER, amount: "4 large" },
      { role: "main", any: [...SAUSAGE, "ground beef", "ground turkey", "beef"], amount: "400 g, casings off" },
      { role: "rice", any: ["rice", "cooked rice", "quinoa"], amount: "1½ cups cooked" },
      { role: "sauce", any: ["tomato", "pasta sauce", "salsa", "marinara"], amount: "1 cup" },
      { role: "cheese", any: CHEESE, amount: "1 cup", optional: true },
    ],
    steps: [
      "Halve and seed the peppers. Brown the {main} until cooked through; mix with the rice and half the sauce.",
      "Fill the peppers, top with the rest of the sauce and the cheese.",
      "Cover and bake at 190 °C (375 °F) 25 minutes, uncover and bake 10 more.",
    ],
  },
  {
    id: "flatbread-pizza", title: "{main} flatbread pizzas", meals: ["snack", "dinner"], occasions: ["game day", "movie night", "party", "weeknight"], minutes: 20, serves: "4",
    parts: [
      { role: "base", any: ["naan", "flatbread", "pita", "tortilla", "pizza dough", "pizza crust"], amount: "4" },
      { role: "cheese", any: ["mozzarella", ...CHEESE], amount: "2 cups, shredded" },
      { role: "sauce", any: ["pizza sauce", "pasta sauce", "tomato", "marinara", "bbq sauce"], amount: "½ cup" },
      { role: "main", any: MEAT, amount: "2 links or 200 g, cooked and sliced", optional: true },
      { role: "peppers", any: PEPPERS, not: NOT_PEPPER, amount: "1, sliced", optional: true },
      { role: "onion", any: ONION, amount: "½, sliced", optional: true },
    ],
    steps: [
      "Heat the oven to 220 °C (425 °F).",
      "Spread sauce on each base, then cheese, the cooked {main} and peppers.",
      "Bake 8–10 minutes until bubbling. Cut into strips.",
    ],
  },
  {
    id: "sausage-soup", title: "{main} and potato soup", meals: ["dinner", "lunch"], occasions: ["weeknight"], minutes: 40, serves: "4–6",
    parts: [
      { role: "main", any: SAUSAGE, amount: "3–4 links, sliced" },
      { role: "potatoes", any: ["potato"], not: SAUSAGE, amount: "4 medium, diced" },
      { role: "broth", any: ["broth", "stock", "bouillon"], amount: "1.5 L" },
      { role: "onion", any: [...ONION, "garlic"], amount: "1, diced", optional: true },
      { role: "greens", any: ["kale", "spinach", "cabbage"], amount: "2 handfuls", optional: true },
      { role: "dairy", any: ["cream", "milk", "half and half"], amount: "½ cup", optional: true },
    ],
    steps: [
      "Brown the sliced {main} in a pot; add the onion for a few minutes.",
      "Add potatoes and broth, simmer 20 minutes until tender.",
      "Stir in greens until wilted, then a splash of cream. Season to taste.",
    ],
  },
];

export type IdeaIngredient = {
  name: string;
  amount: string;
  // have: Kitchen has evidence (see `evidence`); need: no evidence; optional: nice to have, no evidence;
  // basic: oil, salt — not checked.
  status: "have" | "need" | "optional" | "basic";
  evidence: string;
  source: Have["source"] | null;
};

export type Idea = {
  id: string;
  kind: "kitchen-idea" | "ai-generated";
  title: string;
  why: string[];
  minutes: number | null;
  serves: string;
  ingredients: IdeaIngredient[];
  steps: string[];
  safety: string[];
  // Names to offer for the shopping list: what's needed, then nice-to-haves (unticked).
  missing: string[];
  niceToHave: string[];
  // Who it suits or doesn't, from what family members recorded (filled in by chef.ts).
  familyNotes: string[];
  score: number;
};

export type IdeaAsk = { meal: Meal | null; occasion: Occasion | null; snack: boolean; quick: boolean; avoid: string[] };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A recently made sausage is raw unless the record says otherwise: say so plainly.
export function safetyFor(ingredients: IdeaIngredient[]): string[] {
  const out: string[] = [];
  const sausage = ingredients.find((i) => i.status === "have" && SAUSAGE.some((w) => i.name.toLowerCase().includes(w)));
  if (sausage) out.push(`${cap(sausage.name)}: homemade sausage is fresh, raw sausage — cook it to 71 °C / 160 °F inside (74 °C / 165 °F if it has chicken in it) before slicing it into anything.`);
  if (ingredients.some((i) => i.status === "have" && /chicken|turkey/i.test(i.name))) out.push("Poultry: cook to 74 °C / 165 °F.");
  return out;
}

export function buildIdea(t: Template, k: Knowledge, ask: IdeaAsk): Idea | null {
  const ings: IdeaIngredient[] = [];
  let main = "";
  let score = 0;
  let matchedCore = 0;
  const why: string[] = [];
  const used = new Set<string>();
  for (const p of t.parts) {
    const hit: Have | null = p.basic ? null : findHave(k, p.any, p.not ?? [], used);
    if (hit) used.add(hit.name.trim().toLowerCase().replace(/\s+/g, " "));
    if (p.basic) { ings.push({ name: p.any[0], amount: p.amount, status: "basic", evidence: "a kitchen basic — not checked", source: null }); continue; }
    if (hit) {
      const name = hit.name;
      if (p.role === "main") main = name;
      ings.push({ name, amount: p.amount, status: "have", evidence: hit.evidence, source: hit.source });
      score += p.optional ? 1 : 3;
      if (!p.optional) matchedCore++;
      if (hit.source === "said") score += 1.5;
      if (hit.source === "recent") { score += 3; why.push(`Uses the ${name.toLowerCase()} — ${hit.evidence.split(" — ")[0].toLowerCase()}.`); }
      if (hit.wantUsed) { score += 3; why.push(`Uses up the ${name.toLowerCase()} you wanted to use.`); }
      else if (hit.daysLeft != null && hit.daysLeft <= 4) { score += 2.5; why.push(`Uses the ${name.toLowerCase()} — ${hit.evidence.split(" · ").pop()}.`); }
      else if (hit.opened) { score += 1.5; why.push(`Uses the opened ${name.toLowerCase()}.`); }
    } else {
      const old = k.expired.find((h) => p.any.some((w) => mentions(h.name, w)) && !(p.not ?? []).some((n) => mentions(h.name, n)));
      const evidence = old ? `Inventory's ${old.name.toLowerCase()} is past its best-before — check it, or get more`
        : p.optional ? "nice to have" : k.pantryConnected ? "not in Inventory and you didn't mention it" : "you didn't mention it (Inventory isn't connected)";
      ings.push({ name: p.any[0], amount: p.amount, status: p.optional ? "optional" : "need", evidence, source: null });
      if (!p.optional) score -= 2.5;
    }
  }
  if (matchedCore < 2) return null; // not "from what you have"
  if (ask.avoid.some((a) => ings.some((i) => i.status !== "optional" && i.name.toLowerCase().includes(a)))) return null;
  if (ask.occasion && t.occasions.includes(ask.occasion)) score += 4;
  if (ask.snack && t.meals.includes("snack")) score += 3;
  if (ask.meal && t.meals.includes(ask.meal)) score += 2;
  if (ask.snack && !t.meals.includes("snack")) score -= 4;
  if (ask.quick && t.minutes <= 30) score += 1.5;
  if (ask.quick && t.minutes > 45) score -= 3;
  const fill = (s: string) => s.replace(/\{main\}/g, main ? main.toLowerCase() : "meat");
  const title = cap(fill(t.title).replace(/^meat /i, "").replace(/\bmeat-stuffed\b/i, "Stuffed"));
  const need = ings.filter((i) => i.status === "need");
  const core = ings.filter((_, n) => !t.parts[n].optional && !t.parts[n].basic);
  const coreHave = core.filter((i) => i.status === "have");
  const extras = ings.filter((i, n) => t.parts[n].optional && i.status === "have");
  why.unshift(`You have ${coreHave.length} of the ${core.length} main ingredients${coreHave.length ? ` (${coreHave.map((i) => i.name.toLowerCase()).join(", ")})` : ""}${extras.length ? `, plus ${extras.map((i) => i.name.toLowerCase()).join(", ")}` : ""}.`);
  if (ask.occasion && t.occasions.includes(ask.occasion)) why.push(`A ${ask.occasion} favourite.`);
  return {
    id: `idea:${t.id}`, kind: "kitchen-idea", title, why: [...new Set(why)], minutes: t.minutes, serves: t.serves,
    ingredients: ings, steps: t.steps.map(fill), safety: safetyFor(ings),
    missing: need.map((i) => i.name), niceToHave: ings.filter((i) => i.status === "optional").map((i) => i.name).slice(0, 3), familyNotes: [],
    score: Math.round(score * 10) / 10,
  };
}

export function kitchenIdeas(k: Knowledge, ask: IdeaAsk, count = 3): Idea[] {
  return TEMPLATES.map((t) => buildIdea(t, k, ask)).filter((x): x is Idea => !!x)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, count);
}
