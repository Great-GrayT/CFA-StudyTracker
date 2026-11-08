// Push notification helpers. All functions typed, no React. Subscriptions are
// persisted on the server; clients fetch them on load to populate push device UI.

import { api } from "./api";

// Check if this browser can support push notifications.
export function isPushSupported(): boolean {
  // 'serviceWorker' is not available in iOS Safari unless the app is installed
  // to the home screen and accessed as a standalone PWA. Non-installed contexts
  // read as false here and cannot use push, which is the correct behavior.
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

// Fetch the current push permission state.
export async function getPermission(): Promise<
  "granted" | "denied" | "default"
> {
  if (!isPushSupported()) return "denied";
  return (await Notification.permission) as "granted" | "denied" | "default";
}

// Fetch any existing subscription for this service worker registration.
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    // getSubscription can reject on a browser that supports the API surface
    // but not subscriptions (e.g. private browsing mode).
    return null;
  }
}

// Convert a base64-encoded VAPID public key to Uint8Array for subscription.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Reverse the URL-safe base64 encoding: '-' to '+', '_' to '/'
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface SubscribeRequest {
  endpoint: string;
  p256dh: string;
  auth: string; // base64-encoded
}

// Subscribe to push notifications. Requests permission first if not yet granted.
// Throws if permission is denied or the browser does not support push.
export async function subscribeToPush(vapidPublicKey: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this browser.");
  }

  // Request permission if not already granted.
  if ((await getPermission()) === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(
        "Push notification permission was denied. Visit settings to allow notifications.",
      );
    }
  }

  if ((await getPermission()) !== "granted") {
    throw new Error(
      "Push notification permission was denied. Visit settings to allow notifications.",
    );
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    // Extract the keys from the subscription.
    const keys = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    if (!keys || !auth) {
      throw new Error("Failed to extract encryption keys from subscription.");
    }

    // Convert ArrayBuffer to base64 for transmission.
    const p256dh = btoa(
      String.fromCharCode(...Array.from(new Uint8Array(keys))),
    );
    const authToken = btoa(
      String.fromCharCode(...Array.from(new Uint8Array(auth))),
    );

    // Send subscription to the server.
    await api.post<void>("push/subscribe", {
      endpoint: subscription.endpoint,
      p256dh,
      auth: authToken,
    } as SubscribeRequest);
  } catch (error) {
    // Re-throw API errors and subscription failures as-is; wrap other errors
    // so the caller has a consistent exception to handle.
    if (error instanceof Error) throw error;
    throw new Error("Failed to subscribe to push notifications.");
  }
}

// Unsubscribe from push notifications.
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return;

    // Unsubscribe locally first to avoid a stale subscription if the server
    // call fails.
    await subscription.unsubscribe();

    // Notify the server to delete the subscription record.
    await api.del<void>("push/subscribe", {
      endpoint: subscription.endpoint,
    });
  } catch (error) {
    // Log but do not re-throw: we have already unsubscribed locally, so
    // re-throwing would leave the user thinking they still have push enabled.
    console.error("Failed to notify server of push unsubscription:", error);
  }
}
