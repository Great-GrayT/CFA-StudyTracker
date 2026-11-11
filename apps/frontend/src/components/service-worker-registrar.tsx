"use client";

import { useEffect } from "react";
import { toast } from "sonner";

// How often an open app asks whether a new release has shipped. An installed
// PWA can stay open for days without a navigation, and nothing else would
// tell it.
const UPDATE_CHECK_MS = 30 * 60 * 1000;

// The build this document was served by. The service worker is registered
// under it so that a release changes the script URL: the browser decides
// whether to install a replacement worker by comparing the bytes at that URL,
// and public/sw.js is identical in every build, so without this no deploy was
// ever detected as an update.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/**
 * Registers the service worker and runs the update handshake.
 *
 * Two routes to the same prompt, because they cover different situations and
 * neither covers both:
 *
 *  - A worker sitting in `waiting`. Happens when the page was loaded after a
 *    release, so a new worker installed behind the one still controlling the
 *    page. Resolved by telling it to skip waiting and reloading when it takes
 *    control.
 *  - The origin reporting a different build id. Happens when the app has been
 *    open since before the release and has never re-registered anything. A
 *    plain reload picks up the new document, which registers the new worker.
 */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    let cancelled = false;
    let skipWaitingSent = false;
    let offered = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    // Reload once the new worker controls the page, which is the first moment
    // every open document is running the same build. Guarded on our own
    // message, because controllerchange also fires on a first registration,
    // where there is nothing to reload into.
    const onControllerChange = () => {
      if (skipWaitingSent) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    function offer(waiting: ServiceWorker | null) {
      // One prompt at a time. Both routes can fire for the same release and
      // two stacked toasts saying the same thing is worse than one.
      if (offered || cancelled) return;
      offered = true;

      toast("A new version is ready.", {
        // No auto-dismiss: an update notice that disappears before it is read
        // is an update that never happens. It is still dismissible.
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            if (waiting) {
              skipWaitingSent = true;
              waiting.postMessage({ type: "SKIP_WAITING" });
            } else {
              window.location.reload();
            }
          },
        },
        onDismiss: () => {
          // Dismissing declines this prompt, not every future one.
          offered = false;
        },
      });
    }

    function watchWorker(registration: ServiceWorkerRegistration) {
      if (registration.waiting && navigator.serviceWorker.controller) {
        offer(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `installed` with an existing controller means a replacement, not
          // a first install. Without the controller check the very first
          // visit would be told to reload into the build it is already
          // running.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            offer(installing);
          }
        });
      });
    }

    async function checkDeployedBuild() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (buildId && buildId !== BUILD_ID) offer(null);
      } catch {
        // Offline, or the origin is mid-deploy. The next tick tries again.
      }
    }

    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        watchWorker(registration);
      })
      .catch((error) => {
        // Log but do not surface: a service worker failure should not break
        // the app, and the user cannot act on it anyway. The build check
        // below still runs, so updates are still noticed.
        console.error("Service worker registration failed:", error);
      });

    timer = setInterval(checkDeployedBuild, UPDATE_CHECK_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
