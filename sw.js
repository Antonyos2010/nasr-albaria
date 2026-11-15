/* Service Worker لمتجر ومعرض نسر البرية - إشعارات Web Push + تحديثات فورية */
const CACHE_NAME = "nasr-store-v6";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* استقبال إشعارات Web Push من الخادم حتى لو التطبيق أو المتصفح مغلق */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch (_) {
      payload = {};
    }
  }

  const title = String(payload.title || "متجر نسر البرية الرسمي 🦅");
  const body = String(payload.body || "لديك إشعار جديد من نسر البرية");
  const tag = String(payload.tag || ("nasr-push-" + Date.now()));
  const targetUrl = String(payload.url || "./");
  const icon = String(payload.icon || "./pwa-192x192.png");
  const badge = String(payload.badge || "./favicon-48x48.png");

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    dir: "rtl",
    lang: "ar",
    data: {
      url: targetUrl,
      productId: payload.productId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* عند الضغط على الإشعار يفتح المتجر أو يركز على النافذة المفتوحة */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const targetUrl = data.url || "./";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if (targetUrl && "navigate" in client && client.url !== targetUrl) {
            client.navigate(targetUrl).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
