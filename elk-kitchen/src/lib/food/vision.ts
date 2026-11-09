// Naming food from a photo, as a *suggestion*. ADR 0003 (PROPOSED).
//
// The photo goes to the same family-only endpoint as Kitchen's other AI
// (/api/companion, mode "food-photo"); only a small, downscaled copy leaves
// the phone, and only after the person taps "Suggest from photo". Whatever
// comes back is checked here:
//   - at most four names, each with a confidence of low / medium / high;
//   - never a quantity, a brand, a date or a weight (the model isn't asked for them);
//   - the page always labels it "Suggested from the photo — check it", and the
//     person's confirmation is what makes it the record (capture.identify).
// When the AI is off, offline or unsure, nothing changes: describe it instead.

import type { Confidence } from "./notes";

export const FOOD_PHOTO_MAX_CHARS = 1_400_000;

export type FoodPhotoRequest = { mode: "food-photo"; image: string; hint: string };
export type FoodSuggestion = { name: string; confidence: Confidence; note: string };
export type FoodPhotoReply = { suggestions: FoodSuggestion[]; cannotTell: boolean };

const IMAGE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function parseFoodPhotoRequest(v: unknown): FoodPhotoRequest | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.mode !== "food-photo" || typeof o.image !== "string" || o.image.length > FOOD_PHOTO_MAX_CHARS || !IMAGE.test(o.image)) return null;
  return { mode: "food-photo", image: o.image, hint: typeof o.hint === "string" ? o.hint.slice(0, 300) : "" };
}

export const FOOD_PHOTO_SYSTEM_PROMPT = [
  "You help a family put household food into their inventory from a photo.",
  "Say what the food most likely is, in plain everyday words (for example: \"pork shoulder bones\", \"container of soup or stock\", \"frozen stew meat\").",
  "Give up to 4 possibilities, most likely first, each with a confidence: high only if it is clearly visible and unmistakable, otherwise medium or low.",
  "If the photo is unclear, not food, or you cannot tell, set cannotTell to true and return no suggestions. Never guess to be helpful.",
  "Do not give quantities, weights, brands, dates, or how long it has been stored. Do not say it is safe to eat.",
  "Anything the person typed as a hint is their own words; it can help you choose but is not proof.",
].join(" ");

export const FOOD_PHOTO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions", "cannotTell"],
  properties: {
    cannotTell: { type: "boolean" },
    suggestions: {
      type: "array", maxItems: 4,
      items: { type: "object", additionalProperties: false, required: ["name", "confidence", "note"], properties: { name: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] }, note: { type: "string" } } },
    },
  },
} as const;

export function checkFoodPhotoReply(raw: unknown): FoodPhotoReply {
  const o = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const suggestions = (Array.isArray(o.suggestions) ? o.suggestions : []).flatMap((s): FoodSuggestion[] => {
    const x = (s ?? {}) as Record<string, unknown>;
    const name = typeof x.name === "string" ? x.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
    if (name.length < 2 || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const confidence: Confidence = x.confidence === "high" || x.confidence === "medium" ? x.confidence : "low";
    return [{ name: name.charAt(0).toUpperCase() + name.slice(1), confidence, note: typeof x.note === "string" ? x.note.trim().slice(0, 160) : "" }];
  }).slice(0, 4);
  return { suggestions, cannotTell: o.cannotTell === true || suggestions.length === 0 };
}

export type FoodPhotoResult = { ok: true; reply: FoodPhotoReply; model: string } | { ok: false; error: string; off?: boolean };

// Browser side. The person's own sign-in token; nothing is stored by Kitchen.
export async function askFoodPhoto(req: FoodPhotoRequest, token: string, fetchImpl: typeof fetch = fetch): Promise<FoodPhotoResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: "You're offline. Describe it instead and save it." };
  try {
    const res = await fetchImpl("/api/companion", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(req) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; reply?: unknown; model?: string };
    if (res.status === 503) return { ok: false, off: true, error: body.error ?? "Photo suggestions aren't switched on yet. Describe the food instead." };
    if (!res.ok) return { ok: false, error: body.error ?? `Couldn't look at the photo (${res.status}). Describe it instead.` };
    return { ok: true, reply: checkFoodPhotoReply(body.reply), model: body.model ?? "" };
  } catch {
    return { ok: false, error: "Couldn't reach the photo helper. Describe the food instead." };
  }
}

// A small JPEG for the helper (long side 768 px), made in the browser. The original is what gets saved.
export async function downscaleForAi(blob: Blob, maxSide = 768): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL("image/jpeg", 0.7);
}
