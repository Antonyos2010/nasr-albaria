const CACHE_NAME = "nasr-albaria-shell-v6";
const CACHE_PREFIX = "nasr-albaria-shell-";
const PRESERVED_CACHES = new Set([CACHE_NAME, "nasr-device-id"]);
const SHELL_URL = new URL("./", self.location.href).href;
const MAX_CACHED_ASSETS = 120;
const MAX_CACHEABLE_BYTES = 8 * 1024 * 1024;
const PRECACHE_URLS = [
  "./",
  "./manifest.json",
  "./pwa-192x192.png",
  "./pwa-512x512.png",
  "./pwa-maskable-512x512.png",
  "./favicon-48x48.png",
  "./apple-touch-icon.png"
];
const STATIC_EXTENSIONS = /\.(?:avif|css|gif|ico|jpe?g|js|json|otf|png|svg|webp|woff2?|ttf)$/i;

function isCacheableResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;
  const length = Number(response.headers.get("content-length"));
  return !Number.isFinite(length) || length <= MAX_CACHEABLE_BYTES;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHED_ASSETS;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // Cache each shell asset independently so one missing icon cannot
        // prevent the rest of the app shell from being available offline.
        await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => {
        // Only remove this app's old shell caches; don't delete caches owned
        // by another app on the same origin.
        if (key.startsWith(CACHE_PREFIX) && !PRESERVED_CACHES.has(key)) {
          return caches.delete(key);
        }
        return Promise.resolve();
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  // Never cache API/auth requests or navigations carrying callback/reset data.
  if (url.pathname.includes("/api/") || url.pathname.includes("/auth/") || url.search) return;

  if (request.mode === "navigate") {
    // Keep only the clean app entry point as an offline fallback. Other pages
    // and callback routes remain network-only and cannot overwrite the shell.
    const isAppShell = url.pathname === scopeUrl.pathname || url.pathname === `${scopeUrl.pathname}index.html`;
    event.respondWith(
      fetch(request).then((response) => {
        if (isAppShell && isCacheableResponse(response)) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy)));
        }
        return response;
      }).catch(async () => {
        if (!isAppShell) return Response.error();
        return (await caches.match(SHELL_URL)) || Response.error();
      })
    );
    return;
  }

  // Limit runtime caching to static assets, avoiding accidental storage of
  // user-specific HTML or other dynamic same-origin responses.
  if (!STATIC_EXTENSIONS.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      // Serve instantly from disk while refreshing in the background.
      event.waitUntil(fetch(request).then(async (response) => {
        if (isCacheableResponse(response)) {
          await cache.put(request, response.clone());
          await trimCache(cache);
        }
      }).catch(() => {}));
      return cached;
    }

    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
      await trimCache(cache);
    }
    return response;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch (ignored) {}
  }

  const title = payload.title || "متجر نسر البرية الرسمي";
  let icon = new URL("./pwa-192x192.png", self.location.href).href;
  let badge = new URL("./favicon-48x48.png", self.location.href).href;
  try {
    const candidate = new URL(payload.icon || icon, self.location.href);
    if (candidate.origin === self.location.origin) icon = candidate.href;
  } catch (error) {}
  try {
    const candidate = new URL(payload.badge || badge, self.location.href);
    if (candidate.origin === self.location.origin) badge = candidate.href;
  } catch (error) {}

  let target = SHELL_URL;
  try {
    const candidate = new URL(payload.url || SHELL_URL, self.location.href);
    if (candidate.origin === self.location.origin && candidate.pathname.startsWith(new URL(self.registration.scope).pathname)) {
      target = candidate.href;
    }
  } catch (error) {}

  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "تتوفر عروض ومنتجات جديدة الآن",
    icon,
    badge,
    tag: payload.tag || "nasr-notif",
    data: { url: target }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let targetUrl = SHELL_URL;
  try {
    const candidate = new URL(event.notification.data && event.notification.data.url || SHELL_URL, self.location.href);
    if (candidate.origin === self.location.origin && candidate.pathname.startsWith(new URL(self.registration.scope).pathname)) {
      targetUrl = candidate.href;
    }
  } catch (error) {}

  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  }));
});
