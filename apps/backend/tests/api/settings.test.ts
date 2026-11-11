import { beforeEach, test, expect } from "vitest";
import { resetDb } from "../helpers/test-db";
import { readJson } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/settings/route";
import {
  registerUser,
  setupUserWithPlan,
  authedRequest,
  ensureLevel,
  anyLosIdForLevel,
} from "../helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  await anyLosIdForLevel("I");
});

test("settings require a signed-in user", async () => {
  const res = await GET(new Request("http://test/api/settings"));
  expect(res.status).toBe(401);
});

test("the active plan's preferences come back in one read", async () => {
  const { user, plan } = await setupUserWithPlan();
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { emailCoach: "debrief-only", pushCoach: "off", timeZone: "Europe/London" },
  });

  const res = await GET(authedRequest(user, "/api/settings", undefined, "GET"));
  expect(res.status).toBe(200);

  const body = await readJson(res);
  expect(body.plan.emailCoach).toBe("debrief-only");
  expect(body.plan.pushCoach).toBe("off");
  expect(body.plan.timeZone).toBe("Europe/London");
  expect(body.account.email).toBe(user.email);
});

test("a user between plans still gets a renderable payload", async () => {
  // A settings screen must not break for somebody who has finished one plan and
  // not yet started another.
  const user = await registerUser();
  const res = await GET(authedRequest(user, "/api/settings", undefined, "GET"));
  expect(res.status).toBe(200);

  const body = await readJson(res);
  expect(body.plan).toBeNull();
  expect(body.account.email).toBe(user.email);
  expect(body.devices).toEqual([]);
});

test("only the active plan is reported, not an archived one", async () => {
  const { user, plan } = await setupUserWithPlan();
  await db.studyPlan.update({ where: { id: plan.id }, data: { isActive: false } });

  const body = await readJson(await GET(authedRequest(user, "/api/settings", undefined, "GET")));
  expect(body.plan).toBeNull();
});

test("registered devices are listed without exposing their push credentials", async () => {
  // A subscription endpoint plus its keys is a bearer credential for sending to
  // that device. The screen needs a count and a way to revoke, never the keys.
  const { user } = await setupUserWithPlan();
  // Distinctive values, not "k1"/"k2". Two characters collide with the random
  // cuids in the same payload often enough to fail this test for the wrong
  // reason: a plan id of cmwcobi130013v9vk1ly4bw5k contains "k1".
  const p256dh = "p256dh-must-not-be-returned";
  const auth = "auth-must-not-be-returned";
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: "https://push.example/abc", p256dh, auth },
  });

  const res = await GET(authedRequest(user, "/api/settings", undefined, "GET"));
  const raw = await res.clone().text();
  const body = await readJson(res);

  expect(body.devices).toHaveLength(1);
  expect(body.devices[0].id).toBeTruthy();
  expect(raw).not.toContain("push.example");
  expect(raw).not.toContain(p256dh);
  expect(raw).not.toContain(auth);
});

test("no password hash, TOTP secret or token ever appears in the payload", async () => {
  const { user } = await setupUserWithPlan();
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });

  const res = await GET(authedRequest(user, "/api/settings", undefined, "GET"));
  const raw = await res.text();

  expect(raw).not.toContain("passwordHash");
  expect(raw).not.toContain("totpSecret");
  if (row.passwordHash) {
    expect(raw).not.toContain(row.passwordHash);
  }
  // Booleans instead, which is what a settings screen actually needs.
  const body = JSON.parse(raw);
  expect(typeof body.account.hasPassword).toBe("boolean");
  expect(typeof body.account.twoStepEnabled).toBe("boolean");
});

test("a location that was never set reads as null rather than a half-filled object", async () => {
  const { user } = await setupUserWithPlan();
  const body = await readJson(await GET(authedRequest(user, "/api/settings", undefined, "GET")));
  expect(body.plan.location).toBeNull();
});

test("a set location comes back whole", async () => {
  const { user, plan } = await setupUserWithPlan();
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { city: "Oslo", countryCode: "NO", latitude: 59.91, longitude: 10.75 },
  });

  const body = await readJson(await GET(authedRequest(user, "/api/settings", undefined, "GET")));
  expect(body.plan.location).toEqual({
    city: "Oslo",
    countryCode: "NO",
    latitude: 59.91,
    longitude: 10.75,
  });
});

test("one user never sees another user's plan or devices", async () => {
  const { user: owner } = await setupUserWithPlan();
  await db.pushSubscription.create({
    data: { userId: owner.id, endpoint: "https://push.example/owner", p256dh: "k1", auth: "k2" },
  });
  await ensureLevel("I");
  const stranger = await registerUser();

  const body = await readJson(
    await GET(authedRequest(stranger, "/api/settings", undefined, "GET")),
  );
  expect(body.plan).toBeNull();
  expect(body.devices).toEqual([]);
  expect(body.account.email).toBe(stranger.email);
});
