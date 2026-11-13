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

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "邮件运营提醒", { body: payload.body || "有新的待处理邮件", data: { url: payload.url || "/mail-operations" }, icon: "/iway-logo.png", badge: "/iway-logo.png" }));
});
self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(clients.openWindow(event.notification.data?.url || "/mail-operations")); });
