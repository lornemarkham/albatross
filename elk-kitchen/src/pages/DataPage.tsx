import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DownloadDeviceExport } from "../components/DownloadDeviceExport";
import { primaryButton, secondaryButton } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { IndexedDbPhotoStore, bundleWithPhotos, importPhotos, photoIdsOf, type ExportedPhoto } from "../lib/photos";
import { downloadBundle } from "../lib/download";
import { parseImportFile, planImport, type ImportData, type ImportItem, type ImportResult } from "../lib/recipeModel";
import { readDeviceData } from "../lib/recipeStorage";
import type { MealFeedback } from "../types/feedback";
import { deviceRecordPhotoIds, hasDeviceRecords, mergeDeviceRecords, readDeviceRecords, type DeviceRecords } from "../lib/deviceRecords";

export function DataPage() {
  const { store, deviceStore, photos } = useKitchen();
  const [params] = useSearchParams();
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  const [source, setSource] = useState("");
  // Photo bytes for the import: from the chosen file, or copied from this device.
  const [filePhotos, setFilePhotos] = useState<ExportedPhoto[]>([]);
  const [fromDevice, setFromDevice] = useState(false);
  // Family dinner feedback carried in the file (or on this device).
  const [feedback, setFeedback] = useState<MealFeedback[]>([]);
  // Sausage Days, tasting cards, recipe versions carried in the file (kept on this phone).
  const [records, setRecords] = useState<DeviceRecords | undefined>(undefined);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shared = store.mode === "family";

  async function preview(data: ImportData, from: string, device = false) {
    setError(null);
    setPhotoNote(null);
    setFilePhotos(data.photos);
    setFeedback(data.mealFeedback ?? []);
    setRecords(device ? undefined : data.deviceRecords);
    setFromDevice(device);
    setResult(null);
    try {
      setItems(planImport(data, await store.existingKeys()));
      setFavs(data.favouriteRecipeIds);
      setSource(from);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function previewDevice() {
    const d = readDeviceData(window.localStorage);
    if (!d) { setError("There are no recipes saved in this browser."); return; }
    deviceStore.listFeedback().then((f) => preview(
      { recipes: d.recipes, entries: d.entries, favouriteRecipeIds: d.favouriteRecipeIds, photos: [], mealFeedback: f.status === "ready" ? f.items : [] },
      "this device", true));
  }

  useEffect(() => {
    if (shared && params.get("from") === "device") previewDevice();
  }, []);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await preview(parseImportFile(await file.text(), new Date().toISOString()), file.name);
    } catch (err) {
      setItems(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runImport() {
    if (!items) return;
    setBusy(true);
    setError(null);
    try {
      const res = await store.importItems(items, favs);
      // Feedback after the dinners it's about (only for dinners that are now here).
      const chosenRecipes = new Set(items.filter((i) => i.selected || i.status === "already-here").map((i) => i.recipe.id));
      const fb = feedback.filter((f) => chosenRecipes.has(f.recipeId));
      let feedbackAdded = 0;
      let feedbackNote = "";
      try {
        feedbackAdded = await store.importFeedback(fb);
      } catch (e) {
        feedbackNote = ` Dinner feedback wasn't imported (${e instanceof Error ? e.message : String(e)}); it's still in the file.`;
      }
      // This phone's own records from the file (add-only; anything already on the phone is left as it is).
      let recordNote = "";
      if (hasDeviceRecords(records)) {
        const m = mergeDeviceRecords(window.localStorage, records!);
        recordNote = ` Sausage Days ${m.plans}, tasting cards ${m.tastings}, recipe versions ${m.versions} added to this phone (the rest were already here).`;
      }
      // Photos after records: a record never points at a photo that isn't stored.
      const ids = new Set([...photoIdsOf(items), ...fb.flatMap((f) => f.photos.map((p) => p.id)), ...deviceRecordPhotoIds(records)]);
      let copied = 0;
      let lost = 0;
      if (fromDevice) {
        const dev = new IndexedDbPhotoStore();
        for (const id of ids) {
          const b = await dev.get(id);
          if (!b) { lost++; continue; }
          if (!(await photos.has(id))) { await photos.put(id, b); copied++; }
        }
      } else {
        copied = await importPhotos(photos, filePhotos.filter((p) => ids.has(p.id)));
        lost = [...ids].filter((id) => !filePhotos.some((p) => p.id === id)).length;
      }
      setPhotoNote(`${copied} photo${copied === 1 ? "" : "s"} added${lost ? `; ${lost} photo${lost === 1 ? " was" : "s were"} not in the file` : ""}.`
        + (fb.length ? ` ${feedbackAdded} dinner rating${feedbackAdded === 1 ? "" : "s"} added (the rest were already here).` : "") + feedbackNote + recordNote);
      setResult(res);
      // Re-plan so the list reflects what's there now; a second click adds nothing.
      setItems(planImport(
        { recipes: items.map((i) => i.recipe), entries: items.flatMap((i) => i.newEntries), favouriteRecipeIds: favs, photos: [] },
        await store.existingKeys(),
      ));
    } catch (e) {
      setError(`${e instanceof Error ? e.message : String(e)} — anything already imported is safe; you can run the import again.`);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setItems((xs) => xs && xs.map((x) => (x.recipe.id === id ? { ...x, selected: !x.selected } : x)));
  const chosen = (items ?? []).filter((x) => x.selected);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← All recipes</Link>
      <h1 className="mt-4 text-2xl font-bold text-bark">Backup &amp; import</h1>

      <section className="mt-6 rounded-2xl border border-clay bg-cream p-5">
        <h2 className="font-semibold text-bark">Export</h2>
        <p className="mt-1 text-sm text-bark/70">
          Downloads one file with {shared ? "all family recipes, cooking history" : "every recipe, batch"} and all their photos, plus
          this phone's Sausage Days, tasting cards and recipe versions. Take one on every phone before switching on family sharing, and keep it somewhere safe.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={async () => {
            try { downloadBundle(await bundleWithPhotos(store, photos, readDeviceRecords(window.localStorage))); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>
            {shared ? "Export family recipes" : "Export this device's recipes"}
          </button>
          {shared && <DownloadDeviceExport store={deviceStore} />}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-clay bg-cream p-5">
        <h2 className="font-semibold text-bark">Import</h2>
        <p className="mt-1 text-sm text-bark/70">
          Adds recipes {shared ? "to the family collection" : "to this device"}. It never changes or removes a recipe that's
          already here, and importing the same file twice adds nothing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className={`${secondaryButton} cursor-pointer`}>
            Choose an export file…
            <input type="file" accept="application/json,.json" className="sr-only" onChange={handleFile} />
          </label>
          {shared && (
            <button type="button" className={secondaryButton} onClick={previewDevice}>Import from this device</button>
          )}
        </div>

        {items && (
          <div className="mt-5">
            <p className="text-sm font-medium text-bark">From {source}:</p>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-bark/70">No recipes found.</p>
            ) : (
              <ul className="mt-2 divide-y divide-clay rounded-xl border border-clay bg-white">
                {items.map((x) => {
                  const nothingToAdd = x.status === "already-here" && x.newEntries.length === 0;
                  return (
                    <li key={x.recipe.id} className="flex items-start gap-3 p-3 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`Import ${x.recipe.title}`}
                        className="mt-1"
                        checked={x.selected}
                        disabled={nothingToAdd}
                        onChange={() => toggle(x.recipe.id)}
                      />
                      <div>
                        <p className="font-medium text-bark">{x.recipe.title}</p>
                        <p className="text-bark/60">
                          {x.status === "new" && `New${x.newEntries.length ? ` · ${x.newEntries.length} cooking entr${x.newEntries.length === 1 ? "y" : "ies"}` : ""}`}
                          {x.status === "already-here" && (nothingToAdd
                            ? "Already here — nothing to add"
                            : `Already here — adds ${x.newEntries.length} missing cooking entr${x.newEntries.length === 1 ? "y" : "ies"}; the recipe is left as it is`)}
                          {x.status === "same-title" && "A different recipe with this title is already here — probably a copy. Tick to import it anyway."}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" disabled={busy || chosen.length === 0} onClick={runImport} className={`${primaryButton} mt-4`}>
              {busy ? "Importing…" : `Import ${chosen.length} selected`}
            </button>
          </div>
        )}

        {result && (
          <p role="status" className="mt-4 rounded-xl bg-sage/10 p-3 text-sm text-bark">
            Imported {result.recipesAdded} recipe{result.recipesAdded === 1 ? "" : "s"} and {result.entriesAdded} cooking
            entr{result.entriesAdded === 1 ? "y" : "ies"}. {photoNote} The original data on this device and in the file is unchanged.
          </p>
        )}
        {result && result.failed.length > 0 && (
          <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">These weren't imported (they're still safe where they came from):</p>
            <ul className="mt-1 list-disc pl-5">
              {result.failed.map((f) => <li key={f.title}>{f.title} — {f.error}</li>)}
            </ul>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      </section>
    </div>
  );
}
