// Openly licensed photos of dishes like the sample ideas (Wikimedia Commons),
// self-hosted. Imported here — not from public/ — so they're only bundled
// into builds that include the prototype. Each photo shows a similar dish,
// not this recipe, and the UI says so.

export type PhotoCredit = {
  id: string; file: string; title: string; author: string;
  license: string; licenseUrl: string; sourceUrl: string; depicts: string;
};

const urls = import.meta.glob<string>("./photos/*.jpg", { eager: true, query: "?url", import: "default" });
const creditFiles = import.meta.glob<PhotoCredit[]>("./photos/credits.json", { eager: true, import: "default" });
export const PHOTO_CREDITS: PhotoCredit[] = Object.values(creditFiles)[0] ?? [];

export function photoFor(id: string): { url: string; credit: PhotoCredit } | null {
  const credit = PHOTO_CREDITS.find((c) => c.id === id);
  const url = credit && urls[`./photos/${credit.file}`];
  return credit && url ? { url, credit } : null;
}
