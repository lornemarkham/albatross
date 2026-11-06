import { useEffect, useRef, useState } from "react";
import { useKitchen } from "../context/KitchenContext";
import { addPhoto } from "../lib/photos";
import type { PhotoRef } from "../types/recipe";
import { secondaryButton } from "./ui";

// One stored picture, loaded by id. Shows a clear message if it can't be found
// rather than a broken image.
export function PhotoImg({ id, className = "" }: { id: string; className?: string }) {
  const { photos } = useKitchen();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    photos.get(id).then((b) => {
      if (cancelled) return;
      if (!b) { setUrl(null); return; }
      revoke = URL.createObjectURL(b);
      setUrl(revoke);
    }, () => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [id, photos]);
  if (url === undefined) return <div className={`animate-pulse bg-clay/30 ${className}`} />;
  if (url === null) return <div className={`flex items-center justify-center bg-clay/20 p-2 text-center text-xs text-bark/60 ${className}`}>Photo not on this device</div>;
  return <img src={url} alt="" className={`object-cover ${className}`} />;
}

export function PhotoGallery({ photos }: { photos: PhotoRef[] }) {
  const [open, setOpen] = useState<PhotoRef | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(p)} className="block w-full overflow-hidden rounded-xl border border-clay" aria-label={p.caption || "Open photo"}>
              <PhotoImg id={p.id} className="aspect-square w-full" />
            </button>
            {p.caption && <p className="mt-1 text-sm text-bark/80">{p.caption}</p>}
          </li>
        ))}
      </ul>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-3" onClick={() => setOpen(null)}>
          <PhotoImg id={open.id} className="max-h-[80vh] max-w-full rounded-lg !object-contain" />
          {open.caption && <p className="mt-3 text-white">{open.caption}</p>}
          <button type="button" className="mt-4 rounded-xl bg-white px-6 py-3 text-base font-semibold text-bark">Close</button>
        </div>
      )}
    </>
  );
}

// Add photos from the phone camera or library. Each picture is shrunk and
// stored (and read back) the moment it's chosen, so a photo is never "pending"
// in memory only; the record just keeps its reference.
export function PhotoPicker({ value, onChange }: { value: PhotoRef[]; onChange: (next: PhotoRef[]) => void }) {
  const { photos } = useKitchen();
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy((n) => n + files.length);
    for (const f of Array.from(files)) {
      try {
        const ref = await addPhoto(photos, f);
        onChange([...latest.current, ref]);
        latest.current = [...latest.current, ref];
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  const btn = `${secondaryButton} flex min-h-14 flex-1 cursor-pointer items-center justify-center gap-2`;
  return (
    <div>
      <div className="mt-2 flex gap-2">
        <label className={btn}>
          📷 Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </label>
        <label className={btn}>
          🖼 From phone
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {busy > 0 && <p role="status" className="mt-2 text-sm text-bark/70">Saving {busy} photo{busy === 1 ? "" : "s"}…</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((p, i) => (
            <li key={p.id} className="rounded-xl border border-clay bg-white p-1.5">
              <PhotoImg id={p.id} className="aspect-square w-full rounded-lg" />
              <input
                aria-label="Photo caption"
                placeholder="Caption (e.g. after marinating)"
                maxLength={120}
                value={p.caption}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
                className="mt-1 w-full rounded-lg border border-clay px-2 py-2 text-sm"
              />
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="mt-1 min-h-10 w-full text-sm text-bark/60 underline">
                Remove photo
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-bark/60">
        {photos.where === "family" ? "Photos are saved to the family's private storage." : "Photos are saved on this phone. Use Backup & import to keep a copy."}
      </p>
    </div>
  );
}
