// Kortkoll: cachar appskalet så sidorna öppnas även offline (själva
// skanningen kräver nätet). Nätverk först, så en ny deploy syns direkt.
// Registreras från kort/ och styr därför bara kort/-sidorna.
const CACHE_NAME = "kortkoll-cache-v1";
const SHELL_FILES = [
  "index.html",
  "samling.html",
  "kort.css",
  "kort.js",
  "manifest.webmanifest",
  "icons/icon128.png",
  "icons/icon192.png",
  "icons/icon512.png",
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kortkoll-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
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
