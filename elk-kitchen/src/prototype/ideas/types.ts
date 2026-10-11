// "What should we cook?" prototype — shared shapes.
//
// Everything in src/prototype is an isolated experiment (see
// docs/prototypes/WHAT-SHOULD-WE-COOK.md). It reads the family's real recipes
// but never writes anything.

// Where a fact came from. Every number or claim on screen carries one of
// these, so a guess can never pass for something someone checked (doctrine §5, §6).
export type Provenance =
  | "pantry"      // ELK Pantry has a record of it
  | "you-said"    // the person told Kitchen just now (this visit only)
  | "entered"     // typed into a recipe by a family member; source not recorded
  | "verified"    // from a named nutrition source
  | "estimated";  // calculated or AI-matched; always shown as an estimate

// Ingredient on a structured sample idea. Real family recipes are still free
// text (doctrine C5), so only the prototype's samples have this shape.
export type Ingredient = {
  qty: number | null;
  unit: string;          // "" for countable things ("2 onions")
  name: string;
  // pantry: the sort of thing ELK Pantry tracks (cans, jars, dry goods, freezer)
  // fresh:  fridge/produce — Pantry usually won't know, so Kitchen asks
  // basic:  salt, oil, pepper — listed, never checked or claimed
  kind: "pantry" | "fresh" | "basic";
  // Product names this could match in Pantry (Pantry matches by name only).
  pantryNames?: string[];
  protein?: boolean;
  veg?: boolean;
};

export type Mood =
  | "quick" | "bbq" | "protein" | "veg" | "comfort" | "fresh" | "kids"
  | "snack" | "travels" | "make-ahead" | "feast" | "no-cook" | "nut";

export type Equipment = "oven" | "stovetop" | "bbq" | "slow-cooker" | "none";

// A suggestion Kitchen might make that isn't (yet) a family recipe. Written by
// hand for this prototype; standard home-cooking dishes, not copied recipes.
export type SampleIdea = {
  id: string;
  title: string;
  blurb: string;
  emoji: string;
  palette: [string, string];  // gradient stops for the illustrated tile
  serves: number;
  minutes: number;            // rough, hands-on + cooking
  equipment: Equipment[];
  moods: Mood[];
  course?: "main" | "side" | "snack" | "dessert";
  ingredients: Ingredient[];
  steps: string[];
  // Hand-written examples of what an AI-assisted change could look like.
  variations?: { ask: string; changes: string[] }[];
};

// Snapshot of what ELK Pantry knows, shaped like Inventory's PantrySummary
// (elk-inventory src/lib/pantryModel.ts) minus what Kitchen doesn't need.
export type PantryItem = {
  name: string;
  onHand: number;             // whole numbers only in Pantry today
  unit: string;               // free text, no conversion
  bestBefore: string | null;  // earliest open batch, YYYY-MM-DD
  location: string;
};

export type Weather = "hot" | "mild" | "cold" | "rainy";

// What the person has told Kitchen this visit. Nothing here is stored.
export type Moment = {
  today: string;              // YYYY-MM-DD, from the device clock
  weather: Weather | null;    // only ever what the person tapped
  minutes: number | null;
  equipment: Equipment[];     // what they said they want to use
  people: number | null;
  kids: boolean;              // "kids at the table" — only if they tapped it
  // Where the weather came from, shown next to it: null when the person
  // tapped it, or e.g. "12°C, rain · Open-Meteo" when they asked us to look.
  weatherNote: string | null;
};

// The person's answers to "Do you have cheese?" — this visit only. A "yes"
// from conversation keeps their own words ("chicken"), so Kitchen can say
// exactly what they told it and no more.
export type Answer = "yes" | "no" | { said: string };
export type Answers = Record<string, Answer>;
