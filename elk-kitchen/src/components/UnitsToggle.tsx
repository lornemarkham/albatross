import { useState } from "react";
import { readUnitSystem, saveUnitSystem, type UnitSystem } from "../lib/units";

// The remembered display choice. Changing it never edits a recipe.
export function useUnitSystem(): [UnitSystem, (s: UnitSystem) => void] {
  const [system, setSystem] = useState<UnitSystem>(() => readUnitSystem());
  return [system, (s) => { saveUnitSystem(s); setSystem(s); }];
}

export function UnitsToggle({ system, onChange }: { system: UnitSystem; onChange: (s: UnitSystem) => void }) {
  const on = system === "ounces";
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(on ? "as-written" : "ounces")}
      className="min-h-10 rounded-full border border-clay px-3 text-sm font-medium text-bark">
      {on ? "Showing ounces · tap for as written" : "Show in ounces"}
    </button>
  );
}
