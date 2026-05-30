// CHIRP-Web service worker.
//
// Two jobs:
//   1. Cache Pyodide + the chirp bundle for fast / offline reloads.
//   2. On hosts that don't natively send COOP/COEP (GitHub Pages),
//      inject those headers so SharedArrayBuffer lights up. The
//      first visit registers the SW, then we reload — pattern from
//      `gzuidhof/coi-serviceworker`.
//
// Cache name bumps invalidate everything on the next visit.

const CACHE = "chirp-web-v4";

// Compute paths relative to the SW location so we work both at root
// (Cloudflare Pages) and under `/chirp-web/` (GitHub Pages).
const SW_BASE = new URL("./", self.location.href).pathname; // e.g. "/chirp-web/"
const PRECACHE_PATTERNS = [
  SW_BASE + "pyodide/",
  SW_BASE + "chirp-bundle/",
];

self.addEventListener("install", () => {
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
  } else {
    // Pass-through, but still apply COI headers so embedded resources
    // (worker.js, images, font, etc.) keep the page isolated.
    event.respondWith(passthroughWithCoi(request));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return withCoi(hit);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return withCoi(res);
  } catch (e) {
    if (hit) return withCoi(hit);
    throw e;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return withCoi(res);
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return withCoi(hit);
    throw e;
  }
}

async function passthroughWithCoi(req) {
  try {
    const res = await fetch(req);
    return withCoi(res);
  } catch (e) {
    return new Response(null, { status: 502, statusText: String(e) });
  }
}

// Inject COOP/COEP headers when not already present. Mutates response
// via clone — original body is reused. Opaque responses (cross-origin,
// no CORS) can't have headers rewritten; passed through unchanged.
function withCoi(response) {
  if (response.type === "opaque" || response.type === "opaqueredirect") {
    return response;
  }
  const headers = new Headers(response.headers);
  // Always overwrite — `set()` replaces existing entries. CORP is
  // required for cross-origin sub-resources to load under COEP.
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  // Diagnostic marker so we can confirm in DevTools that the SW
  // actually intercepted this response.
  headers.set("X-Chirp-Coi", "sw");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
