// What a cut of meat usually is: species, fat and how much of the bought
// weight ends up usable. These are TYPICAL ESTIMATES (ranges vary by animal,
// butcher and trim) and every screen that shows one says so. A weight the
// person measured always replaces the estimate, and so does a fat % they type.
//
// Ranges are rounded from USDA FoodData Central (SR Legacy, raw, separable
// lean and fat; refuse = bone/skin) and common butchery practice. They are a
// starting point for the planner, not a measurement.

export type Species = "pork" | "beef" | "poultry" | "game" | "fat" | "other";

export type CutInfo = {
  key: string;
  label: string;
  species: Species;
  // Fat as a % of the usable meat (low–high, and the planner's working figure).
  fat: [number, number, number];
  // Usable meat as a % of the bought weight, before you measure it.
  usable: [number, number, number];
  // Shown beside the estimate.
  note: string;
};

const CUTS: (CutInfo & { match: RegExp })[] = [
  { key: "pork-back-fat", label: "Pork back fat", species: "fat", fat: [80, 90, 85], usable: [95, 100, 98], note: "Almost all fat.", match: /\b(back ?fat|fatback|pork fat)\b/ },
  { key: "pork-belly", label: "Pork belly", species: "pork", fat: [45, 60, 50], usable: [85, 100, 95], note: "Skin-on belly loses the rind.", match: /\bbelly\b/ },
  { key: "pork-butt", label: "Pork butt / shoulder", species: "pork", fat: [20, 30, 25], usable: [85, 98, 95], note: "Bone-in butt loses the blade bone (about 5–10%).", match: /\b(butt|boston|shoulder|picnic)\b/ },
  { key: "pork-tenderloin", label: "Pork tenderloin / loin", species: "pork", fat: [3, 10, 5], usable: [90, 100, 97], note: "Very lean.", match: /\b(tenderloin|loin|chop)\b/ },
  { key: "beef-eye-round", label: "Beef eye of round", species: "beef", fat: [3, 8, 5], usable: [92, 100, 97], note: "Very lean; trim the silverskin.", match: /\b(eye of round|eye round|round|sirloin tip|inside|outside|rump)\b/ },
  { key: "beef-chuck", label: "Beef chuck", species: "beef", fat: [15, 25, 20], usable: [85, 98, 93], note: "", match: /\b(chuck|blade|brisket|short rib|plate)\b/ },
  { key: "chicken-thigh-bone-skin", label: "Chicken thighs, bone-in skin-on", species: "poultry", fat: [12, 18, 15], usable: [65, 80, 72], note: "Bone is about a quarter of the weight. Weigh the meat (and any skin you keep) after boning.", match: /\bthigh/ },
  { key: "chicken-breast", label: "Chicken breast", species: "poultry", fat: [2, 5, 3], usable: [90, 100, 97], note: "Very lean.", match: /\bbreast\b/ },
  { key: "pork", label: "Pork (cut not named)", species: "pork", fat: [10, 30, 20], usable: [85, 100, 95], note: "Name the cut for a better estimate.", match: /\b(pork|ham|hog|pig)\b/ },
  { key: "beef", label: "Beef (cut not named)", species: "beef", fat: [5, 25, 15], usable: [85, 100, 95], note: "Name the cut for a better estimate.", match: /\b(beef|steak|ground beef)\b/ },
  { key: "poultry", label: "Chicken / turkey (cut not named)", species: "poultry", fat: [3, 18, 10], usable: [65, 100, 85], note: "Name the cut for a better estimate.", match: /\b(chicken|turkey|poultry|duck)\b/ },
  { key: "game", label: "Venison / game", species: "game", fat: [2, 6, 4], usable: [85, 100, 95], note: "Very lean; usually blended with pork fat.", match: /\b(venison|deer|elk|moose|bison|caribou|game)\b/ },
];

const OTHER: CutInfo = { key: "other", label: "Unknown cut", species: "other", fat: [0, 40, 20], usable: [60, 100, 90], note: "Kitchen doesn't know this cut. Enter the fat % and weigh the usable meat.", };

const lower = (s: string) => s.toLowerCase();

// Bone-in / skin-on words in the name change the thigh estimate only when said.
export function cutOf(name: string): CutInfo {
  const n = lower(name);
  if (/\bthigh/.test(n) && /\b(boneless|skinless)\b/.test(n)) {
    return { key: "chicken-thigh-boneless", label: "Chicken thighs, boneless skinless", species: "poultry", fat: [4, 10, 7], usable: [95, 100, 98], note: "" };
  }
  const hit = CUTS.find((c) => c.match.test(n));
  if (!hit) return OTHER;
  const { match: _m, ...info } = hit;
  return info;
}

export function speciesOf(text: string): Species[] {
  const out = new Set<Species>();
  for (const part of lower(text).split(/,|\band\b|\+|&|\//)) {
    const c = cutOf(part);
    if (c.species !== "other") out.add(c.species);
  }
  return [...out];
}

export const isPoultry = (text: string) => /\b(chicken|turkey|poultry|duck|goose|thigh|drumstick)\b/i.test(text);
