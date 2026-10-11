import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { primaryButton, secondaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { supabase } from "../lib/supabase";
import { extractRecipe, keepDraft, MAX_PHOTOS, preparePhotos, toRecipeDraft } from "../lib/capture/recipeCapture";

type Page = { id: string; file: File; preview: string };

// Photograph a recipe card → AI reads it → the recipe form, filled in, for a
// person to check and save. Nothing is saved from here, and the photos are
// only sent to the reader (never stored).
export function PhotoCapturePage() {
  const { member, myName } = useKitchen();
  const navigate = useNavigate();
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  // Thumbnails are object URLs; release them when the page goes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function add(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (images.length < files.length) setError("Only photos can be read — other files were skipped.");
    const room = MAX_PHOTOS - pages.length;
    if (images.length > room) setError(`Up to ${MAX_PHOTOS} photos per recipe — the extra ${images.length - room} weren't added.`);
    const added = images.slice(0, Math.max(0, room)).map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { id: `${Date.now()}-${Math.random()}`, file, preview };
    });
    setPages((p) => [...p, ...added]);
  }

  const move = (i: number, by: number) => setPages((p) => {
    const next = [...p];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return next;
  });

  async function read() {
    setError(null);
    setBusy(true);
    try {
      const { data } = await supabase!.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setError("Your sign-in has expired. Reload the page and sign in again."); return; }
      let photos;
      try {
        photos = await preparePhotos(pages.map((p) => p.file));
      } catch (e) {
        setError(e instanceof Error && /too large/.test(e.message)
          ? e.message
          : "One of these photos couldn't be opened. Remove it and try a JPEG or a fresh camera photo.");
        return;
      }
      const result = await extractRecipe(photos, token);
      if (!result.ok) { setError(result.error); return; }
      const draft = { draft: toRecipeDraft(result.recipe, myName), unclear: result.recipe.unclear, pages: pages.length };
      keepDraft(window.sessionStorage, draft);
      navigate("/add?from=photo", { state: draft });
    } finally {
      setBusy(false);
    }
  }

  if (!member || !supabase) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-bark">Photograph a recipe</h1>
        <p className="mt-3 text-bark/70">
          Reading recipe photos is for people signed in and on the ELK family list
          {supabase ? "." : ", and this copy of ELK Kitchen isn't connected to the family account."}
        </p>
        <Link to="/add" className={`${primaryButton} mt-6 inline-block`}>Type the recipe instead</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Recipes</Link>
      <h1 className="mt-4 text-2xl font-bold text-bark">Photograph a recipe</h1>
      <p className="mt-1 text-bark/70">
        A recipe card, a cookbook page or a handwritten note. Several pages of one recipe are fine — add them in order.
        You'll check everything before it's saved.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" disabled={busy || pages.length >= MAX_PHOTOS} onClick={() => camera.current?.click()}
          className="flex flex-col items-center gap-1 rounded-2xl bg-sage px-4 py-6 text-white shadow-sm disabled:opacity-50">
          <span className="text-3xl" aria-hidden>📷</span>
          <span className="font-semibold">Take a photo</span>
        </button>
        <button type="button" disabled={busy || pages.length >= MAX_PHOTOS} onClick={() => library.current?.click()}
          className="flex flex-col items-center gap-1 rounded-2xl border border-clay bg-cream px-4 py-6 text-bark shadow-sm disabled:opacity-50">
          <span className="text-3xl" aria-hidden>🖼️</span>
          <span className="font-semibold">Choose photos</span>
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={add} />
      <input ref={library} type="file" accept="image/*" multiple className="hidden" onChange={add} />

      {pages.length > 0 && (
        <ol className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pages.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-clay bg-white">
              <img src={p.preview} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
              <div className="flex items-center justify-between px-2 py-1.5 text-sm">
                <span className="font-medium text-bark">Page {i + 1}</span>
                <span className="flex gap-1">
                  {i > 0 && <button type="button" disabled={busy} aria-label={`Move page ${i + 1} earlier`} onClick={() => move(i, -1)} className="rounded px-2 py-1 text-bark/70 hover:bg-clay/30">←</button>}
                  <button type="button" disabled={busy} aria-label={`Remove page ${i + 1}`}
                    onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))}
                    className="rounded px-2 py-1 text-bark/70 hover:bg-red-50 hover:text-red-700">✕</button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || pages.length === 0} onClick={read} className={`${primaryButton} w-full py-3 text-base sm:w-auto sm:px-8`}>
          {busy ? "Reading the recipe… (up to a minute)" : error && pages.length > 0 ? "Try again" : `Read ${pages.length > 1 ? `these ${pages.length} pages` : "the recipe"}`}
        </button>
        <Link to="/add" className={`${secondaryButton} w-full text-center sm:w-auto`}>Type it instead</Link>
      </div>
      <p className="mt-4 text-xs text-bark/55">
        Photos are sent to OpenAI to be read, through ELK's family-only reader, and ELK doesn't keep them. The reader copies
        what's written and lists anything it couldn't read — it's told not to fill in missing amounts.
      </p>
    </div>
  );
}
