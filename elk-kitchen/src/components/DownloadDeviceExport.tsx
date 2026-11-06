import { readDeviceData, type DeviceRecipeStore } from "../lib/recipeStorage";
import { IndexedDbPhotoStore, bundleWithPhotos } from "../lib/photos";
import { downloadBundle } from "../lib/download";

// A way out for recipes saved in this browser, shown wherever someone could
// otherwise be stuck (not on the family list, access errors, the data page).
export function DownloadDeviceExport({ store }: { store: DeviceRecipeStore }) {
  const data = readDeviceData(window.localStorage);
  if (!data || data.recipes.length === 0) return null;
  return (
    <button
      type="button"
      onClick={async () => downloadBundle(await bundleWithPhotos(store, new IndexedDbPhotoStore()))}
      className="rounded-xl border border-clay bg-cream px-4 py-2 text-sm font-medium text-bark hover:bg-clay/20"
    >
      Download this device's recipes ({data.recipes.length})
    </button>
  );
}
