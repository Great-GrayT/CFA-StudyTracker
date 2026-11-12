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

export interface SubscribeRequest {
  endpoint: string;
  /**
   * Nested, because that is the shape POST /api/push/subscribe validates and
   * the shape the Push API's own `PushSubscription.toJSON()` produces. This
   * used to be sent flat, as `{ endpoint, p256dh, auth }`, which zod rejected
   * every time: "Add this device" returned "Invalid request body" on every
   * browser and no candidate ever had a working subscription.
   */
  keys: { p256dh: string; auth: string };
}

/**
 * base64url, which is what the Web Push spec uses and what `web-push` decodes
 * on the server.
 *
 * Standard base64 was the second half of the same bug. `btoa` emits '+' and
 * '/', and decoding those as base64url yields different bytes, so even a
 * subscription that got past validation would have produced a key the push
 * service could not decrypt against.
 */
function base64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // A loop, not String.fromCharCode(...spread): a spread of a few hundred
  // bytes is fine, but this is the kind of call that throws
  // "Maximum call stack size exceeded" the day a key gets longer.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The exact body the API expects for a subscription.
 *
 * Separated from the network call so the contract can be tested without a
 * browser. Both sides of this were tested in isolation and neither test
 * noticed they disagreed, which is why the feature was broken from the first
 * deploy.
 */
export function toSubscribePayload(subscription: PushSubscription): SubscribeRequest {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) {
    throw new Error("Failed to extract encryption keys from subscription.");
  }
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: base64Url(p256dh), auth: base64Url(auth) },
  };
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

    await api.post<void>("push/subscribe", toSubscribePayload(subscription));
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
