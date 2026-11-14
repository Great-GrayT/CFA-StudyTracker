import { describe, expect, test } from "vitest";
import { toSubscribePayload } from "./push";

/**
 * The payload the browser's PushSubscription turns into, checked against the
 * shape the API actually accepts.
 *
 * This is the test that was missing. The backend's own tests all post
 * `{ endpoint, keys: { p256dh, auth } }` and pass, while the client posted
 * `{ endpoint, p256dh, auth }` and was rejected with "Invalid request body"
 * every single time. Both sides were tested; the wire between them was not,
 * so push subscription had never once worked.
 */

/** A stand-in for the browser's PushSubscription. */
function fakeSubscription(overrides: Partial<{ endpoint: string }> = {}) {
  // Bytes chosen so the base64 of them contains both a '+' and a '/', which
  // is what tells standard base64 and base64url apart.
  const p256dh = new Uint8Array([0xfb, 0xff, 0xbf, 0x3e, 0x7a]);
  const auth = new Uint8Array([0xfa, 0xfb, 0xfc, 0xfd]);
  return {
    endpoint: overrides.endpoint ?? "https://fcm.googleapis.com/fcm/send/abc123",
    getKey(name: string) {
      if (name === "p256dh") return p256dh.buffer;
      if (name === "auth") return auth.buffer;
      return null;
    },
  } as unknown as PushSubscription;
}

describe("toSubscribePayload", () => {
  test("nests the keys, because that is what the API accepts", () => {
    const body = toSubscribePayload(fakeSubscription());

    expect(body.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
    // The whole bug: these must live under `keys`, not at the top level.
    expect(body.keys).toBeDefined();
    expect(typeof body.keys.p256dh).toBe("string");
    expect(typeof body.keys.auth).toBe("string");
    expect(body).not.toHaveProperty("p256dh");
    expect(body).not.toHaveProperty("auth");
  });

  // The server names the device from it; the proxy replaces the header.
  test("carries the browser's user agent so the device can be named", () => {
    const body = toSubscribePayload(fakeSubscription());
    expect(body.userAgent).toBe(navigator.userAgent);
  });

  test("encodes the keys as base64url, not standard base64", () => {
    const body = toSubscribePayload(fakeSubscription());

    // web-push decodes these as base64url. A '+' or '/' in the string means
    // the bytes it reconstructs are not the bytes the browser handed us, and
    // every notification to that device fails to decrypt.
    for (const value of [body.keys.p256dh, body.keys.auth]) {
      expect(value).not.toMatch(/[+/=]/);
    }
  });

  test("refuses a subscription with no keys rather than posting a broken one", () => {
    const keyless = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      getKey: () => null,
    } as unknown as PushSubscription;

    expect(() => toSubscribePayload(keyless)).toThrow(/key/i);
  });
});
