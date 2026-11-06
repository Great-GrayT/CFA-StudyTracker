import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb } from "../helpers/test-db";
import { jsonRequest } from "../helpers/request";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/cron/tick/route";
import { setupUserWithPlan, ensureLevel, fullWeek, daysAgo, isoDate } from "../helpers/fixtures";
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

// The plan's startDate must be well before "yesterday" here - otherwise
// this would pass for the wrong reason (the now-fixed startDate-clipping
// bug: a brand-new plan created today has no valid "yesterday" to have
// missed yet, so missedDaysWindow is null and nothing would be sent
// regardless of whether the push logic itself works). Backdating startDate
// makes yesterday a genuine missed day, so this actually exercises the push.
test("tick sends a push notification for each user with a missed day and an active subscription", async () => {
  const { user } = await setupUserWithPlan({ weeklyAvailability: fullWeek, startDate: isoDate(daysAgo(10)) });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).toHaveBeenCalledWith(user.id, expect.objectContaining({ title: expect.any(String) }));
});

test("tick does not send a push notification when the user has no subscription", async () => {
  // Backdated startDate for the same reason as above - there needs to be a
  // genuine missed day for "no subscription" to be the actual reason no
  // push fires, not just an incidentally-null window.
  await setupUserWithPlan({ weeklyAvailability: fullWeek, startDate: isoDate(daysAgo(10)) });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).not.toHaveBeenCalled();
});

// weeklyAvailability's yesterday-weekday hours are 0, so yesterday was never
// a planned study day - missedStudyDays must not report it, and no push
// should fire, even though the user does have a subscription. Backdated
// startDate so this genuinely exercises the 0-hours-that-weekday branch
// rather than passing trivially because the window is null regardless.
test("tick does not send a push notification when yesterday was not a planned study day", async () => {
  const yesterdayWeekday = new Date(Date.now() - 24 * 60 * 60 * 1000).getUTCDay();
  const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const noStudyYesterday = { ...fullWeek, [weekdayKeys[yesterdayWeekday]]: 0 };
  const { user } = await setupUserWithPlan({ weeklyAvailability: noStudyYesterday, startDate: isoDate(daysAgo(10)) });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  await GET(jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));

  expect(sendSpy).not.toHaveBeenCalled();
});

// Regresses the "forever post-exam" bug: once a plan's exam date has
// passed, cron must skip it entirely - no snapshot, no push - even though
// yesterday really was a missed day under the plan's own template.
test("tick skips a plan entirely (no snapshot, no push) once its exam date has passed", async () => {
  const { user, plan } = await setupUserWithPlan({
    weeklyAvailability: fullWeek,
    startDate: isoDate(daysAgo(10)),
    examDate: isoDate(daysAgo(1)),
  });
  await db.pushSubscription.create({ data: { userId: user.id, endpoint: "https://push.example/abc", p256dh: "k1", auth: "k2" } });
  const sendSpy = vi.spyOn(pushModule, "sendPushToUser").mockResolvedValue(undefined);

  const res = await GET(
    jsonRequest("GET", "/api/cron/tick", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }),
  );
  const body = await res.json();

  expect(body.plansSkipped).toBe(1);
  expect(sendSpy).not.toHaveBeenCalled();
  expect(await db.progressSnapshot.findFirst({ where: { planId: plan.id } })).toBeNull();
});
