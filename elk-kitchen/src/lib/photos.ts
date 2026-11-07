import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhotoRef } from "../types/recipe";
import type { CookingSession } from "../types/cooking";
import { sessionMediaIds } from "./cooking/summary";
import { newId, type ExportBundle } from "./recipeModel";

// Photo bytes live apart from recipe records. A recipe or cook holds only
// PhotoRefs; the picture is fetched by id. Photos are never deleted by the app:
// removing one from a recipe just drops the reference.
export interface PhotoStore {
  readonly where: "this-device" | "family";
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  has(id: string): Promise<boolean>;
}

export const BUCKET = "kitchen-photos";

export class MemoryPhotoStore implements PhotoStore {
  readonly where = "this-device" as const;
  readonly blobs = new Map<string, Blob>();
  async put(id: string, blob: Blob) { this.blobs.set(id, blob); }
  async get(id: string) { return this.blobs.get(id) ?? null; }
  async has(id: string) { return this.blobs.has(id); }
}

const DB = "elk-kitchen-photos-v1";
const STORE = "photos";

// Persistent on-device photos. IndexedDB holds blobs natively, so a phone
// photo isn't base64-inflated or squeezed into localStorage's ~5 MB.
export class IndexedDbPhotoStore implements PhotoStore {
  readonly where = "this-device" as const;
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`Couldn't open this device's photo storage: ${req.error?.message ?? "unknown error"}`));
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      // Resolve a write only once the transaction is durably committed.
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(new Error(`Couldn't save the photo on this device: ${tx.error?.message ?? "storage full or blocked"}`));
    });
  }

  async put(id: string, blob: Blob) { await this.run("readwrite", (s) => s.put(blob, id)); }
  async get(id: string) { return ((await this.run("readonly", (s) => s.get(id))) as Blob | undefined) ?? null; }
  async has(id: string) { return (await this.run("readonly", (s) => s.count(id))) > 0; }
}

// Photos are stored as "<id>.jpg". Video clips and voice notes carry their
// own extension in the id ("<uuid>.webm"), so the path is the id.
const photoPath = (id: string) => (/\.[a-z0-9]{2,5}$/.test(id) ? id : `${id}.jpg`);

// Family photos: a private Supabase Storage bucket (supabase/kitchen-photos.sql),
// readable and writable by family members only. Never overwrites: a second
// upload of an existing id is treated as already stored.
export class SharedPhotoStore implements PhotoStore {
  readonly where = "family" as const;
  private client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async put(id: string, blob: Blob) {
    const { error } = await this.client.storage.from(BUCKET).upload(photoPath(id), blob, { contentType: blob.type.split(";")[0] || "image/jpeg", upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Couldn't upload the photo: ${error.message}`);
  }
  async get(id: string) {
    const { data, error } = await this.client.storage.from(BUCKET).download(photoPath(id));
    return error ? null : data;
  }
  async has(id: string) { return (await this.get(id)) !== null; }
}

// Phone cameras produce 3–12 MB JPEGs. Shrink to a sensible size before
// storing so a weekend of photos fits and uploads on mobile data.
export const MAX_SIDE = 1600;
export async function shrinkImage(file: Blob, maxSide = MAX_SIDE, quality = 0.82): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Can't decode here (e.g. HEIC on some browsers): keep the original bytes rather than lose the photo.
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) { bitmap.close(); return file; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  return out ?? file;
}

// Store a picked file and return the reference to save with the record.
export async function addPhoto(store: PhotoStore, file: Blob, now = new Date().toISOString(), shrink = shrinkImage): Promise<PhotoRef> {
  const blob = await shrink(file);
  const id = newId();
  await store.put(id, blob);
  // Read it back: a photo isn't "saved" until it can be retrieved.
  if (!(await store.has(id))) throw new Error("The photo didn't save. Try again.");
  return { id, caption: "", addedAt: now };
}

// Ask the browser not to evict this site's storage (photos live there).
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

// ── Export / import of photo bytes ───────────────────────────────────────────
export type ExportedPhoto = { id: string; mime: string; data: string }; // data = base64

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportPhotos(store: PhotoStore, ids: string[]): Promise<{ photos: ExportedPhoto[]; missing: string[] }> {
  const photos: ExportedPhoto[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const b = await store.get(id);
    if (!b) { missing.push(id); continue; }
    photos.push({ id, mime: b.type || "image/jpeg", data: await blobToBase64(b) });
  }
  return { photos, missing };
}

// Never overwrites a photo that's already stored.
export async function importPhotos(store: PhotoStore, photos: ExportedPhoto[]): Promise<number> {
  let added = 0;
  for (const p of photos) {
    if (await store.has(p.id)) continue;
    await store.put(p.id, base64ToBlob(p.data, p.mime));
    added++;
  }
  return added;
}

// A complete backup: records plus every photo they point to.
export async function bundleWithPhotos(
  store: { exportAll(): Promise<ExportBundle> }, photoStore: PhotoStore,
): Promise<ExportBundle> {
  const bundle = await store.exportAll();
  const ids = [
    ...[...bundle.recipes, ...bundle.cookingEntries].flatMap((x) => x.photos.map((p) => p.id)),
    ...bundle.cookingEntries.flatMap((e) => sessionMediaIds(e.session)),
    ...(bundle.mealFeedback ?? []).flatMap((f) => f.photos.map((p) => p.id)),
  ];
  const { photos, missing } = await exportPhotos(photoStore, ids);
  return { ...bundle, photos, ...(missing.length ? { missingPhotoIds: missing } : {}) };
}

export const photoIdsOf = (items: { recipe: { photos: PhotoRef[] }; newEntries: { photos: PhotoRef[]; session?: CookingSession | null }[]; selected: boolean }[]) =>
  items.filter((i) => i.selected).flatMap((i) => [
    ...[...i.recipe.photos, ...i.newEntries.flatMap((e) => e.photos)].map((p) => p.id),
    ...i.newEntries.flatMap((e) => sessionMediaIds(e.session)),
  ]);
