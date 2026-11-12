// ELK Kitchen's service worker: keeps the app itself (this site's pages,
// scripts, styles, icons) so the kitchen screen still opens without internet.
// It never stores or replays family data: requests to Supabase, Inventory or
// /api go straight to the network, and only GETs from this site are cached.
// What the screen shows offline is its own read-only snapshot (src/lib/home/snapshot.ts).
const CACHE = "elk-kitchen-shell-v1";

// The page and the files it names, so the very first offline open works too.
async function keepShell() {
  const c = await caches.open(CACHE);
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await c.put("/", res);
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await c.addAll([...new Set([...files, "/manifest.webmanifest", "/icon-192.png"])]);
}

self.addEventListener("install", (e) => {
  e.waitUntil(keepShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Pages: the network first (so a new release shows at once), the saved app when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put("/", copy));
      return res;
    }).catch(() => caches.match("/")));
    return;
  }
  // Built files have their content hash in the name, so a saved copy is always right.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
