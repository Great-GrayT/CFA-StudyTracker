import { beforeEach, test, expect, vi } from "vitest";
import webpush from "web-push";
import { resetDb } from "../helpers/test-db";
import { registerUser, authedRequest } from "../helpers/fixtures";
import { db } from "../../src/lib/db";
import { POST, DELETE } from "../../src/app/api/push/subscribe/route";
import { GET as LIST } from "../../src/app/api/push/subscriptions/route";
import { sendPushToUser } from "../../src/lib/FUNC-push";

beforeEach(async () => {
  await resetDb();
});

test("POST /api/push/subscribe stores a subscription for the caller", async () => {
  const user = await registerUser();
  const res = await POST(
    authedRequest(user, "/api/push/subscribe", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "k1", auth: "k2" },
    }),
  );
  expect(res.status).toBe(201);
  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
});

// The device list showed only "Added <date>", so nobody could tell which
// entry was the phone.
test("a subscription is named after the device that registered it", async () => {
  const user = await registerUser();
  await POST(
    authedRequest(user, "/api/push/subscribe", {
      endpoint: "https://push.example/phone",
      keys: { p256dh: "k1", auth: "k2" },
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    }),
  );
  const res = await LIST(authedRequest(user, "/api/push/subscriptions", undefined, "GET"));
  const body = await res.json();
  expect(body.subscriptions[0].label).toBe("Android · Chrome");
});

test("DELETE /api/push/subscribe removes a subscription by endpoint", async () => {
  const user = await registerUser();
  await POST(
    authedRequest(user, "/api/push/subscribe", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "k1", auth: "k2" },
    }),
  );
  const res = await DELETE(authedRequest(user, "/api/push/subscribe", { endpoint: "https://push.example/abc" }));
  expect(res.status).toBe(200);
  expect(await db.pushSubscription.count()).toBe(0);
});

// Re-subscribing the same endpoint (e.g. the browser re-registers the same
// service worker subscription) must update the existing row, never insert a
// second one for it.
test("POST /api/push/subscribe upserts by endpoint instead of duplicating", async () => {
  const user = await registerUser();
  const body = { endpoint: "https://push.example/abc", keys: { p256dh: "k1", auth: "k2" } };
  await POST(authedRequest(user, "/api/push/subscribe", body));
  const res = await POST(authedRequest(user, "/api/push/subscribe", { ...body, keys: { p256dh: "k1-new", auth: "k2-new" } }));
  expect(res.status).toBe(201);
  expect(await db.pushSubscription.count()).toBe(1);
  const row = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: body.endpoint } });
  expect(row.p256dh).toBe("k1-new");
});

// Deleting a subscription that was never created (or already removed) is
// not an error - the caller's device state and the server's can legitimately
// drift, and retrying a DELETE must stay safe.
test("DELETE /api/push/subscribe is idempotent when the subscription is already absent", async () => {
  const user = await registerUser();
  const res = await DELETE(authedRequest(user, "/api/push/subscribe", { endpoint: "https://push.example/never-existed" }));
  expect(res.status).toBe(200);
  expect(await db.pushSubscription.count()).toBe(0);
});

test("sendPushToUser deletes the subscription row when the push service responds 410 Gone", async () => {
  const user = await registerUser();
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: "https://push.example/gone", p256dh: "k1", auth: "k2" },
  });
  const sendSpy = vi.spyOn(webpush, "sendNotification").mockRejectedValue({ statusCode: 410 });

  await sendPushToUser(user.id, { title: "t", body: "b" });

  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  sendSpy.mockRestore();
});

test("sendPushToUser keeps the subscription row when the push service fails for a non-404/410 reason", async () => {
  const user = await registerUser();
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: "https://push.example/transient-failure", p256dh: "k1", auth: "k2" },
  });
  const sendSpy = vi.spyOn(webpush, "sendNotification").mockRejectedValue({ statusCode: 500 });

  await sendPushToUser(user.id, { title: "t", body: "b" });

  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  sendSpy.mockRestore();
});

// High urgency is what makes Android deliver at once instead of batching the
// push until the phone next wakes from Doze. The TTL drops a morning message
// the push service could not deliver for hours rather than showing it at night.
test("sendPushToUser sends at high urgency with a bounded TTL, and counts deliveries", async () => {
  const user = await registerUser();
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: "https://push.example/ok", p256dh: "k1", auth: "k2" },
  });
  const sendSpy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({} as never);

  const result = await sendPushToUser(user.id, { title: "t", body: "b" });

  expect(result).toEqual({ delivered: 1, failed: 0 });
  expect(sendSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    expect.objectContaining({ urgency: "high", TTL: 4 * 60 * 60 }),
  );
  sendSpy.mockRestore();
});
