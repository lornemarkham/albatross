// Recipe capture: photos of a recipe card → a draft for a person to check.
//
// Extraction runs on ELK Inventory's /api/extract (recipe mode), reached
// through a same-origin rewrite (vercel.json; vite.config.ts in dev). That
// endpoint holds the OpenAI key and only answers family members, checked
// server-side from the sign-in token sent here. Nothing in this file saves
// anything: the draft goes to the recipe form, and the person saves it.

import type { RecipeInput } from "../../types/recipe";

// What /api/extract returns for `kind: "recipe"` (api/_extract-recipe.ts in ELK Inventory).
export type ExtractedRecipe = {
  title: string;
  servings: string | null;
  prepTime: string | null;
  cookTime: string | null;
  source: string | null;
  ingredients: string[];
  instructions: string[];
  notes: string;
  tags: string[];
  unclear: string[];
};

export type CapturePhoto = { base64: string; mediaType: string };

export const MAX_PHOTOS = 6;
const MAX_EDGE = 1800;          // enough for handwriting at "high" detail
const JPEG_QUALITY = 0.82;
// The reader streams its answer and gives the model up to 70 s.
const TIMEOUT_MS = 90_000;

export type CaptureResult =
  | { ok: true; recipe: ExtractedRecipe }
  | { ok: false; error: string };

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean) : [];
}
function optional(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Accepts only the shape the endpoint promises; anything else is an error, not a guess. */
export function parseExtracted(data: unknown): ExtractedRecipe | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.title !== "string" || !Array.isArray(d.ingredients) || !Array.isArray(d.instructions)) return null;
  return {
    title: d.title.trim(),
    servings: optional(d.servings),
    prepTime: optional(d.prepTime),
    cookTime: optional(d.cookTime),
    source: optional(d.source),
    ingredients: strings(d.ingredients),
    instructions: strings(d.instructions),
    notes: typeof d.notes === "string" ? d.notes.trim() : "",
    tags: strings(d.tags).map((t) => t.toLowerCase()).slice(0, 5),
    unclear: strings(d.unclear),
  };
}

/**
 * The extracted recipe as a form draft. Tags are only *suggested* — the
 * person picks them. `authorName` is whoever the card credits, else the
 * person capturing it.
 */
export function toRecipeDraft(x: ExtractedRecipe, capturedBy: string): RecipeInput {
  const facts = [
    x.servings && `Serves: ${x.servings}`,
    x.prepTime && `Prep: ${x.prepTime}`,
    x.cookTime && `Cook: ${x.cookTime}`,
  ].filter(Boolean).join(" · ");
  return {
    title: x.title.slice(0, 200),
    authorName: (x.source ?? capturedBy).slice(0, 60),
    ingredients: x.ingredients.join("\n"),
    instructions: x.instructions.map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, "")}`).join("\n"),
    notes: [facts, x.notes].filter(Boolean).join("\n\n"),
    tags: [],
    suggestedTags: x.tags,
    approxCalories: null,
  };
}

// The reader accepts ~4 MB of photos per request; stay under it with room to spare.
export const MAX_TOTAL_CHARS = 3_500_000;

/** Shrinks a phone photo to a JPEG small enough to send (several pages fit in one request). */
export async function shrinkPhoto(file: Blob, maxEdge = MAX_EDGE): Promise<CapturePhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

/** Every page, as large as fits in one request (handwriting needs the detail). */
export async function preparePhotos(files: Blob[], shrink: (f: Blob, edge: number) => Promise<CapturePhoto> = shrinkPhoto): Promise<CapturePhoto[]> {
  for (const edge of [MAX_EDGE, 1400, 1100, 900]) {
    const photos = await Promise.all(files.map((f) => shrink(f, edge)));
    if (photos.reduce((n, p) => n + p.base64.length, 0) <= MAX_TOTAL_CHARS) return photos;
  }
  throw new Error("Those photos are too large together — try fewer pages.");
}

const MESSAGES: Record<number, string> = {
  400: "Those photos couldn't be sent — try fewer pages.",
  401: "Your sign-in has expired. Sign in again to read recipe photos.",
  403: "Reading recipe photos is for people on the family list.",
  413: "Those photos are too large together — try fewer pages.",
  503: "Recipe reading is unavailable right now. You can type the recipe instead.",
};

export async function extractRecipe(
  photos: CapturePhoto[],
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptureResult> {
  if (photos.length === 0) return { ok: false, error: "Add a photo of the recipe first." };
  if (photos.length > MAX_PHOTOS) return { ok: false, error: `At most ${MAX_PHOTOS} photos per recipe.` };
  try {
    const res = await fetchImpl("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ kind: "recipe", images: photos }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: MESSAGES[res.status] ?? `Couldn't read the recipe (error ${res.status}). Try again, or type it in.` };
    const data = await res.json().catch(() => null);
    // Once reading starts the answer is streamed with status 200, so a failure arrives as { error }.
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
      return { ok: false, error: "The recipe reader had a problem. Try again, or with fewer pages." };
    }
    const recipe = parseExtracted(data);
    if (!recipe) return { ok: false, error: "Couldn't read the recipe. Try again, or type it in." };
    if (!recipe.title && recipe.ingredients.length === 0 && recipe.instructions.length === 0) {
      return { ok: false, error: "No recipe found in those photos. Try a closer, brighter photo." };
    }
    return { ok: true, recipe };
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? "Reading the recipe took too long. Try again, or with fewer pages." : "Couldn't reach the recipe reader. Check your connection and try again." };
  }
}

// The draft waiting for review, kept for this tab only (sessionStorage) so a
// phone reloading the page mid-review doesn't lose it. Cleared on save or discard.
export type PhotoDraft = { draft: RecipeInput; unclear: string[]; pages: number };
const DRAFT_KEY = "elk-kitchen-photo-draft";
type SessionLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function keepDraft(storage: SessionLike, d: PhotoDraft): void {
  try { storage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* full or blocked: the draft still travels in memory */ }
}
export function readDraft(storage: SessionLike): PhotoDraft | null {
  try {
    const d = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null") as PhotoDraft | null;
    return d && typeof d.draft?.title === "string" && Array.isArray(d.unclear) ? d : null;
  } catch {
    return null;
  }
}
export function clearDraft(storage: SessionLike): void {
  try { storage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}
