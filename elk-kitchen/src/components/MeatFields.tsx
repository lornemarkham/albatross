import { useState } from "react";
import { displayMeasures, type UnitSystem } from "../lib/units";
import { safetyChecks, safetyGuidance, SAFETY_SOURCE, seasoningLines, yieldPercent, type SafetyNote } from "../lib/meat";
import type { MeatDetails, RecipeKind } from "../types/recipe";
import { inputClass, labelClass, sectionLabel } from "./ui";

// A number box that lets you type "7." or leave it empty without fighting you.
function Num({ label, unit, value, onChange, max = 100000, step = "any", id }: {
  label: string; unit: string; value: number | null; onChange: (n: number | null) => void; max?: number; step?: string; id: string;
}) {
  const [raw, setRaw] = useState(value == null ? "" : String(value));
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label} ({unit})</label>
      <input
        id={id} type="number" inputMode="decimal" min={0} max={max} step={step} className={inputClass} value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = e.target.value.trim() === "" ? null : Number(e.target.value);
          onChange(n != null && Number.isFinite(n) && n >= 0 && n <= max ? n : null);
        }}
      />
    </div>
  );
}

const set = <K extends keyof MeatDetails>(d: MeatDetails, onChange: (d: MeatDetails) => void, k: K) => (v: MeatDetails[K]) => onChange({ ...d, [k]: v });

// Jerky / sausage numbers. "plan" = what the recipe intends; "batch" = what happened.
export function MeatFields({ kind, mode, value: d, onChange }: { kind: Exclude<RecipeKind, "general">; mode: "plan" | "batch"; value: MeatDetails; onChange: (d: MeatDetails) => void }) {
  const batch = mode === "batch";
  const lines = seasoningLines(d.seasoning, d.meatWeightG);
  const pct = yieldPercent(d);
  const jerky = kind === "jerky";
  return (
    <fieldset className="space-y-5 rounded-2xl border border-clay bg-cream p-4">
      <legend className={`${sectionLabel} px-1`}>{jerky ? "Jerky" : "Sausage"} details · {batch ? "this batch" : "the plan"}</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="meatType" className={labelClass}>Meat / cut</label>
          <input id="meatType" className={inputClass} maxLength={100} placeholder={jerky ? "e.g. beef eye of round" : "e.g. pork shoulder"} value={d.meatType} onChange={(e) => onChange({ ...d, meatType: e.target.value })} />
        </div>
        <Num id="meatWeightG" label="Meat weight" unit="g" value={d.meatWeightG} onChange={set(d, onChange, "meatWeightG")} />
        {!jerky || batch ? <Num id="fatPercent" label="Fat" unit="%" max={100} value={d.fatPercent} onChange={set(d, onChange, "fatPercent")} /> : <Num id="fatPercent" label="Fat (lean cuts ≈ 5%)" unit="%" max={100} value={d.fatPercent} onChange={set(d, onChange, "fatPercent")} />}
      </div>
      <div>
        <label htmlFor="seasoning" className={labelClass}>Seasoning ratios — one per line, % of meat weight</label>
        <textarea id="seasoning" rows={5} className={inputClass} placeholder={"Salt 2%\nBlack pepper 0.5%\nGarlic powder 1%"} value={d.seasoning} onChange={(e) => onChange({ ...d, seasoning: e.target.value })} />
        {lines.some((l) => l.grams != null) && (
          <ul className="mt-2 text-sm text-bark/80">
            {lines.map((l, i) => <li key={i}>{l.grams != null ? `${l.name}: ${l.grams} g for ${d.meatWeightG} g of meat` : l.raw}</li>)}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor="marinade" className={labelClass}>Marinade (ingredients, time, fridge?)</label>
        <textarea id="marinade" rows={3} className={inputClass} value={d.marinade} onChange={(e) => onChange({ ...d, marinade: e.target.value })} />
      </div>
      {!jerky && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="grinderPlate" className={labelClass}>Grinding plate</label>
            <input id="grinderPlate" className={inputClass} maxLength={60} placeholder="e.g. 4.5 mm coarse" value={d.grinderPlate} onChange={(e) => onChange({ ...d, grinderPlate: e.target.value })} />
          </div>
          <div>
            <label htmlFor="casing" className={labelClass}>Casing</label>
            <input id="casing" className={inputClass} maxLength={100} placeholder="e.g. hog, 32 mm" value={d.casing} onChange={(e) => onChange({ ...d, casing: e.target.value })} />
          </div>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Num id="smokeTempC" label={batch ? "Smoking temperature" : "Smoking temperature (planned)"} unit="°C" max={400} value={d.smokeTempC} onChange={set(d, onChange, "smokeTempC")} />
        <Num id="cookTempC" label={batch ? (jerky ? "Drying / oven temperature" : "Cooking temperature") : "Cooking temperature (planned)"} unit="°C" max={400} value={d.cookTempC} onChange={set(d, onChange, "cookTempC")} />
        {batch && <Num id="internalTempC" label="Internal temperature reached" unit="°C" max={300} value={d.internalTempC} onChange={set(d, onChange, "internalTempC")} />}
        {batch && <Num id="finishedWeightG" label="Finished weight" unit="g" value={d.finishedWeightG} onChange={set(d, onChange, "finishedWeightG")} />}
      </div>
      {batch && pct != null && <p className="text-sm text-bark/80">Yield: {pct}% of starting weight.</p>}
      {batch && <SafetyNotes notes={safetyChecks(kind, d)} />}
    </fieldset>
  );
}

export function SafetyNotes({ notes }: { notes: SafetyNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Food safety">
      {notes.map((n, i) => (
        <li key={i} role={n.level === "warn" ? "alert" : undefined}
          className={`rounded-xl border p-3 text-sm ${n.level === "warn" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          {n.level === "warn" ? "⚠ " : ""}{n.text}
        </li>
      ))}
    </ul>
  );
}

export function FoodSafetyPanel({ kind }: { kind: RecipeKind }) {
  const notes = safetyGuidance(kind);
  if (notes.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 className="font-bold">Food safety — {kind === "jerky" ? "jerky" : "sausage"}</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
        {notes.map((n, i) => <li key={i}>{n.text}</li>)}
      </ul>
      <p className="mt-3 text-xs text-amber-900/80">Based on {SAFETY_SOURCE}. Guidance, not a guarantee — when in doubt, throw it out.</p>
    </section>
  );
}

// Read-only summary of the numbers that were filled in.
export function DetailsSummary({ kind, d, units = "as-written" }: { kind: RecipeKind; d: MeatDetails; units?: UnitSystem }) {
  const rows: [string, string][] = [];
  const add = (l: string, v: string | number | null, u = "") => { if (v !== null && v !== "") rows.push([l, `${v}${u}`]); };
  add("Meat", d.meatType);
  add("Meat weight", d.meatWeightG, " g");
  add("Fat", d.fatPercent, "%");
  add("Grinding plate", d.grinderPlate);
  add("Casing", d.casing);
  add("Smoking temp", d.smokeTempC, " °C");
  add("Cooking / drying temp", d.cookTempC, " °C");
  add("Internal temp", d.internalTempC, " °C");
  add("Finished weight", d.finishedWeightG, " g");
  const pct = yieldPercent(d);
  if (pct != null) add("Yield", pct, "%");
  const lines = seasoningLines(d.seasoning, d.meatWeightG);
  if (kind === "general" || (rows.length === 0 && !d.seasoning.trim() && !d.marinade.trim())) return null;
  return (
    <div className="space-y-2 text-sm">
      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map(([l, v]) => <div key={l} className="contents"><dt className="text-bark/60">{l}</dt><dd className="font-medium text-bark">{v}</dd></div>)}
        </dl>
      )}
      {lines.length > 0 && (
        <div><p className="text-xs font-semibold text-sage">Seasoning</p>
          <ul>{lines.map((l, i) => <li key={i}>{displayMeasures(l.grams != null ? `${l.name} ${l.percent}% = ${l.grams} g` : l.raw, units)}</li>)}</ul></div>
      )}
      {d.marinade.trim() && <div><p className="text-xs font-semibold text-sage">Marinade</p><p className="whitespace-pre-wrap">{d.marinade}</p></div>}
    </div>
  );
}
