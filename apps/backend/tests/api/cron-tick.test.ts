import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb } from "../helpers/test-db";
import { jsonRequest } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/cron/tick/route";
import { setupUserWithPlan, ensureLevel, fullWeek } from "../helpers/fixtures";
import * as pushModule from "../../src/lib/FUNC-push";

beforeEach(async () => {
  await resetDb();
  await ensureLevel("I");
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("tick without the correct bearer secret returns 401", async () => {
  const res = await GET(jsonRequest("GET", "/api/cron/tick"));
  expect(res.status).toBe(401);
});

test("tick writes one ProgressSnapshot per active plan for today", async () => {
  await setupUserWithPlan();
  await setupUserWithPlan();
  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );
  expect(res.status).toBe(200);
  expect(await db.progressSnapshot.count()).toBe(2);
});

test("running tick twice the same day upserts rather than duplicating the row", async () => {
  await setupUserWithPlan();
  const req = () =>
    GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));
  await req();
  await req();
  expect(await db.progressSnapshot.count()).toBe(1);
});

// Regresses a bug where one plan throwing mid-batch (e.g. malformed data)
// aborted the whole request, silently costing every other plan its nightly
// snapshot. Forces a real throw for one plan by writing JSON null into its
// required weeklyAvailability column (plannedHoursFor then reads a property
// off null), and asserts the other, healthy plan still gets its snapshot.
test("one plan's processing failure doesn't prevent a second, healthy active plan from getting its snapshot", async () => {
  const { plan: badPlan } = await setupUserWithPlan();
  const { plan: goodPlan } = await setupUserWithPlan();
  await db.studyPlan.update({ where: { id: badPlan.id }, data: { weeklyAvailability: Prisma.JsonNull } });

  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.plansFailed).toBe(1);
  expect(await db.progressSnapshot.findFirst({ where: { planId: goodPlan.id } })).not.toBeNull();
  expect(await db.progressSnapshot.findFirst({ where: { planId: badPlan.id } })).toBeNull();
});

test("tick sends a push notification for each user with a missed day and an active subscription", async () => {
  const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).toHaveBeenCalledWith(user.id, expect.objectContaining({ title: expect.any(String) }));
});

test("tick does not send a push notification when the user has no subscription", async () => {
  await setupUserWithPlan({ weeklyAvailability: fullWeek });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).not.toHaveBeenCalled();
});

// weeklyAvailability's yesterday-weekday hours are 0, so yesterday was never
// a planned study day - missedStudyDays must not report it, and no push
// should fire, even though the user does have a subscription.
test("tick does not send a push notification when yesterday was not a planned study day", async () => {
  const yesterdayWeekday = new Date(Date.now() - 24 * 60 * 60 * 1000).getUTCDay();
  const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const noStudyYesterday = { ...fullWeek, [weekdayKeys[yesterdayWeekday]]: 0 };
  const { user } = await setupUserWithPlan({ weeklyAvailability: noStudyYesterday });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).not.toHaveBeenCalled();
});
