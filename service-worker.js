// v2: bytt cache-namn (rensar ut allt gammalt) och bytt strategi till
// nätverk-först, så en ny deploy alltid syns direkt när du är online.
// Cachen används bara som offline-fallback.
const CACHE_NAME = "stash-cache-v2";
const SHELL_FILES = [
  "index.html",
  "library.html",
  "review.html",
  "styles.css",
  "storage.js",
  "discover.js",
  "index.js",
  "library.js",
  "review.js",
  "manifest.webmanifest",
  "icons/icon128.png",
  "icons/icon192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Nätverk först för appskalet (alltid färsk kod när du är online), med
// cachen som fallback om nätverket är nere. RSS-hämtningar går till
// andra domäner och rör aldrig den här hanteraren (origin-kollen nedan).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
