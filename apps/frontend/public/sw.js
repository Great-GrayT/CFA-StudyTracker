// Service worker for Study Tracker. Implements a hybrid caching strategy:
// cache-first for static assets, network-first for navigations, never cache /api/.

const CACHE_VERSION = "v1";
const CACHE_NAME = `study-tracker-${CACHE_VERSION}`;

// App shell: routes that should be cached for offline read access.
const SHELL_ROUTES = ["/", "/login", "/register", "/onboarding"];

// Static asset patterns: cache-first.
const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /\.(woff2|woff|ttf|otf)$/,
  /\/(icon|favicon|mask-icon)/,
  /\.png$|\.jpg$|\.jpeg$|\.svg$|\.webp$/,
];

// Precache the app shell on install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ROUTES);
    }),
  );
});

// Clean up stale caches on activate.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        }),
      );
    }),
  );
  // Claim all existing clients so an update takes effect immediately.
  self.clients.claim();
});

// Fetch strategy: cache-first for static, network-first for navigations.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API requests: they are per-user and auth-bearing.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets: cache-first.
  if (STATIC_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) return response;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        });
      }),
    );
    return;
  }

  // Navigation requests: network-first with a cached fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((response) => {
            return response || caches.match("/");
          });
        }),
    );
    return;
  }

  // Default: network-first for other requests.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status !== 200) return response;
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return response;
      })
      .catch(() => caches.match(request)),
  );
});

// Handle push notifications.
self.addEventListener("push", (event) => {
  let title = "Study Tracker";
  let body = "You have a notification";
  // Per-slot by default from the sender, so the morning prescription, the
  // evening nudge and the night debrief do not silently replace one another.
  // A single shared tag meant the debrief overwrote an unread prescription.
  let tag = "study-tracker-notification";
  let url = "/";

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      tag = data.tag || tag;
      url = data.url || url;
    } catch {
      // If the push event data is not valid JSON, use the text as the body.
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      badge: "/icon-192.png",
      icon: "/icon-192.png",
      // Carried through to notificationclick, which is the only way the click
      // handler can know where this particular notification should land.
      data: { url },
    }),
  );
});

// Handle notification clicks.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // The notification says which day's plan it is about, so the click has to
  // land there. Opening the root instead made the coach's "start with Fixed
  // Income LM2" arrive as a home screen with no task in sight.
  const target = (event.notification.data && event.notification.data.url) || "/";
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // client.url is absolute, so comparing it to a path never matched and
          // an already-open tab was never focused. Compare like with like, and
          // navigate the existing tab rather than opening a duplicate.
          if (new URL(client.url).pathname === targetUrl.pathname && "focus" in client) {
            return client.focus();
          }
        }
        for (const client of clientList) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(targetUrl.href).then((c) => (c ? c.focus() : undefined));
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl.href);
        }
      }),
  );
});

// Skip waiting: make updates take effect immediately on next load.
self.skipWaiting();
