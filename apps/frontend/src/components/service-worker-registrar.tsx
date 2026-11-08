"use client";

import { useEffect } from "react";

// Register the service worker on mount. Guarded so it does nothing when
// unsupported or in development.
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    // Skip registration in development or if the browser does not support
    // service workers.
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) => {
        // Log but do not surface: a service worker failure should not break
        // the app, and the user cannot act on it anyway.
        console.error("Service worker registration failed:", error);
      });
  }, []);

  return null;
}
