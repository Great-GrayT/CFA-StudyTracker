// Thin wrapper around the `web-push` package. Imported as a default/namespace
// object (never destructured) so tests can `vi.spyOn(webpush, "sendNotification")`
// and intercept the same call this module makes - a destructured
// `import { sendNotification } from "web-push"` would bind to the function
// value at import time, before any spy is installed, and the spy would miss.
import webpush from "web-push";
import { db } from "./db";

// Configured once at module load, same convention as FUNC-auth.ts's
// getSecret(): fail by simply not sending (logged) rather than crashing the
// whole process if the env vars are missing, since push is a best-effort
// notification channel, not a critical path.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

// Wrapped, because setVapidDetails validates and THROWS on a malformed
// subject or key. Unguarded that throw happens at module load, which takes
// down every route importing this file (the cron tick and push/subscribe
// among them) rather than merely disabling push. The commonest cause is a
// VAPID_SUBJECT set to a bare email address: it has to be a mailto: or
// https: URL, so "mailto:you@example.com", never "you@example.com".
let pushReady = false;
if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    pushReady = true;
  } catch (err) {
    console.error(
      "FUNC-push: VAPID details rejected, push sending disabled.",
      err instanceof Error ? err.message : err,
    );
  }
} else {
  console.error("FUNC-push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not fully set; push sending disabled");
}

export type PushPayload = {
  title: string;
  body: string;
  /**
   * Where tapping the notification should land. Optional so existing callers
   * are unaffected; the service worker treats its absence as "just open the
   * app". The coach always sets it, because a notification that says a task is
   * due and then dumps the candidate on a home screen is worse than none.
   */
  url?: string;
  /**
   * Notification tag. Two notifications sharing a tag replace one another, so
   * this must differ per kind of message: with one shared tag the night debrief
   * silently overwrote a prescription the candidate had not read yet. Repeats
   * of the SAME kind replacing each other is the desired behaviour.
   */
  tag?: string;
};

/**
 * Sends `payload` to every PushSubscription row the given user has. Each
 * subscription is handled independently: a failure sending to one (expired,
 * revoked, network blip) never stops the others from being attempted.
 *
 * A 404 or 410 response from the push service means that subscription is
 * permanently dead at the endpoint (the browser unsubscribed, or the
 * endpoint was recycled) - that row is deleted so we stop trying it. Any
 * other failure (5xx, network error, ...) is logged and the row is left in
 * place, since it may be transient.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  // Without this, a bad VAPID config would make every send throw inside the
  // loop below and be swallowed as a per-subscription failure, which reads in
  // the logs as "the push service rejected us" rather than "this server is
  // misconfigured".
  if (!pushReady) return;

  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {
          // Already gone (e.g. deleted concurrently) - fine, that's the goal anyway.
        });
      } else {
        console.error(`FUNC-push: failed to send to subscription ${sub.id}`, err);
      }
    }
  }
}
