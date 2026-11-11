/**
 * Unsubscribe tokens for the coach emails.
 *
 * A candidate must be able to stop the emails FROM an email, without logging
 * in. That is not a nicety: it is what every mailbox provider expects, and a
 * sender without a working unsubscribe gets filed as spam, which silently takes
 * every other email with it. The alternative a frustrated candidate reaches for
 * is the "report spam" button, and that costs the sending domain far more than
 * one lost subscriber.
 *
 * Stateless by design: the token is an HMAC over the plan id and the channel,
 * so there is no column to add, nothing to clean up, and no lookup before the
 * signature is checked. Rotating JWT_SECRET invalidates every outstanding link,
 * which is the only revocation this needs.
 *
 * The token deliberately DOES NOT EXPIRE. An unsubscribe link in a nine month
 * old email must still work; expiring it would leave the candidate holding a
 * dead link and no way out, which is precisely the situation that produces a
 * spam complaint.
 *
 * Channel is inside the signed payload rather than a separate query parameter,
 * so a link that silences email cannot be edited into one that silences push.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeChannel = "email" | "push";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return value;
}

function sign(planId: string, channel: UnsubscribeChannel): string {
  return createHmac("sha256", secret())
    .update(`unsubscribe:${channel}:${planId}`)
    .digest("base64url");
}

/** The opaque token that goes in an unsubscribe URL. */
export function unsubscribeToken(planId: string, channel: UnsubscribeChannel): string {
  return `${planId}.${channel}.${sign(planId, channel)}`;
}

/**
 * Verifies a token and returns what it authorises, or null.
 *
 * Returns null for every kind of bad input rather than throwing or
 * distinguishing between them, so a caller cannot accidentally leak whether a
 * plan id exists by the shape of the error.
 */
export function verifyUnsubscribeToken(
  token: string
): { planId: string; channel: UnsubscribeChannel } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [planId, channel, signature] = parts as [string, string, string];
  if (planId.length === 0) return null;
  if (channel !== "email" && channel !== "push") return null;

  const expected = sign(planId, channel);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  // Guard the length first: timingSafeEqual throws on a mismatch, and a throw
  // here would be an oracle for the signature length.
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { planId, channel };
}

/** The full link for an email footer, or for a List-Unsubscribe header. */
export function unsubscribeUrl(
  planId: string,
  channel: UnsubscribeChannel,
  appUrl: string
): string {
  return `${appUrl.replace(/\/+$/, "")}/api/coach/unsubscribe?token=${unsubscribeToken(planId, channel)}`;
}
