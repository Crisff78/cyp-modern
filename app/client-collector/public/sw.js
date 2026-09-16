/* Static app shell only. Financial data, authenticated API and receipt URLs never enter Cache Storage. */
const CACHE = "cyp-static-v2";
const SHELL = ["/", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellResponse = await fetch("/", { cache: "reload" });
      if (!shellResponse.ok) throw new Error("Static shell unavailable");
      const html = await shellResponse.clone().text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g),
      ].map((match) => match[1]);
      const cache = await caches.open(CACHE);
      await cache.put("/", shellResponse);
      await cache.addAll([
        ...SHELL.filter((path) => path !== "/"),
        ...new Set(assets),
      ]);
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cyp-static-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api") ||
    request.headers.has("Authorization")
  )
    return;
  if (request.mode === "navigate") {
    // Query navigations receive only the generic offline shell. Neither their URL
    // nor their receipt/API data is ever written to the cache.
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match("/", { ignoreVary: true })) || Response.error(),
      ),
    );
    return;
  }
  if (url.search) return;
  if (!url.pathname.startsWith("/assets/") && !SHELL.includes(url.pathname))
    return;
  // Vite/other hosts set Vary: Origin, while static precache requests have no
  // Origin header. These exact, same-origin public assets are safe to reuse.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
