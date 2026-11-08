// What Kitchen has learned about the family's tastes — person by person first,
// then the household. Built only from what people recorded: their dinner
// ratings and detail scores, "make it again?", "next time" notes, comments,
// Sausage Day tasting cards, food notes, favourites and recipe versions.
//
// Doctrine §4: nothing is invented. A household favourite needs at least two
// people's ratings, all of them good; one person's rating is that person's, never "the family's".
// Seasoning leanings are quoted from what someone wrote, with their name.
// A version only "worked" when the people who rated both rated it higher.

import type { MealFeedback, MemberProfile } from "../../types/feedback";
import type { RecipeSummary } from "../../types/recipe";
import type { Tasting } from "../sausage/tasting";
import type { VersionLink } from "../sausage/versions";
import { avoidList } from "../familyMemory";

export type Leaning = { about: string; direction: "less" | "more"; quote: string; recipeTitle: string };

export type PersonTaste = {
  name: string;
  favourites: { recipeId: string; title: string; rating: number | null }[];
  notForMe: { recipeId: string; title: string; why: string }[];
  avoids: string[];
  likes: string;
  leanings: Leaning[];
  ratings: number;
};

export type HouseholdTaste = {
  people: PersonTaste[];
  // Rated by 2+ people, averaging 7.5+, each of them 7 or more, nobody said "not again".
  favourites: { recipeId: string; title: string; average: number; raters: string[] }[];
  // Someone loved it (8+ or "yes") and someone else didn't (≤4 or "not again").
  split: { recipeId: string; title: string; loved: string[]; not: string[] }[];
  // Everyone who answered said "yes, again" (2+ people), or a favourite rated 8+.
  worthRepeating: { recipeId: string; title: string; why: string }[];
  // A newer version the same people rated higher than the one it came from.
  improvedVersions: { recipeId: string; title: string; parentId: string; parentTitle: string; reason: string; before: number; after: number }[];
};

type Say = { name: string; recipeId: string; rating: number | null; makeAgain: "yes" | "maybe" | "no" | null; texts: string[]; at: string };

const ABOUT: [RegExp, string][] = [
  [/\bsalt(y|ier|iness)?\b/, "salt"], [/\b(spic(e|y|ier)|heat|hot(ter)?|cayenne|chil(i|li)|jalape)/, "heat"], [/\bgarlic(ky)?\b/, "garlic"],
  [/\bsweet(er|ness)?\b|\bsugar\b|\bmaple\b/, "sweetness"], [/\bsmok(e|y|ier)\b/, "smoke"], [/\bfat(ty|tier)?\b/, "fat"],
  [/\bpepper(y)?\b/, "pepper"], [/\bseason(ing|ed)?\b|\bflavou?r\b/, "seasoning"], [/\bsage\b|\bherbs?\b|\bfennel\b|\bnutmeg\b|\bmace\b/, "herbs and spices"],
];

// "a little less salt", "needs more heat", "too salty" → leanings, quoted.
export function leaningsIn(text: string, recipeTitle: string): Leaning[] {
  const out: Leaning[] = [];
  for (const sentence of text.split(/[.;!\n]|\bbut\b/)) {
    const s = sentence.toLowerCase().trim();
    if (!s) continue;
    const less = /\b(less|fewer|not as|cut( back)?( on)?|reduce|too( much)?|halve|half the|lighter on|go easy on|tone down)\b/.test(s);
    const more = /\b(more|extra|double|add( a bit| some)?|not enough|needs?|bump up|heavier on|could use)\b/.test(s);
    if (less === more) continue;
    for (const [re, about] of ABOUT) {
      if (re.test(s)) { out.push({ about, direction: less ? "less" : "more", quote: sentence.trim(), recipeTitle }); break; }
    }
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);
const key = (name: string) => name.trim().toLowerCase() || "someone";

export function familyTaste(args: {
  recipes: Pick<RecipeSummary, "id" | "title" | "favourite">[];
  feedback: MealFeedback[];
  tastings?: Tasting[];
  profiles?: MemberProfile[];
  versions?: VersionLink[];
}): HouseholdTaste {
  const title = new Map(args.recipes.map((r) => [r.id, r.title]));
  const says: Say[] = [
    ...args.feedback.map((f) => ({ name: f.authorName || "Someone", recipeId: f.recipeId, rating: f.rating, makeAgain: f.makeAgain, texts: [f.comment, f.improvement], at: f.updatedAt || f.createdAt })),
    ...(args.tastings ?? []).map((t) => ({ name: t.author, recipeId: t.recipeId, rating: t.scores.overall, makeAgain: t.makeAgain, texts: [t.change, t.notes], at: t.updatedAt || t.createdAt })),
  ].filter((s) => title.has(s.recipeId));

  // Each person's latest say per recipe (a tasting card and a dinner rating for the same thing count once).
  const latest = new Map<string, Say>();
  const allTexts = new Map<string, string[]>();
  for (const s of [...says].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = `${key(s.name)}|${s.recipeId}`;
    allTexts.set(k, [...(allTexts.get(k) ?? []), ...s.texts.filter((t) => t.trim())]);
    const prev = latest.get(k);
    if (!prev) latest.set(k, s);
    else if (prev.rating == null && s.rating != null) latest.set(k, { ...prev, rating: s.rating });
    else if (prev.makeAgain == null && s.makeAgain != null) latest.set(k, { ...prev, makeAgain: s.makeAgain });
  }

  const people = new Map<string, PersonTaste>();
  const person = (name: string) => {
    const k = key(name);
    if (!people.has(k)) people.set(k, { name: name.trim() || "Someone", favourites: [], notForMe: [], avoids: [], likes: "", leanings: [], ratings: 0 });
    return people.get(k)!;
  };
  for (const [k, s] of latest) {
    const p = person(s.name);
    const t = title.get(s.recipeId)!;
    if (s.rating != null) p.ratings++;
    if ((s.rating != null && s.rating >= 8) || (s.makeAgain === "yes" && (s.rating == null || s.rating >= 7))) p.favourites.push({ recipeId: s.recipeId, title: t, rating: s.rating });
    if (s.makeAgain === "no" || (s.rating != null && s.rating <= 4)) p.notForMe.push({ recipeId: s.recipeId, title: t, why: s.makeAgain === "no" ? "said not again" : `rated it ${s.rating}/10` });
    for (const text of allTexts.get(k) ?? []) p.leanings.push(...leaningsIn(text, t));
  }
  for (const pr of args.profiles ?? []) {
    const p = person(pr.name);
    p.avoids = avoidList(pr);
    p.likes = pr.likes.trim();
  }
  for (const p of people.values()) {
    p.favourites.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const seen = new Set<string>();
    p.leanings = p.leanings.filter((l) => { const k = `${l.about}|${l.direction}|${l.recipeTitle}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const byRecipe = new Map<string, Say[]>();
  for (const s of latest.values()) byRecipe.set(s.recipeId, [...(byRecipe.get(s.recipeId) ?? []), s]);
  const favourites: HouseholdTaste["favourites"] = [];
  const split: HouseholdTaste["split"] = [];
  const worthRepeating: HouseholdTaste["worthRepeating"] = [];
  const recipeAvg = new Map<string, Map<string, number>>();
  for (const [recipeId, list] of byRecipe) {
    const t = title.get(recipeId)!;
    const rated = list.filter((s) => s.rating != null);
    recipeAvg.set(recipeId, new Map(rated.map((s) => [key(s.name), s.rating as number])));
    const a = avg(rated.map((s) => s.rating as number));
    const nots = list.filter((s) => s.makeAgain === "no" || (s.rating != null && s.rating <= 4)).map((s) => s.name);
    const loved = list.filter((s) => (s.rating != null && s.rating >= 8) || s.makeAgain === "yes").map((s) => s.name);
    if (rated.length >= 2 && a != null && a >= 7.5 && rated.every((s) => (s.rating as number) >= 7) && nots.length === 0) favourites.push({ recipeId, title: t, average: a, raters: rated.map((s) => s.name) });
    if (loved.length && nots.length) split.push({ recipeId, title: t, loved: loved.filter((n) => !nots.includes(n)), not: nots });
    const answered = list.filter((s) => s.makeAgain);
    if (answered.length >= 2 && answered.every((s) => s.makeAgain === "yes")) worthRepeating.push({ recipeId, title: t, why: `${answered.map((s) => s.name).join(" and ")} all said "yes, again"` });
  }
  for (const r of args.recipes) {
    if (!r.favourite || worthRepeating.some((w) => w.recipeId === r.id)) continue;
    const a = avg([...(recipeAvg.get(r.id)?.values() ?? [])]);
    if (a != null && a >= 8) worthRepeating.push({ recipeId: r.id, title: r.title, why: `marked a favourite and rated ${a}/10` });
  }

  const improvedVersions: HouseholdTaste["improvedVersions"] = [];
  for (const v of args.versions ?? []) {
    const after = recipeAvg.get(v.recipeId);
    const before = recipeAvg.get(v.parentId);
    if (!after || !before) continue;
    const both = [...after.keys()].filter((k) => before.has(k));
    if (!both.length) continue;
    const a = avg(both.map((k) => after.get(k)!))!;
    const b = avg(both.map((k) => before.get(k)!))!;
    if (a > b) improvedVersions.push({ recipeId: v.recipeId, title: title.get(v.recipeId) ?? v.label, parentId: v.parentId, parentTitle: title.get(v.parentId) ?? "", reason: v.reason, before: b, after: a });
  }

  return {
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    favourites: favourites.sort((a, b) => b.average - a.average),
    split, worthRepeating, improvedVersions,
  };
}

// Plain sentences for the AI request and the page. Each names its person or says "household".
export function tasteFacts(h: HouseholdTaste): string[] {
  const out: string[] = [];
  for (const p of h.people) {
    if (p.favourites.length) out.push(`${p.name} loved: ${p.favourites.slice(0, 5).map((f) => `${f.title}${f.rating != null ? ` (${f.rating}/10)` : ""}`).join(", ")}`);
    if (p.notForMe.length) out.push(`${p.name} not keen on: ${p.notForMe.slice(0, 4).map((f) => `${f.title} (${f.why})`).join(", ")}`);
    if (p.avoids.length) out.push(`${p.name} avoids (their food notes): ${p.avoids.join(", ")}`);
    if (p.likes) out.push(`${p.name} likes (their food notes): ${p.likes}`);
    for (const l of p.leanings.slice(0, 4)) out.push(`${p.name} wrote about ${l.recipeTitle}: "${l.quote}" (wants ${l.direction} ${l.about})`);
  }
  for (const f of h.favourites.slice(0, 5)) out.push(`Household favourite: ${f.title} — ${f.average}/10 from ${f.raters.join(", ")}`);
  for (const s of h.split.slice(0, 4)) out.push(`Split opinion: ${s.title} — ${s.loved.join(", ") || "someone"} loved it; ${s.not.join(", ")} didn't`);
  for (const v of h.improvedVersions.slice(0, 3)) out.push(`${v.title} (from ${v.parentTitle}: ${v.reason}) rated ${v.after} vs ${v.before} by the same people`);
  return out;
}
