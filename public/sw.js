const CACHE_NAME = "roster-app-cache-v2"; // ← バージョン変更

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      "/",
    ]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // まずキャッシュを見る
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);

        // 成功したらキャッシュに入れる
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }

        return response;
      } catch {
        // ネットないとき fallback
        const fallback = await cache.match("/");
        return fallback;
      }
    })()
  );
});
