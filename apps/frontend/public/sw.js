// Service worker for Study Tracker. Implements a hybrid caching strategy:
// cache-first for static assets, network-first for navigations, never cache /api/.

// Versioned from the registration URL (`/sw.js?v=<build id>`), not from a
// constant edited by hand. Two things depended on that and both were broken:
// a hand-edited constant is forgotten on the deploy that needed it, so a new
// release kept serving the previous build's shell out of the old cache; and
// the browser decides whether to install a new worker by byte-comparing this
// file, which never changes between releases, so no update was ever detected
// at all. The build id moves every deploy, so both now follow the deploy.
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `study-tracker-${CACHE_VERSION}`;

// App shell: routes cached for offline read access.
//
// Every entry must be a real route that answers 200 without redirecting.
// "/register" was never a route (creating an account is a tab on /login) and
// "/" is a 307 to /today or /login depending on the session. Both were fatal
// rather than cosmetic: see the install handler below.
const SHELL_ROUTES = ["/login", "/today", "/onboarding"];

// Static asset patterns: cache-first.
const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /\.(woff2|woff|ttf|otf)$/,
  /\/(icon|favicon|mask-icon)/,
  /\.png$|\.jpg$|\.jpeg$|\.svg$|\.webp$/,
];

// Precache the app shell on install.
//
// Deliberately NOT cache.addAll. addAll is all-or-nothing: one 404 among the
// routes rejects the whole promise, install fails, and the worker never
// reaches activated. A redirect does the same, because a redirected response
// cannot be written to a cache at all. The shell list contained one of each,
// so this worker had never installed on any device - which is not merely an
// offline problem. `navigator.serviceWorker.ready` waits for an ACTIVE
// worker, so it never settled, and push subscription awaits it: tapping "Add
// this device" hung forever and no notification could ever be delivered.
//
// Each route is now fetched on its own and a failure is skipped. A shell
// entry that is missing costs one offline page; it must never cost the
// install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        SHELL_ROUTES.map(async (route) => {
          try {
            // `redirect: "follow"` would hand back a response cache.put
            // rejects; "error" turns a redirect into a failure this skips.
            const response = await fetch(route, { redirect: "error" });
            if (response.ok) await cache.put(route, response);
          } catch {
            // Offline at install time, or the route moved. Neither is worth
            // failing the install over.
          }
        }),
      );
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
            // "/" is a redirect and is never in the cache, so it was a
            // fallback that always resolved to undefined. /today is the
            // signed-in home and is precached.
            return response || caches.match("/today") || caches.match("/login");
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
  let urgent = false;

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      body = data.body || body;
      tag = data.tag || tag;
      url = data.url || url;
      urgent = data.urgent === true;
    } catch {
      // If the push event data is not valid JSON, use the text as the body.
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      // Alpha-only silhouette: Android paints a full-colour badge as a white square.
      badge: "/badge-96.png",
      icon: "/icon-192.png",
      // Carried through to notificationclick, which is the only way the click
      // handler can know where this particular notification should land.
      data: { url },
      // Coach messages are meant to be noticed. requireInteraction keeps it
      // on screen until acted on, renotify re-alerts even when replacing a
      // same-tag notification, and the vibration is long enough to feel in a
      // pocket. Android lets the user raise it further per site (sound, pop
      // on screen); a web page cannot set an alarm sound or pass Do Not Disturb.
      ...(urgent && {
        requireInteraction: true,
        renotify: true,
        silent: false,
        vibrate: [600, 200, 600, 200, 1200],
      }),
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

// Activate a new worker only when the page asks, never on its own.
//
// This file used to call `self.skipWaiting()` at the top level, which runs as
// soon as the script is parsed. That made the new worker take over while the
// old page was still running, and an already-loaded page then requested the
// previous build's JavaScript chunks from a worker that had just deleted the
// cache holding them: the app half-updated under the person's feet, mid-use.
// It also meant the worker never sat in `waiting`, so the page had no moment
// at which to offer an update and nothing could ever tell the person a new
// version existed.
//
// Now the new worker waits, the page notices it waiting and offers a reload,
// and this message is what the reload sends back.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
