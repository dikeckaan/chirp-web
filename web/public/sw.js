// CHIRP-Web service worker.
//
// Strategy:
//   - /pyodide/*  + /chirp-bundle/*  → cache-first (immutable assets)
//   - HTML + JS / CSS                 → network-first (so deploys ship)
//   - Everything else                 → network only
//
// Cache name bumps invalidate everything on the next visit.

const CACHE = "chirp-web-v1";
const PRECACHE_PATTERNS = ["/pyodide/", "/chirp-bundle/"];

self.addEventListener("install", (event) => {
  // Activate as soon as the new SW finishes installing.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // skip CDN, etc.

  if (PRECACHE_PATTERNS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request));
  } else if (
    request.destination === "document" ||
    request.destination === "script" ||
    request.destination === "style"
  ) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}
