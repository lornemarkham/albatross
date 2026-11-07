// The live sausage helper: "I've finished grinding the pork. Now I'm grinding
// the chicken." → what's done, and the next useful thing to do. Rules, not
// AI. Food-safety lines follow USDA FSIS (see src/lib/meat.ts).
import type { CookingSession } from "../../types/cooking";
import type { BatchPlan, Preferences } from "../../types/sausage";
import { grams } from "../cooking/parse";
import { cutOf, isPoultry, type Species } from "./cuts";
import { batchWeighList, gramsText } from "./plan";
import { grindPhrase } from "./preferences";

export type Stage = "trim" | "chill" | "grind" | "weigh" | "mix" | "test" | "stuff" | "link" | "cook" | "package";
export type Progress = { stage: Stage; subject: string; action: "started" | "finished" };

export const STAGE_LABEL: Record<Stage, string> = {
  trim: "Trim & cube", chill: "Chill", grind: "Grind", weigh: "Weigh", mix: "Season & mix", test: "Test patty",
  stuff: "Stuff", link: "Link", cook: "Cook / smoke", package: "Package",
};
export const STAGE_DOING: Record<Stage, string> = {
  trim: "trimming", chill: "chilling", grind: "grinding", weigh: "weighing", mix: "mixing", test: "test patty",
  stuff: "stuffing", link: "linking", cook: "cooking", package: "packing",
};

// What a stage button "says" when tapped (it goes through the same rules as speech).
export const STAGE_SAY: Record<Stage, string> = {
  trim: "Finished trimming", chill: "Finished chilling", grind: "Finished grinding", weigh: "Finished weighing", mix: "Finished mixing",
  test: "Finished testing", stuff: "Finished stuffing", link: "Finished linking", cook: "Finished cooking", package: "Finished packing",
};
export const STAGES: Stage[] = ["trim", "chill", "grind", "weigh", "mix", "test", "stuff", "link", "cook", "package"];

const VERB: [RegExp, Stage][] = [
  [/^(trim|trimming|trimmed|cube|cubing|cubed|cut|cutting|bon(e|ing|ed)|debon(e|ing|ed))$/, "trim"],
  [/^(chill|chilling|chilled|freez(e|ing)|froze)$/, "chill"],
  [/^(grind|grinding|ground)$/, "grind"],
  [/^(weigh|weighing|weighed)$/, "weigh"],
  [/^(mix|mixing|mixed|season|seasoning|seasoned)$/, "mix"],
  [/^(test|testing|tested|fry|frying|fried)$/, "test"],
  [/^(stuff|stuffing|stuffed|case|casing)$/, "stuff"],
  [/^(link|linking|linked|twist|twisting|twisted)$/, "link"],
  [/^(smok(e|ing|ed)|cook|cooking|cooked|poach|poaching|poached)$/, "cook"],
  [/^(pack|packing|packed|package|packaging|packaged|vacuum seal(ing|ed)?|bag(ging|ged)?)$/, "package"],
];
const stageOf = (w: string): Stage | null => VERB.find(([re]) => re.test(w))?.[1] ?? null;
const VERBS = "trim|trimming|trimmed|cube|cubing|cubed|cutting|boning|deboning|chill|chilling|chilled|freezing|grind|grinding|ground|weigh|weighing|weighed|mix|mixing|mixed|season|seasoning|seasoned|test|testing|frying|fried|stuff|stuffing|stuffed|link|linking|linked|twisting|smoke|smoking|smoked|cook|cooking|cooked|poaching|pack|packing|packed|package|packaging|packaged|bagging";

const subjectOf = (s: string | undefined) => (s ?? "")
  .replace(/^(the|my|our|all the|all of the|up the)\s+/, "")
  .replace(/\s+(now|too|as well|next|first|then|already)$/, "")
  .replace(/^(a )?test patty$/, "")
  .replace(/\s*(meat)$/, (m) => (m.trim() === "meat" ? "" : m))
  .trim();

// One spoken line can hold several: split on sentence ends, "and now", "then".
export function parseProgress(text: string): Progress[] | null {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  if (/\d/.test(t)) return null; // amounts, temperatures and timers have their own rules
  const out: Progress[] = [];
  for (const raw of t.split(/[.;!?]+|,?\s+(?:and )?(?:now|then|next)\b|\band\b(?= i'?m| i am| we'?re| i'?ve| i have)/)) {
    const c = raw.trim();
    if (!c) continue;
    let m = new RegExp(`^(?:ok(?:ay)?\\s+)?(?:i'?ve |i have |we'?ve |we have |i'?m |i am |we'?re |just |all )*(?:finished|done|completed|through|done with|finished with)\\s+(?:with\\s+)?(${VERBS})\\b(?:\\s+(.+))?$`).exec(c);
    if (m) { out.push({ stage: stageOf(m[1])!, subject: subjectOf(m[2]), action: "finished" }); continue; }
    m = new RegExp(`^(?:the |all the )?(.+?)\\s+(?:is|are|'s|has been|have been|is all|are all)\\s+(?:all\\s+)?(${VERBS})(?:\\s+now)?$`).exec(c);
    if (m && /(ed|ground)$/.test(m[2])) { out.push({ stage: stageOf(m[2])!, subject: subjectOf(m[1]), action: "finished" }); continue; }
    m = new RegExp(`^(?:i'?ve |i have |we'?ve |we have |just )+(${VERBS})\\s+(.+)$`).exec(c);
    if (m && /(ed|ground)$/.test(m[1])) { out.push({ stage: stageOf(m[1])!, subject: subjectOf(m[2]), action: "finished" }); continue; }
    m = new RegExp(`^(?:ok(?:ay)?\\s+)?(?:now |next |i'?m |i am |we'?re |we are |starting (?:to |on )?|start |about to |going to |moving on to |on to |onto )+(?:start (?:on )?)?(?:the )?(${VERBS})\\b(?:\\s+(.+))?$`).exec(c);
    if (m && !/(ed)$/.test(m[1])) { out.push({ stage: stageOf(m[1])!, subject: subjectOf(m[2]), action: "started" }); continue; }
  }
  return out.length ? out : null;
}

// ── What the meat weighs, from what was said in this cook ───────────────────

export type Weighed = { totalG: number; bySpecies: Partial<Record<Species, number>>; missing: string[]; complete: boolean };

const speciesName = (sp: Species) => (sp === "poultry" ? "chicken" : sp === "fat" ? "pork fat" : sp);

export function weighedMeat(s: CookingSession, plan: BatchPlan): Weighed {
  const wanted = [...new Set(plan.meats.map((m) => cutOf(m.name).species))];
  const bySpecies: Weighed["bySpecies"] = {};
  for (const i of s.ingredients) {
    if (i.removed || !i.qty) continue;
    const g = grams(i.qty);
    const sp = cutOf(i.name).species;
    if (g == null || !wanted.includes(sp)) continue;
    bySpecies[sp] = (bySpecies[sp] ?? 0) + g;
  }
  const missing = wanted.filter((sp) => bySpecies[sp] == null).map(speciesName);
  const totalG = Object.values(bySpecies).reduce((a, b) => a + (b ?? 0), 0);
  return { totalG, bySpecies, missing, complete: wanted.length > 0 && missing.length === 0 };
}

// The meat weight to season for: weighed when complete, else weighed + planned for the rest.
export function seasoningBasis(s: CookingSession, plan: BatchPlan): { g: number; words: string } {
  const w = weighedMeat(s, plan);
  if (w.complete) return { g: w.totalG, words: `${gramsText(w.totalG)} of meat, as weighed` };
  if (w.totalG > 0) {
    const plannedRest = plan.meats.filter((m) => w.bySpecies[cutOf(m.name).species] == null).reduce((n, m) => n + m.plannedG, 0);
    return { g: w.totalG + plannedRest, words: `${gramsText(w.totalG + plannedRest)} (weighed so far plus the plan for ${w.missing.join(" and ")}, not weighed yet)` };
  }
  return { g: plan.plannedMeatG, words: `${gramsText(plan.plannedMeatG)} — the plan, not weighed yet` };
}

export function seasoningList(s: CookingSession, plan: BatchPlan): string {
  const b = seasoningBasis(s, plan);
  const parts = batchWeighList(plan, b.g).map((a) => {
    const x = a.s;
    if (!a.text) return `${x.name} (no amount in the recipe)`;
    return `${x.name} ${a.text}${x.basis === "volume" && plan.prefs.seasoningsInGrams ? " — the recipe measures it by volume; weigh it once and note the grams" : ""}`;
  });
  return parts.length ? `For ${b.words}: ${parts.join("; ")}.` : "The recipe has no seasoning amounts written down.";
}

// "How much salt?" with an approved plan: from the plan's ratio and the meat weight.
export function planAnswer(s: CookingSession, question: string): string | null {
  const plan = s.plan;
  if (!plan) return null;
  const q = question.toLowerCase();
  if (/\b(seasonings?|spices?|what do i (weigh|add|put in)|how much of everything|amounts)\b/.test(q) && !/how much (?!of everything)\w/.test(q.replace(/how much seasoning/, ""))) {
    return seasoningList(s, plan);
  }
  const m = /how (?:much|many)\s+(?:of (?:the )?)?(.+?)(?:\s+(?:do i|should i|goes|go|for|in|to)\b.*)?$/.exec(q.replace(/[?.!]+$/, ""));
  if (m) {
    const want = m[1].replace(/^(the|a|some)\s+/, "").trim();
    if (/^(meat|pork|chicken|beef)$/.test(want) || /^(meat|pork|chicken|beef) (is|do i have)/.test(want)) {
      const w = weighedMeat(s, plan);
      return `Planned: ${plan.meats.map((x) => `${x.name} ${gramsText(x.plannedG)}`).join(", ")} (${gramsText(plan.plannedMeatG)}). Weighed so far: ${w.totalG ? gramsText(w.totalG) : "nothing yet"}.`;
    }
    const b = seasoningBasis(s, plan);
    const a = batchWeighList(plan, b.g).find((x) => x.s.name.toLowerCase().includes(want) || want.includes(x.s.name.toLowerCase()));
    const hit = a?.s;
    if (a && hit) {
      return a.text ? `${hit.name}: ${a.text} for ${b.words}.` : `The recipe doesn't give an amount for ${hit.name}, so I won't guess.`;
    }
  }
  if (/\b(temp|temperature|done|safe|cook it to)\b/.test(q)) {
    return plan.poultry ? "It has chicken in it, so cook to 74 °C (165 °F) in the centre." : "Cook to 71 °C (160 °F) in the centre.";
  }
  return null;
}

// After a meat weight is said: where weighing stands, and the seasonings once it's all weighed.
export function afterWeighing(s: CookingSession): string {
  const plan = s.plan;
  if (!plan) return "";
  const w = weighedMeat(s, plan);
  if (!w.totalG) return "";
  if (!w.complete) return ` Meat weighed so far: ${gramsText(w.totalG)}. Still to weigh: ${w.missing.join(", ")}.`;
  return ` All the meat is weighed: ${gramsText(w.totalG)}. ${seasoningList(s, plan)}`;
}

// ── The next useful thing to say ─────────────────────────────────────────────

function poultryLine(subject: string, plan: BatchPlan | null | undefined) {
  return isPoultry(subject) || plan?.poultry
    ? " Chicken is in this one: wash hands and tools after handling it, and cook the finished sausage to 74 °C (165 °F)."
    : "";
}

export function adviceFor(items: Progress[], s: CookingSession, prefs: Preferences): string {
  const plan = s.plan ?? null;
  const grind = grindPhrase(plan?.prefs.grind || plan?.prefs.plate ? plan.prefs : prefs);
  const out: string[] = [];
  const last = items[items.length - 1];
  for (const p of items) {
    const what = p.subject ? `${p.subject}` : "";
    const head = p.action === "finished" ? `${STAGE_LABEL[p.stage]} done${what ? `: ${what}` : ""}.` : `${STAGE_LABEL[p.stage]}${what ? `: ${what}` : ""} — noted.`;
    out.push(head);
    if (p !== last) continue;
    if (p.action === "finished") {
      switch (p.stage) {
        case "trim": out.push("Cubes of 2–3 cm, fat kept with the lean. Chill them until the edges are just firm (freezer 30–60 minutes) before grinding."); break;
        case "chill": out.push(`Grind next${grind ? `: ${grind}` : ""}. Keep everything cold.`); break;
        case "grind": {
          out.push(`Back in the fridge with ${what || "it"} right away — 4 °C (40 °F) or colder.`);
          if (plan) {
            const w = weighedMeat(s, plan);
            out.push(w.complete ? "All the meat's weighed — say “what are the seasonings?” for the amounts." : "When the grinding's done, weigh each meat and tell me — like “the pork weighs 8.2 kilos” — and I'll work the seasonings out from the real weight.");
          } else out.push("Weigh the ground meat before seasoning and tell me the weight.");
          break;
        }
        case "weigh": out.push(plan ? seasoningList(s, plan) : "Tell me the weight, like “the pork weighs 3 kilos”."); break;
        case "mix": out.push(`Fry a small test patty and taste it before stuffing — cook it through to ${plan?.poultry ? "74 °C (165 °F)" : "71 °C (160 °F)"}. Seasoning can still change now. Keep the mix in the fridge meanwhile.`); break;
        case "test": out.push("If it tastes right, stuff. Rinse the casings inside and out with cool water first. Tell me “tasting note: …” to keep what you thought."); break;
        case "stuff": out.push("Prick any air pockets with a clean pin. Then link, and keep the sausage cold."); break;
        case "link": out.push(plan?.kind === "fresh" ? "Fresh sausage: fridge, uncovered overnight if you want the casing to firm up, then cook within 1–2 days or freeze." : "Chill it until it goes in the smoker or pot. Cook to the safe internal temperature and check with a probe."); break;
        case "cook": out.push(`Check the centre of the thickest one with a probe: ${plan?.poultry ? "74 °C (165 °F)" : "71 °C (160 °F)"}. Say the reading and I'll keep it. Cool quickly, then fridge or freezer.`); break;
        case "package": out.push("Label each pack with what it is and today's date. Freezer for anything you won't cook in 1–2 days. Take a photo of the finished sausage for the journal."); break;
      }
    } else {
      switch (p.stage) {
        case "grind": out.push(`${grind ? `${grind[0].toUpperCase()}${grind.slice(1)}.` : ""} Keep the grinder head and the meat cold. If the fat smears instead of cutting cleanly, stop and chill everything for 20–30 minutes.${poultryLine(what, plan)}`); break;
        case "mix": out.push(plan ? `${seasoningList(s, plan)} Mix with cold liquid until the meat turns sticky and holds together — 1 to 3 minutes. Keep it cold.` : "Weigh the seasonings, then mix with cold liquid until sticky — 1 to 3 minutes. Keep it cold."); break;
        case "stuff": out.push("Load the stuffer without air, fill firmly but not tight if you'll link it. Keep the casing wet."); break;
        case "cook": out.push(plan?.kind === "fresh" ? `Cook to ${plan?.poultry ? "74 °C (165 °F)" : "71 °C (160 °F)"} in the centre.` : `Hot smoke: smoker 107 °C (225 °F) or more unless your tested cured recipe says otherwise, until the centre reaches ${plan?.poultry ? "74 °C (165 °F)" : "71 °C (160 °F)"}. No cold smoking.`); break;
        case "trim": out.push(`2–3 cm cubes, keep fat with the lean.${poultryLine(what, plan)}`); break;
        case "chill": out.push("Spread it out on a tray so it chills evenly. Edges just firm is right."); break;
        case "weigh": out.push("Tell me each weight as you go, like “the chicken weighs 1.9 kilos”."); break;
        default: break;
      }
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}
