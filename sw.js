/* =====================================================================
   Service worker — makes the calculator work offline
   ---------------------------------------------------------------------
   The browser runs this file in the background (separately from the page).
   It keeps a copy of every calculator file on the phone, so the app opens
   instantly and works with no internet connection.

   Strategy ("stale-while-revalidate"):
     1. Answer every request straight from the saved copy (fast, offline-safe).
     2. At the same time, fetch the newest version from the internet and
        save it, so the NEXT launch shows any updates.
   ===================================================================== */

/* Name of the saved copy. Change the number (v1 → v2) if you ever need to
   force every phone to throw away the old copy and download fresh files. */
const CACHE = "calc-v2"; // v2: added the login (auth.js)

/* Files saved on first install, so the app works offline right away. */
const FILES = [
  "./",
  "./calc.htm",
  "./calc.css",
  "./calc.js",
  "./auth.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* Install: runs once when the app is first opened. Downloads and saves all files. */
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting(); // start working immediately instead of waiting for a reload
});

/* Activate: runs after install. Deletes saved copies from older versions. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim(); // take control of the already-open page
});

/* Fetch: runs for every file the page asks for. */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return; // only plain downloads can be cached

  // Only save our own files and Firebase's code (from www.gstatic.com).
  // Everything else — logins, Analytics — always goes straight to the internet,
  // so nobody's login or statistics are ever stored in the saved copy.
  const origin = new URL(event.request.url).origin;
  if (origin !== self.location.origin && origin !== "https://www.gstatic.com") return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const saved = await cache.match(event.request, { ignoreSearch: true });

      // Get the newest version in the background and update the saved copy.
      const fresh = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => saved); // offline: fall back to the saved copy

      // Use the saved copy if there is one; otherwise wait for the internet.
      return saved || fresh;
    })
  );
});
