/*
 * Compatibility worker. Earlier releases cached Next.js build files. Safari can
 * retain those files across deployments, leaving an old client bundle paired
 * with a new page response. The dispatch system is online-only, so it is safer
 * to keep installation support without intercepting or caching application
 * resources.
 */
const LEGACY_CACHE_PREFIX = "iway-static-";

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.resolve(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
