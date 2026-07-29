/*
 * This worker deliberately never stores order data, API responses, login pages,
 * uploaded vehicle photos, or any other user content. It only caches the
 * application build assets and the offline notice needed to show a safe fallback.
 */
const CACHE_NAME = "iway-static-v1";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSET_PREFIX = "/_next/static/";
const APP_ICON_URL = "/iway-logo.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL, APP_ICON_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API responses and login/order routes may contain private information.
  if (url.pathname.startsWith("/api/") || url.pathname === "/login" || url.pathname.startsWith("/orders")) {
    return;
  }

  // Never cache uploaded photos or other images. The app icon is the sole
  // exception because it is a fixed public asset used for installation.
  if (request.destination === "image" && url.pathname !== APP_ICON_URL) return;

  // Navigation remains network-only. When offline, serve a non-sensitive notice
  // instead of a previously viewed page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Next's hashed build files are safe, non-user-specific static resources.
  if (url.pathname.startsWith(STATIC_ASSET_PREFIX) || url.pathname === APP_ICON_URL) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") return response;
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          return response;
        });
      }),
    );
  }
});
