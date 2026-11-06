// Photos, short clips and voice notes taken while cooking. Stored the moment
// they're taken (and read back), in the same store as recipe photos: this
// phone, or the family's private bucket.
import type { MediaRef } from "../../types/cooking";
import { addPhoto, type PhotoStore } from "../photos";
import { newId } from "../recipeModel";

// The family bucket's per-file limit (supabase/kitchen-photos.sql).
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const EXT: Record<string, string> = {
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/aac": "aac",
};

export function mediaId(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return `${newId()}.${EXT[base] ?? (base.startsWith("audio/") ? "webm" : "mp4")}`;
}

export async function storeMedia(
  store: PhotoStore, file: Blob, type: MediaRef["type"], opts: { now?: string; finished?: boolean; shrink?: (b: Blob) => Promise<Blob> } = {},
): Promise<MediaRef> {
  const now = opts.now ?? new Date().toISOString();
  if (type === "photo") {
    const ref = await addPhoto(store, file, now, opts.shrink);
    return { id: ref.id, type, mime: "image/jpeg", caption: "", addedAt: now, finished: !!opts.finished };
  }
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(type === "video"
      ? `That clip is ${Math.round(file.size / 1024 / 1024)} MB. Clips can be up to 15 MB: about 20–30 seconds on most phones. Take a shorter one.`
      : "That recording is too long to keep.");
  }
  const mime = file.type || (type === "video" ? "video/mp4" : "audio/webm");
  const id = mediaId(mime);
  await store.put(id, file);
  if (!(await store.has(id))) throw new Error("It didn't save. Try again.");
  return { id, type, mime, caption: "", addedAt: now, finished: !!opts.finished };
}
