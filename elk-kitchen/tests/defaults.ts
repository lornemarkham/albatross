import { blankDetails } from "../src/lib/meat.ts";

// The fields every recipe / cooking entry now carries (photos, kind, batch details).
export const RECIPE_EXTRA = { kind: "general" as const, category: "", photos: [], details: blankDetails() };
export const ENTRY_EXTRA = { photos: [], equipment: "", timesAndTemps: "", yieldNote: "", tastingNotes: "", details: blankDetails() };
